import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

export const prerender = false;

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

export async function POST({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "D1 database connection binding is missing." }), { status: 500 });
  }

  const user = await getSessionUser(db, request);
  if (!user || !isAdmin(user)) return new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });

  try {
    const { to, subject, htmlBody } = await request.json();
    if (!to || !subject || !htmlBody) {
      return new Response(JSON.stringify({ error: "To, subject, and htmlBody are required." }), { status: 400 });
    }

    const accessKeyId = locals.runtime?.env?.AWS_ACCESS_KEY_ID || '';
    const secretAccessKey = locals.runtime?.env?.AWS_SECRET_ACCESS_KEY || '';
    const awsRegion = locals.runtime?.env?.AWS_REGION || 'us-east-1';
    const fromEmail = locals.runtime?.env?.SES_FROM_EMAIL || 'support@imedipedia.org';

    if (!accessKeyId || !secretAccessKey || !fromEmail) {
      return new Response(JSON.stringify({ error: "SES AWS Credentials or Sender Email not configured." }), { status: 500 });
    }

    const sesClient = new SESClient({
      region: awsRegion,
      credentials: { accessKeyId, secretAccessKey },
    });

    let toAddresses = [];
    if (to === 'all') {
      const allUsers = await db.prepare("SELECT email FROM users WHERE email IS NOT NULL AND email != ''").all();
      toAddresses = allUsers.results.map(u => u.email);
    } else if (Array.isArray(to)) {
      toAddresses = to;
    } else {
      toAddresses = [to];
    }

    if (toAddresses.length === 0) {
      return new Response(JSON.stringify({ error: "No valid recipients found." }), { status: 400 });
    }

    // Send emails in batches if there are many, but for now just send individually to avoid SES limits per call
    let sentCount = 0;
    for (const email of toAddresses) {
      try {
        const sendEmailCommand = new SendEmailCommand({
          Source: fromEmail,
          Destination: { ToAddresses: [email] },
          Message: {
            Subject: { Charset: "UTF-8", Data: subject },
            Body: { Html: { Charset: "UTF-8", Data: htmlBody } },
          },
        });
        await sesClient.send(sendEmailCommand);
        sentCount++;
      } catch (err) {
        console.error(`Failed to send to ${email}:`, err);
      }
    }

    return new Response(JSON.stringify({ success: true, message: `Sent ${sentCount} email(s) successfully.` }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed: ${err.message}` }), { status: 500 });
  }
}
