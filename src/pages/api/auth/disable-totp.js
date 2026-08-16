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

export async function POST({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "D1 database connection binding is missing." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  const user = await getSessionUser(db, request);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Disable MFA in totp_secrets and users table
    await db.prepare("UPDATE totp_secrets SET enabled = 0 WHERE user_id = ?").bind(user.id).run();
    await db.prepare("UPDATE users SET mfa_enabled = 0 WHERE id = ?").bind(user.id).run();

    return new Response(JSON.stringify({
      success: true,
      message: "Two-Factor Authentication has been disabled.",
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed to disable 2FA: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
