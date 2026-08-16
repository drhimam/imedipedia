import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { buildPasswordResetEmail, formatSenderAddress } from "../_email-template.js";

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

  const { username, identifier, email } = body;
  const lookupValue = username || identifier || email;
  if (!lookupValue) {
    return new Response(JSON.stringify({ error: "Username or Email is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Look up user by username OR email (supports both)
    let user = await db.prepare("SELECT * FROM users WHERE username = ?").bind(lookupValue).first();
    if (!user) {
      user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(lookupValue).first();
    }

    if (!user) {
      // Return 200 to prevent user enumeration attacks
      return new Response(JSON.stringify({ success: true, message: "If this account exists, a reset link will be sent." }), {
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
    const awsRegion = locals.runtime?.env?.AWS_REGION || import.meta.env.AWS_REGION || "ca-central-1";
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

    // Build reset link using the request origin for correct domain
    const requestUrl = new URL(request.url);
    const resetLink = `${requestUrl.origin}/contributors/reset-password?token=${token}`;

    // Build branded HTML email
    const htmlBody = buildPasswordResetEmail({
      name: user.full_name || user.username,
      resetUrl: resetLink,
      resetLink,
    });

    const senderName = locals.runtime?.env?.SES_FROM_NAME || import.meta.env.SES_FROM_NAME || "iMedipedia Admin";

    const sendEmailCommand = new SendEmailCommand({
      Source: formatSenderAddress(fromEmail, senderName),
      Destination: {
        ToAddresses: [user.email || user.username],
      },
      Message: {
        Subject: {
          Charset: "UTF-8",
          Data: "Reset Your iMedipedia Password",
        },
        Body: {
          Html: {
            Charset: "UTF-8",
            Data: htmlBody,
          },
        },
      },
    });

    await sesClient.send(sendEmailCommand);

    return new Response(JSON.stringify({ success: true, message: "If this account exists, a reset link will be sent." }), {
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
