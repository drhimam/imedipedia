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
    return new Response(JSON.stringify({ error: "Database binding is missing." }), { status: 500 });
  }

  const user = await getSessionUser(db, request);
  if (!user || !isAdmin(user)) {
    return new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });
  }

  try {
    const { results } = await db.prepare("SELECT * FROM admin_slides ORDER BY display_order ASC, created_at DESC").all();
    return new Response(JSON.stringify({ slides: results || [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export async function POST({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: "Database binding is missing." }), { status: 500 });
  const user = await getSessionUser(db, request);
  if (!user || !isAdmin(user)) return new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });

  try {
    const { image_url, link_url, title, display_order } = await request.json();
    if (!image_url || !link_url) {
      return new Response(JSON.stringify({ error: "Image URL and Link URL are required." }), { status: 400 });
    }

    const order = parseInt(display_order) || 0;
    const now = Math.floor(Date.now() / 1000);

    await db.prepare(
      "INSERT INTO admin_slides (image_url, link_url, title, is_active, display_order, created_at) VALUES (?, ?, ?, 1, ?, ?)"
    ).bind(image_url, link_url, title || '', order, now).run();

    return new Response(JSON.stringify({ success: true, message: "Slide added successfully." }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export async function PUT({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: "Database binding is missing." }), { status: 500 });
  const user = await getSessionUser(db, request);
  if (!user || !isAdmin(user)) return new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });

  try {
    const { id, image_url, link_url, title, is_active, display_order } = await request.json();
    if (!id) return new Response(JSON.stringify({ error: "Slide ID is required." }), { status: 400 });

    const order = parseInt(display_order) || 0;
    const active = is_active ? 1 : 0;

    await db.prepare(
      "UPDATE admin_slides SET image_url = ?, link_url = ?, title = ?, is_active = ?, display_order = ? WHERE id = ?"
    ).bind(image_url, link_url, title || '', active, order, id).run();

    return new Response(JSON.stringify({ success: true, message: "Slide updated successfully." }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

export async function DELETE({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: "Database binding is missing." }), { status: 500 });
  const user = await getSessionUser(db, request);
  if (!user || !isAdmin(user)) return new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });

  try {
    const { id } = await request.json();
    if (!id) return new Response(JSON.stringify({ error: "Slide ID is required." }), { status: 400 });

    await db.prepare("DELETE FROM admin_slides WHERE id = ?").bind(id).run();

    return new Response(JSON.stringify({ success: true, message: "Slide deleted successfully." }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
