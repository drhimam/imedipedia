import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

export const prerender = false;

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function POST({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "D1 database connection binding is missing." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { username } = body;
  if (!username) {
    return new Response(JSON.stringify({ error: "Username/Email is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const user = await db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
    if (!user) {
      // Return 200 to prevent user enumeration attacks
      return new Response(JSON.stringify({ success: true, message: "If this email is registered, a reset link will be sent." }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Generate 40-character reset token (20 bytes hex)
    const tokenBytes = crypto.getRandomValues(new Uint8Array(20));
    const token = bytesToHex(tokenBytes);
    // Expiry: 15 minutes
    const expiresAt = Math.floor(Date.now() / 1000) + (15 * 60);

    // Save reset token
    await db.prepare("INSERT INTO password_reset_tokens (id, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(token, user.id, expiresAt)
      .run();

    // AWS SES Configurations from environment bindings or Cloudflare env
    const awsRegion = locals.runtime?.env?.AWS_REGION || import.meta.env.AWS_REGION || "us-east-1";
    const accessKeyId = locals.runtime?.env?.AWS_ACCESS_KEY_ID || import.meta.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = locals.runtime?.env?.AWS_SECRET_ACCESS_KEY || import.meta.env.AWS_SECRET_ACCESS_KEY;
    const fromEmail = locals.runtime?.env?.SES_FROM_EMAIL || import.meta.env.SES_FROM_EMAIL;

    if (!accessKeyId || !secretAccessKey || !fromEmail) {
      console.error("Missing SES AWS Credentials or Sender Email configuration.");
      return new Response(JSON.stringify({ error: "Email configuration error on host server." }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const sesClient = new SESClient({
      region: awsRegion,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const resetLink = `${new URL(request.url).origin}/auth/reset-password?token=${token}`;

    const sendEmailCommand = new SendEmailCommand({
      Source: fromEmail,
      Destination: {
        ToAddresses: [username],
      },
      Message: {
        Subject: {
          Charset: "UTF-8",
          Data: "Reset Your Medical Blog Volunteer Password",
        },
        Body: {
          Html: {
            Charset: "UTF-8",
            Data: `<p>Hello,</p><p>A password reset request was initiated for your Volunteer account. Please click the link below to set a new password. This link is valid for 15 minutes:</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you did not request this, you can ignore this email.</p>`,
          },
        },
      },
    });

    await sesClient.send(sendEmailCommand);

    return new Response(JSON.stringify({ success: true, message: "If this email is registered, a reset link will be sent." }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `SES Send / Reset error: ${err.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
