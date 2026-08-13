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
    return new Response(JSON.stringify({ error: "Database binding missing." }), { status: 500 });
  }

  const user = await getSessionUser(db, request);
  if (!user || !isAdmin(user)) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401 });
  }

  try {
    const totalSubscribers = await db.prepare("SELECT COUNT(*) as count FROM subscribers").first();
    const activeSubscribers = await db.prepare("SELECT COUNT(*) as count FROM subscribers WHERE unsubscribed_at IS NULL").first();
    const subscribers = await db.prepare("SELECT id, email, name, subscribed_at, unsubscribed_at FROM subscribers ORDER BY id DESC LIMIT 100").all();
    const newsletters = await db.prepare("SELECT * FROM newsletters ORDER BY issue_number DESC").all();

    return new Response(JSON.stringify({
      stats: {
        total: totalSubscribers?.count || 0,
        active: activeSubscribers?.count || 0,
        unsubscribed: (totalSubscribers?.count || 0) - (activeSubscribers?.count || 0)
      },
      subscribers: subscribers?.results || [],
      newsletters: newsletters?.results || []
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
