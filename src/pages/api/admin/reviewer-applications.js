export const prerender = false;
import { buildReviewerApprovedEmail } from "../_email-template.js";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

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

async function sendSESEmail(env, to, subject, htmlBody) {
  const awsRegion = env.AWS_REGION || 'ca-central-1';
  const accessKeyId = env.AWS_ACCESS_KEY_ID || '';
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY || '';
  const fromEmail = env.SES_FROM_EMAIL || 'support@imedipedia.com';

  if (!accessKeyId || !secretAccessKey || !fromEmail) {
    console.warn('SES not configured — skipping reviewer email notification.');
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

// Generate random password & PBKDF2 hash
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let pw = '';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 12; i++) {
    pw += chars[bytes[i] % chars.length];
  }
  return pw;
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashHex = Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

/**
 * GET /api/admin/reviewer-applications
 * List all pending or processed reviewer applications
 */
export async function GET({ request, locals }) {
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

  try {
    const apps = await db.prepare(
      `SELECT a.*, u.full_name as reviewed_by_name
       FROM peer_review_applications a
       LEFT JOIN users u ON a.reviewed_by = u.id
       ORDER BY a.created_at DESC`
    ).all();

    return new Response(JSON.stringify({
      success: true,
      applications: apps.results || []
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * POST /api/admin/reviewer-applications
 * Approve or reject reviewer application. On approve, creates user account with role='reviewer'
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

  const { applicationId, action, notes } = body;
  if (!applicationId || !['approve', 'reject'].includes(action)) {
    return new Response(JSON.stringify({ error: "applicationId and valid action (approve/reject) are required." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const app = await db.prepare("SELECT * FROM peer_review_applications WHERE id = ?").bind(applicationId).first();
    if (!app) {
      return new Response(JSON.stringify({ error: "Application not found." }), {
        status: 404, headers: { "Content-Type": "application/json" }
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const env = locals.runtime?.env || {};
    const origin = new URL(request.url).origin || 'https://imedipedia.com';

    if (action === 'approve') {
      // Check if user already exists
      let existingUser = await db.prepare("SELECT * FROM users WHERE email = ?").bind(app.email).first();
      let username = '';
      let password = '';
      let userId = '';

      if (existingUser) {
        // Upgrade existing user role if needed
        userId = existingUser.id;
        username = existingUser.username;
        if (existingUser.role !== 'admin' && existingUser.role !== 'co-admin') {
          await db.prepare("UPDATE users SET role = 'reviewer' WHERE id = ?").bind(userId).run();
        }
      } else {
        // Create new reviewer user with username = email
        username = app.email.toLowerCase().trim();
        password = generatePassword();
        const passwordHash = await hashPassword(password);
        userId = crypto.randomUUID().replace(/-/g, '');

        // Parse affiliations & specialties into JSON arrays
        const affArray = [app.title_affiliation];
        let specArray = [];
        try { specArray = JSON.parse(app.specialties || '[]'); } catch { specArray = [app.specialties]; }

        await db.prepare(
          `INSERT INTO users (id, username, password_hash, role, full_name, email, affiliation, specialty, bio, force_password_change)
           VALUES (?, ?, ?, 'reviewer', ?, ?, ?, ?, ?, 1)`
        ).bind(
          userId,
          username,
          passwordHash,
          app.name,
          app.email.toLowerCase().trim(),
          JSON.stringify(affArray),
          JSON.stringify(specArray),
          app.qualifications || ''
        ).run();
      }

      await db.prepare(
        "UPDATE peer_review_applications SET status = 'approved', admin_notes = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?"
      ).bind(notes || '', now, user.id, applicationId).run();

      // Send Welcome Email to Reviewer
      if (password) {
        try {
          const loginUrl = `${origin}/contributors`;
          const emailHtml = buildReviewerApprovedEmail({
            name: app.name,
            username,
            password,
            loginUrl
          });
          await sendSESEmail(env, app.email, 'Welcome to the iMedipedia Peer Review Board', emailHtml);
        } catch (e) {
          console.error('SES Email error for reviewer acceptance:', e);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        message: `Application approved. Reviewer account created for ${app.name} (${username}).`
      }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });

    } else {
      // Reject
      await db.prepare(
        "UPDATE peer_review_applications SET status = 'rejected', admin_notes = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?"
      ).bind(notes || '', now, user.id, applicationId).run();

      return new Response(JSON.stringify({
        success: true,
        message: "Application rejected."
      }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: `Review error: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * DELETE /api/admin/reviewer-applications
 * Body: { id }
 */
export async function DELETE({ request, locals }) {
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

  const { id } = body;
  if (!id) {
    return new Response(JSON.stringify({ error: "id is required." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    await db.prepare("DELETE FROM peer_review_applications WHERE id = ?").bind(id).run();
    return new Response(JSON.stringify({
      success: true,
      message: "Reviewer application deleted successfully."
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Deletion failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
