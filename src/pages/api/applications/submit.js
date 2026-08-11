export const prerender = false;

/**
 * POST /api/applications/submit
 * Public endpoint — allows anyone to apply as a contributor.
 * Body: { name, email, about_me, writing_experience, portfolio_links? }
 */
export async function POST({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "D1 database connection binding is missing." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { name, email, about_me, writing_experience, portfolio_links } = body;

  if (!name || !email || !about_me || !writing_experience) {
    return new Response(JSON.stringify({ error: "Name, email, about_me, and writing_experience are required." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: "Please provide a valid email address." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Check for duplicate pending applications
    const existing = await db.prepare(
      "SELECT id FROM applications WHERE email = ? AND status = 'pending'"
    ).bind(email).first();
    if (existing) {
      return new Response(JSON.stringify({ error: "You already have a pending application." }), {
        status: 409, headers: { "Content-Type": "application/json" }
      });
    }

    const now = Math.floor(Date.now() / 1000);
    await db.prepare(
      `INSERT INTO applications (name, email, about_me, writing_experience, portfolio_links, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    ).bind(name.trim(), email.trim(), about_me.trim(), writing_experience.trim(), (portfolio_links || '').trim(), now).run();

    return new Response(JSON.stringify({
      success: true,
      message: "Your application has been submitted for review.",
    }), {
      status: 201, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Application submission failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
