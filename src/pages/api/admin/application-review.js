export const prerender = false;
import { buildAcceptanceEmail, buildRejectionEmail } from "../_email-template.js";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

// --- Auth ---
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

function generatePassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', data, { name: 'PBKDF2' }, false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key, 256
  );
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sendSESEmail(env, to, subject, htmlBody) {
  const awsRegion = env.AWS_REGION || 'ca-central-1';
  const accessKeyId = env.AWS_ACCESS_KEY_ID || '';
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY || '';
  const fromEmail = env.SES_FROM_EMAIL || '';

  if (!accessKeyId || !secretAccessKey || !fromEmail) {
    console.warn('SES not configured — skipping email.');
    return false;
  }

  const client = new SESClient({
    region: awsRegion,
    credentials: { accessKeyId, secretAccessKey },
  });
  await client.send(new SendEmailCommand({
    Source: fromEmail,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
    },
  }));
  return true;
}

/**
 * POST /api/admin/application-review
 * Body: { applicationId, action: 'accept' | 'reject', reason? }
 */
export async function POST({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "D1 database connection binding is missing." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  const user = await getSessionUser(db, request);
  if (!user || !isAdmin(user)) {
    return new Response(JSON.stringify({ error: "Forbidden." }), {
      status: 403, headers: { "Content-Type": "application/json" }
    });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { applicationId, action, reason } = body;
  if (!applicationId || !action) {
    return new Response(JSON.stringify({ error: "applicationId and action are required." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const app = await db.prepare("SELECT * FROM applications WHERE id = ?").bind(applicationId).first();
    if (!app) {
      return new Response(JSON.stringify({ error: "Application not found." }), {
        status: 404, headers: { "Content-Type": "application/json" }
      });
    }
    if (app.status !== 'pending') {
      return new Response(JSON.stringify({ error: "Application already reviewed." }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    const env = locals.runtime?.env || {};
    const now = Math.floor(Date.now() / 1000);

    if (action === 'accept') {
      // Username = email (not auto-generated from name)
      const username = app.email;

      // Check for duplicate email/username
      const existing = await db.prepare("SELECT id FROM users WHERE username = ? OR email = ?")
        .bind(username, app.email).first();
      if (existing) {
        return new Response(JSON.stringify({ error: "A user with this email already exists." }), {
          status: 409, headers: { "Content-Type": "application/json" }
        });
      }

      const password = generatePassword(12);
      const passwordHash = await hashPassword(password);
      const userId = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));

      await db.prepare(
        `INSERT INTO users (id, username, password_hash, role, full_name, email, force_password_change)
         VALUES (?, ?, ?, 'contributor', ?, ?, 1)`
      ).bind(userId, username, passwordHash, app.name, app.email).run();

      await db.prepare(
        "UPDATE applications SET status = 'approved', admin_notes = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?"
      ).bind(reason || '', now, user.id, applicationId).run();

      const loginUrl = 'https://imedipedia.pages.dev/contributors';
      const htmlBody = buildAcceptanceEmail({ name: app.name, username, password, loginUrl });

      let emailResult = '';
      try {
        await sendSESEmail(env, app.email,
          'Welcome to iMedipedia — Your Contributor Account is Ready',
          htmlBody
        );
        emailResult = ' Welcome email sent.';
      } catch (emailErr) {
        console.error('SES send failed (non-fatal):', emailErr.message);
        emailResult = ' (Email delivery may be delayed — SES response parsing error.)';
      }

      return new Response(JSON.stringify({
        success: true,
        message: `Application approved. User "${username}" created with auto-generated password.${emailResult}`,
        username,
      }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });

    } else {
      // Reject
      await db.prepare(
        "UPDATE applications SET status = 'rejected', admin_notes = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?"
      ).bind(reason || '', now, user.id, applicationId).run();

      const htmlBody = buildRejectionEmail({ name: app.name, reason });
      let emailResult2 = '';
      try {
        await sendSESEmail(env, app.email,
          'Update on Your iMedipedia Contributor Application',
          htmlBody
        );
        emailResult2 = ' Notification email sent.';
      } catch (emailErr) {
        console.error('SES send failed (non-fatal):', emailErr.message);
        emailResult2 = ' (Email delivery may be delayed.)';
      }

      return new Response(JSON.stringify({
        success: true,
        message: `Application rejected.${emailResult2}`,
      }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: `Review failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
