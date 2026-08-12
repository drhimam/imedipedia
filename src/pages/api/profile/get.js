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

  // Parse JSON array fields (backward-compatible with plain strings)
  function parseArrayField(val) {
    if (!val || val === '') return [];
    try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) return parsed; } catch {}
    // Legacy: plain string → wrap as single-element array
    return [String(val)];
  }

  return new Response(JSON.stringify({
    success: true,
    profile: {
      id: user.id,
      username: user.username,
      email: user.email || '',
      full_name: user.full_name || '',
      specialty: parseArrayField(user.specialty),
      bio: user.bio || '',
      affiliation: parseArrayField(user.affiliation),
      experience: parseArrayField(user.experience),
      avatar_url: user.avatar_url || '',
      role: user.role,
      force_password_change: user.force_password_change === 1,
      mfa_enabled: user.mfa_enabled === 1,
    },
  }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
}
