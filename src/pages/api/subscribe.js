export const prerender = false;

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { buildNewsletterWelcomeEmail, formatSenderAddress } from "./_email-template.js";

export async function POST({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "Database binding missing." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const { email, name } = await request.json();
    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: "A valid email address is required." }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = (name || '').trim();
    const now = Math.floor(Date.now() / 1000);

    // Check if subscriber exists
    const existing = await db.prepare("SELECT * FROM subscribers WHERE email = ?").bind(cleanEmail).first();

    let token;
    if (existing) {
      token = existing.unsubscribe_token;
      // Re-subscribe if previously unsubscribed
      await db.prepare("UPDATE subscribers SET unsubscribed_at = NULL, name = ? WHERE id = ?")
        .bind(cleanName || existing.name, existing.id).run();
    } else {
      token = crypto.randomUUID().replace(/-/g, '');
      await db.prepare(
        "INSERT INTO subscribers (email, name, subscribed_at, unsubscribe_token) VALUES (?, ?, ?, ?)"
      ).bind(cleanEmail, cleanName, now, token).run();
    }

    // Try sending welcome email via AWS SES
    const origin = new URL(request.url).origin;
    const unsubscribeUrl = `${origin}/unsubscribe?token=${token}`;

    const awsAccessKey = locals.runtime?.env?.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
    const awsSecretKey = locals.runtime?.env?.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
    const awsRegion = locals.runtime?.env?.AWS_REGION || process.env.AWS_REGION || "us-east-1";
    const fromEmail = locals.runtime?.env?.SES_FROM_EMAIL || process.env.SES_FROM_EMAIL || "newsletter@imedipedia.org";
    const senderName = locals.runtime?.env?.SES_FROM_NAME || process.env.SES_FROM_NAME || "iMedipedia Admin";

    if (awsAccessKey && awsSecretKey) {
      try {
        const ses = new SESClient({
          region: awsRegion,
          credentials: { accessKeyId: awsAccessKey, secretAccessKey: awsSecretKey }
        });
        const html = buildNewsletterWelcomeEmail({ email: cleanEmail, unsubscribeUrl });
        const command = new SendEmailCommand({
          Source: formatSenderAddress(fromEmail, senderName),
          Destination: { ToAddresses: [cleanEmail] },
          Message: {
            Subject: { Data: "Welcome to iMedipedia Weekly Research Digest 📬", Charset: "UTF-8" },
            Body: { Html: { Data: html, Charset: "UTF-8" } }
          }
        });
        await ses.send(command);
      } catch (sesErr) {
        console.warn("SES welcome email notice:", sesErr.message);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Thank you for subscribing to the iMedipedia Weekly Digest!"
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
