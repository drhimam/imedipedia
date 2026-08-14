export const prerender = false;

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { buildNewsletterEmail, formatSenderAddress } from "../../_email-template.js";

async function getSessionUser(db, request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(/session_id=([^;]+)/);
  const sessionId = match ? match[1] : null;
  if (!sessionId) return null;
  const now = Math.floor(Date.now() / 1000);
  const session = await db.prepare("SELECT * FROM sessions WHERE id = ? AND expires_at > ?")
    .bind(sessionId, now).first();
  if (!session) return null;
  return await db.prepare("SELECT * FROM users WHERE id = ?").bind(session.user_id).first();
}

function isAdmin(user) {
  return user && (user.role === 'admin' || user.role === 'co-admin');
}

function mdToHtml(md) {
  if (!md) return '';
  return md
    .replace(/^### (.*$)/gim, '<h3 style="color:#1e293b;margin:22px 0 10px;font-size:18px;font-weight:700;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">$1</h3>')
    .replace(/^#### (.*$)/gim, '<h4 style="color:#334155;margin:16px 0 6px;font-size:16px;font-weight:600;">$1</h4>')
    .replace(/^## (.*$)/gim, '<h2 style="color:#4f46e5;margin:24px 0 12px;font-size:22px;font-weight:700;letter-spacing:-0.3px;">$1</h2>')
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#0f172a;">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em style="color:#475569;">$1</em>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="color:#6366f1;text-decoration:none;font-weight:600;">$1</a>')
    .replace(/^---$/gim, '<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">')
    .replace(/\n\n/g, '</p><p style="margin:0 0 12px;line-height:1.65;color:#334155;font-size:15px;">')
    .replace(/\n/g, '<br>');
}

export async function POST({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "Database binding missing." }), { status: 500 });
  }

  const user = await getSessionUser(db, request);
  if (!user || !isAdmin(user)) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401 });
  }

  try {
    const { newsletterId } = await request.json();
    if (!newsletterId) {
      return new Response(JSON.stringify({ error: "newsletterId is required." }), { status: 400 });
    }

    const newsletter = await db.prepare("SELECT * FROM newsletters WHERE id = ?").bind(newsletterId).first();
    if (!newsletter) {
      return new Response(JSON.stringify({ error: "Newsletter issue not found." }), { status: 404 });
    }

    const activeSubs = await db.prepare("SELECT * FROM subscribers WHERE unsubscribed_at IS NULL").all();
    const subscribers = activeSubs?.results || [];

    if (subscribers.length === 0) {
      return new Response(JSON.stringify({ error: "No active subscribers found to send to." }), { status: 400 });
    }

    const awsAccessKey = locals.runtime?.env?.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
    const awsSecretKey = locals.runtime?.env?.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
    const awsRegion = locals.runtime?.env?.AWS_REGION || process.env.AWS_REGION || "us-east-1";
    const fromEmail = locals.runtime?.env?.SES_FROM_EMAIL || process.env.SES_FROM_EMAIL || "newsletter@imedipedia.org";
    const senderName = locals.runtime?.env?.SES_FROM_NAME || process.env.SES_FROM_NAME || "iMedipedia Admin";

    if (!awsAccessKey || !awsSecretKey) {
      return new Response(JSON.stringify({ error: "AWS SES credentials not configured in environment." }), { status: 500 });
    }

    const ses = new SESClient({
      region: awsRegion,
      credentials: { accessKeyId: awsAccessKey, secretAccessKey: awsSecretKey }
    });

    const origin = new URL(request.url).origin;
    const htmlBody = `<p style="margin:0 0 12px;line-height:1.65;color:#334155;font-size:15px;">` + mdToHtml(newsletter.body_md) + `</p>`;

    let sentCount = 0;
    let failCount = 0;

    for (const sub of subscribers) {
      const unsubscribeUrl = `${origin}/unsubscribe?token=${sub.unsubscribe_token}`;
      const fullEmailHtml = buildNewsletterEmail({
        title: newsletter.title,
        subject: newsletter.subject,
        htmlBody,
        unsubscribeUrl
      });

      try {
        const command = new SendEmailCommand({
          Source: formatSenderAddress(fromEmail, senderName),
          Destination: { ToAddresses: [sub.email] },
          Message: {
            Subject: { Data: newsletter.subject, Charset: "UTF-8" },
            Body: { Html: { Data: fullEmailHtml, Charset: "UTF-8" } }
          }
        });
        await ses.send(command);
        sentCount++;
      } catch (sendErr) {
        console.error(`Failed sending issue #${newsletter.issue_number} to ${sub.email}:`, sendErr.message);
        failCount++;
      }
    }

    const now = Math.floor(Date.now() / 1000);
    await db.prepare("UPDATE newsletters SET status = 'sent', sent_at = ? WHERE id = ?")
      .bind(now, newsletter.id).run();

    return new Response(JSON.stringify({
      success: true,
      message: `Digest #${newsletter.issue_number} sent to ${sentCount} subscriber(s).${failCount > 0 ? ` (${failCount} failed)` : ''}`,
      sentCount,
      failCount
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
