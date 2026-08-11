export const prerender = false;

/**
 * GET /api/contributors/list
 * Returns all users with role='contributor' and full_name != ''
 * Public endpoint — no authentication required.
 */
export async function GET({ locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "Database connection unavailable." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const contributors = await db.prepare(
      `SELECT id, username, full_name, email, specialty, bio, avatar_url, affiliation
       FROM users
       WHERE role = 'contributor' AND full_name != ''
       ORDER BY full_name ASC`
    ).all();

    const results = (contributors.results || []).map(c => ({
      id: c.id,
      full_name: c.full_name,
      email: c.email,
      specialty: c.specialty || '',
      bio: c.bio || '',
      avatar_url: c.avatar_url || '',
      affiliation: c.affiliation || '',
      slug: c.full_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
      initial: (c.full_name || '?')[0].toUpperCase(),
    }));

    return new Response(JSON.stringify({ contributors: results }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed to list contributors: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
