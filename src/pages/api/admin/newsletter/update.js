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

export async function PUT({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "Database binding missing." }), { status: 500 });
  }

  const user = await getSessionUser(db, request);
  if (!user || !isAdmin(user)) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401 });
  }

  try {
    const { id, title, subject, body_md } = await request.json();
    if (!id || !title || !subject || !body_md) {
      return new Response(JSON.stringify({ error: "All fields (id, title, subject, body_md) are required." }), { status: 400 });
    }

    await db.prepare(
      "UPDATE newsletters SET title = ?, subject = ?, body_md = ? WHERE id = ?"
    ).bind(title.trim(), subject.trim(), body_md.trim(), id).run();

    const updated = await db.prepare("SELECT * FROM newsletters WHERE id = ?").bind(id).first();

    return new Response(JSON.stringify({
      success: true,
      message: "Newsletter issue updated successfully.",
      newsletter: updated
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
