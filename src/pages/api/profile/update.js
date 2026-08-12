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
 * Normalize a field value to a JSON array string.
 * Handles: arrays, comma-separated strings, single values, or already-JSON strings.
 */
function normalizeArrayField(value) {
  if (!value) return '[]';
  if (Array.isArray(value)) return JSON.stringify(value.map(v => String(v).trim()).filter(Boolean));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return JSON.stringify(parsed.map(v => String(v).trim()).filter(Boolean));
    } catch {}
    // Comma-separated or single value
    if (value.includes(',')) {
      return JSON.stringify(value.split(',').map(v => v.trim()).filter(Boolean));
    }
    return JSON.stringify([value.trim()]);
  }
  return '[]';
}

/**
 * POST /api/profile/update
 * Body: { full_name, email, specialty, bio, affiliation, experience, avatar_url? }
 * specialty, affiliation, experience can be arrays or comma-separated strings.
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

  const { full_name, email, specialty, bio, affiliation, experience, avatar_url } = body;

  await db.prepare(
    `UPDATE users SET full_name = ?, email = ?, specialty = ?, bio = ?, affiliation = ?, experience = ?, avatar_url = ? WHERE id = ?`
  ).bind(
    (full_name || '').trim(),
    (email || '').trim(),
    normalizeArrayField(specialty),
    (bio || '').trim(),
    normalizeArrayField(affiliation),
    normalizeArrayField(experience),
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
