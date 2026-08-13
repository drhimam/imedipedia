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

export async function POST({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "Database binding missing." }), { status: 500 });
  }

  const user = await getSessionUser(db, request);
  if (!user || !isAdmin(user)) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401 });
  }

  try {
    const { newsletterId } = await request.json();
    if (!newsletterId) {
      return new Response(JSON.stringify({ error: "newsletterId is required." }), { status: 400 });
    }

    const newsletter = await db.prepare("SELECT * FROM newsletters WHERE id = ?").bind(newsletterId).first();
    if (!newsletter) {
      return new Response(JSON.stringify({ error: "Newsletter issue not found." }), { status: 404 });
    }

    const slug = `weekly-digest-issue-${newsletter.issue_number}`;
    const now = Math.floor(Date.now() / 1000);

    // Check if submission already published for this issue
    const existing = await db.prepare("SELECT * FROM submissions WHERE slug = ?").bind(slug).first();
    if (existing) {
      await db.prepare(
        "UPDATE submissions SET title = ?, description = ?, body = ?, updated_at = ? WHERE id = ?"
      ).bind(
        newsletter.title,
        `Weekly clinical digest and research summary #${newsletter.issue_number}`,
        newsletter.body_md,
        now,
        existing.id
      ).run();
    } else {
      await db.prepare(
        `INSERT INTO submissions 
         (user_id, title, slug, description, author, tag, type, subject, topic, exams, image, body, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'digest', 'general', 'Weekly Digest', 'Weekly Digest', '[]', '', ?, 'published', ?, ?)`
      ).bind(
        user.id,
        newsletter.title,
        slug,
        `Weekly clinical digest and research summary #${newsletter.issue_number}`,
        'iMedipedia Editorial Board',
        newsletter.body_md,
        now,
        now
      ).run();
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Digest #${newsletter.issue_number} published to /general under "Weekly Digest"!`
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
