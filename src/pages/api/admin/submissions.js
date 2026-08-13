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
    const status = url.searchParams.get('status') || '';
    const q = (url.searchParams.get('q') || '').trim();
    const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit')) || 10));
    const offset = (page - 1) * limit;

    let query = `SELECT s.*, u.username, u.full_name as author_name
                 FROM submissions s LEFT JOIN users u ON s.user_id = u.id`;
    let countQuery = 'SELECT COUNT(*) as total FROM submissions s LEFT JOIN users u ON s.user_id = u.id';
    const params = [];
    const countParams = [];

    const conditions = [];
    if (status) {
      conditions.push('s.status = ?');
      params.push(status);
      countParams.push(status);
    }
    if (q) {
      conditions.push('(s.title LIKE ? OR s.author LIKE ? OR u.full_name LIKE ?)');
      const likeQuery = `%${q}%`;
      params.push(likeQuery, likeQuery, likeQuery);
      countParams.push(likeQuery, likeQuery, likeQuery);
    }

    if (conditions.length > 0) {
      const whereClause = ' WHERE ' + conditions.join(' AND ');
      query += whereClause;
      countQuery += whereClause;
    }

    query += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [countResult, subs] = await Promise.all([
      db.prepare(countQuery).bind(...countParams).first(),
      db.prepare(query).bind(...params).all(),
    ]);

    const total = countResult?.total || 0;
    const totalPages = Math.ceil(total / limit);

    return new Response(JSON.stringify({
      submissions: subs.results || [],
      pagination: { total, page, limit, totalPages }
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed to list submissions: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
