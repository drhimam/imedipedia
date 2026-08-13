export const prerender = false;

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

/**
 * GET /api/admin/kb/sources
 * Lists KB sources with their chunk counts.
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
    const rows = await db.prepare(
      `SELECT s.id, s.type, s.title, s.source_url, s.created_by, s.created_at,
              COUNT(c.id) AS chunk_count,
              SUM(CASE WHEN c.embedding != '' THEN 1 ELSE 0 END) AS embedded_count
       FROM kb_sources s
       LEFT JOIN kb_chunks c ON c.source_id = s.id
       GROUP BY s.id
       ORDER BY s.created_at DESC`
    ).all();

    const sources = (rows.results || []).map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title || r.source_url || '(untitled)',
      sourceUrl: r.source_url || '',
      createdBy: r.created_by || '',
      createdAt: r.created_at,
      chunkCount: r.chunk_count || 0,
      embeddedCount: r.embedded_count || 0,
    }));

    return new Response(JSON.stringify({ success: true, sources }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed to list sources: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * DELETE /api/admin/kb/sources?id=123
 * Deletes a source and its chunks (FK cascade).
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

  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id'), 10);
  if (isNaN(id)) {
    return new Response(JSON.stringify({ error: "Provide a valid source id." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const existing = await db.prepare('SELECT id FROM kb_sources WHERE id = ?').bind(id).first();
    if (!existing) {
      return new Response(JSON.stringify({ error: "Source not found." }), {
        status: 404, headers: { "Content-Type": "application/json" }
      });
    }
    await db.prepare('DELETE FROM kb_sources WHERE id = ?').bind(id).run();
    return new Response(JSON.stringify({ success: true, message: "Source deleted." }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Delete failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
