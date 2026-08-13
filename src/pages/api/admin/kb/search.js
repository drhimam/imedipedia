export const prerender = false;

import { retrieveChunks } from '../../../../lib/kb.js';

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
 * POST /api/admin/kb/search
 * Body: { query, topK? }
 * Returns { success, query, results: [{ id, sourceId, title, sourceUrl, text, score }] }
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

  let input;
  try {
    input = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const query = (input.query || '').trim();
  if (!query) {
    return new Response(JSON.stringify({ error: "Provide a search query." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const env = locals.runtime?.env || {};
  const topK = Math.min(Math.max(parseInt(input.topK, 10) || 5, 1), 20);

  try {
    const results = await retrieveChunks(env, db, query, topK);
    return new Response(JSON.stringify({ success: true, query, results }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Search failed: ${err.message}` }), {
      status: 502, headers: { "Content-Type": "application/json" }
    });
  }
}
