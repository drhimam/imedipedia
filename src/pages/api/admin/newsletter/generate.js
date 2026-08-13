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
    const body = await request.json().catch(() => ({}));
    const customTitle = body.title;

    // Determine issue number
    const lastIssue = await db.prepare("SELECT MAX(issue_number) as max_issue FROM newsletters").first();
    const nextIssue = ((lastIssue?.max_issue) || 0) + 1;

    // Fetch published or approved general submissions from past 30 days
    const recentSubmissions = await db.prepare(
      "SELECT title, description, author, slug, created_at FROM submissions WHERE (type = 'general' OR type IS NULL OR type = '') AND status IN ('published', 'approved') ORDER BY created_at DESC LIMIT 10"
    ).all();

    const articles = recentSubmissions?.results || [];

    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const issueTitle = customTitle || `iMedipedia Weekly Clinical Digest #${nextIssue}`;
    const subject = `Weekly Digest #${nextIssue}: Top Medical Research & Clinical Updates (${dateStr})`;

    let markdownBody = `## 🩺 iMedipedia Weekly Digest #${nextIssue}\n*Published on ${dateStr}*\n\n`;
    markdownBody += `### Executive Clinical Summary\n`;
    markdownBody += `Welcome to this week's edition of the iMedipedia Research Digest! Below is a curated compilation of the latest peer-reviewed clinical articles, board review insights, and medical advancements published across our platform.\n\n`;

    if (articles.length > 0) {
      markdownBody += `### Featured Articles & Research Updates\n\n`;
      articles.forEach((art, idx) => {
        markdownBody += `#### ${idx + 1}. ${art.title}\n`;
        markdownBody += `**Author:** ${art.author || 'Editorial Board'} | **Date:** ${new Date(art.created_at * 1000).toLocaleDateString()}\n\n`;
        markdownBody += `${art.description}\n\n`;
        markdownBody += `[Read Full Article](https://imedipedia.org/general?article=${art.slug})\n\n---\n\n`;
      });
    } else {
      markdownBody += `### Featured Clinical Highlights\n\n`;
      markdownBody += `This week's edition brings key clinical pearls across cardiology, internal medicine, and emergency care. Stay tuned for new peer-reviewed articles submitting daily!\n\n`;
    }

    markdownBody += `### Clinical Quiz & Board Pearl of the Week\n`;
    markdownBody += `**Question:** What is the first-line pharmacotherapy for acute STEMI in the absence of contraindications?\n`;
    markdownBody += `**Pearl:** Dual antiplatelet therapy (Aspirin + P2Y12 inhibitor) paired with immediate reperfusion strategy (PCI within 90 minutes).\n\n`;
    markdownBody += `---\n*Thank you for reading iMedipedia Research Digest!*`;

    const now = Math.floor(Date.now() / 1000);
    const result = await db.prepare(
      "INSERT INTO newsletters (issue_number, title, subject, body_md, status, created_at) VALUES (?, ?, ?, ?, 'draft', ?)"
    ).bind(nextIssue, issueTitle, subject, markdownBody, now).run();

    const created = await db.prepare("SELECT * FROM newsletters WHERE id = ?").bind(result.meta.last_row_id).first();

    return new Response(JSON.stringify({
      success: true,
      message: `Drafted Weekly Digest #${nextIssue} successfully.`,
      newsletter: created
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
