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
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit')) || 10));
    const offset = (page - 1) * limit;

    let query = 'SELECT id, username, full_name, email, role, mfa_enabled FROM users';
    let countQuery = 'SELECT COUNT(*) as total FROM users';
    const params = [];
    const countParams = [];

    if (q) {
      const whereClause = ' WHERE username LIKE ? OR full_name LIKE ? OR email LIKE ?';
      query += whereClause;
      countQuery += whereClause;
      const likeQuery = `%${q}%`;
      params.push(likeQuery, likeQuery, likeQuery);
      countParams.push(likeQuery, likeQuery, likeQuery);
    }

    query += ' ORDER BY username ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [countResult, usersRes] = await Promise.all([
      db.prepare(countQuery).bind(...countParams).first(),
      db.prepare(query).bind(...params).all(),
    ]);

    const total = countResult?.total || 0;
    const totalPages = Math.ceil(total / limit);

    return new Response(JSON.stringify({
      users: usersRes.results || [],
      pagination: { total, page, limit, totalPages }
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Database error: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
