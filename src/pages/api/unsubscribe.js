export const prerender = false;

export async function POST({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "Database binding missing." }), { status: 500 });
  }

  try {
    const { token } = await request.json();
    if (!token) {
      return new Response(JSON.stringify({ error: "Unsubscribe token required." }), { status: 400 });
    }

    const now = Math.floor(Date.now() / 1000);
    const result = await db.prepare("UPDATE subscribers SET unsubscribed_at = ? WHERE unsubscribe_token = ?")
      .bind(now, token).run();

    return new Response(JSON.stringify({
      success: true,
      message: "You have been successfully unsubscribed from the iMedipedia Digest."
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
