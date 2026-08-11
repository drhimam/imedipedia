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

export async function GET({ request, locals }) {
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

  return new Response(JSON.stringify({
    success: true,
    profile: {
      id: user.id,
      username: user.username,
      email: user.email || '',
      full_name: user.full_name || '',
      specialty: user.specialty || '',
      bio: user.bio || '',
      affiliation: user.affiliation || '',
      avatar_url: user.avatar_url || '',
      role: user.role,
      force_password_change: user.force_password_change === 1,
      mfa_enabled: user.mfa_enabled === 1,
    },
  }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
}
