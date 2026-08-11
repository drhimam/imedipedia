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

/**
 * POST /api/profile/update
 * Body: { full_name, email, specialty, bio, affiliation, avatar_url? }
 */
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

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { full_name, email, specialty, bio, affiliation, avatar_url } = body;

  await db.prepare(
    `UPDATE users SET full_name = ?, email = ?, specialty = ?, bio = ?, affiliation = ?, avatar_url = ? WHERE id = ?`
  ).bind(
    (full_name || '').trim(),
    (email || '').trim(),
    (specialty || '').trim(),
    (bio || '').trim(),
    (affiliation || '').trim(),
    (avatar_url || '').trim(),
    user.id
  ).run();

  return new Response(JSON.stringify({
    success: true,
    message: "Profile updated.",
  }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
}
