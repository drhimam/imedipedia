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

    // Fetch approved or published articles across all 4 categories
    const allSubmissions = await db.prepare(
      "SELECT title, description, author, slug, type, subject, topic, created_at FROM submissions WHERE status IN ('published', 'approved') ORDER BY created_at DESC LIMIT 40"
    ).all();

    const articles = allSubmissions?.results || [];

    // Group articles by the 4 platform categories
    const generalArticles = articles.filter(a => a.type === 'general' || !a.type);
    const guidelineArticles = articles.filter(a => a.type === 'update');
    const caseArticles = articles.filter(a => a.type === 'case');
    const educationArticles = articles.filter(a => a.type === 'education');

    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const issueTitle = customTitle || `iMedipedia Weekly Clinical Digest #${nextIssue}`;
    const subject = `Weekly Digest #${nextIssue}: Top Research, Guidelines, Case Reports & CME (${dateStr})`;

    let markdownBody = `## 🩺 iMedipedia Weekly Clinical Digest #${nextIssue}\n`;
    markdownBody += `*Published on ${dateStr} • Curated by the iMedipedia Editorial Board*\n\n`;

    markdownBody += `### 💡 Executive Clinical Summary\n`;
    markdownBody += `Welcome to this week's edition of the **iMedipedia Weekly Clinical Digest**! Below is our curated multi-specialty roundup covering the latest peer-reviewed research, clinical practice guidelines, diagnostic case reports, and high-yield board review pearls.\n\n`;
    markdownBody += `---\n\n`;

    // 1. Research Digest & Review Articles (General)
    markdownBody += `### 📚 1. Research Digest & Clinical Reviews\n`;
    markdownBody += `*In-depth systematic reviews, pathophysiological insights, and breakthrough medical research.*\n\n`;
    if (generalArticles.length > 0) {
      generalArticles.slice(0, 3).forEach((art, idx) => {
        const link = `https://imedipedia.com/general?article=${art.slug}`;
        markdownBody += `#### ${idx + 1}. [${art.title}](${link})\n`;
        markdownBody += `**Author:** ${art.author || 'iMedipedia Author'} | **Subject:** ${art.subject || 'General Medicine'}\n\n`;
        markdownBody += `${art.description || 'Comprehensive clinical overview and critical analysis.'}\n\n`;
        markdownBody += `👉 [Read Full Research Article &rarr;](${link})\n\n`;
      });
    } else {
      markdownBody += `*Top general medical and physiology reviews are being indexed for this cycle. Visit the [Research Digest](https://imedipedia.com/general) to explore all published works.*\n\n`;
    }
    markdownBody += `---\n\n`;

    // 2. Clinical Guidelines & Practice Protocols (Update)
    markdownBody += `### 📋 2. Clinical Practice Guidelines & Protocols\n`;
    markdownBody += `*Evidence-based management algorithms, diagnostic criteria, and clinical practice standards.*\n\n`;
    if (guidelineArticles.length > 0) {
      guidelineArticles.slice(0, 3).forEach((art, idx) => {
        const link = `https://imedipedia.com/blog/${art.slug}`;
        markdownBody += `#### ${idx + 1}. [${art.title}](${link})\n`;
        markdownBody += `**Clinical Topic:** ${art.topic || art.subject || 'Clinical Protocol'} | **Author:** ${art.author || 'Editorial Board'}\n\n`;
        markdownBody += `${art.description || 'Summary of key recommendations and clinical practice considerations.'}\n\n`;
        markdownBody += `👉 [Access Clinical Protocol &rarr;](${link})\n\n`;
      });
    } else {
      markdownBody += `*Explore the latest evidence-based management protocols in our [Clinical Guidelines](https://imedipedia.com/clinical-guidelines) section.*\n\n`;
    }
    markdownBody += `---\n\n`;

    // 3. Interactive Case Reports (Case)
    markdownBody += `### 🔬 3. Interactive Clinical Case Reports\n`;
    markdownBody += `*Diagnostic dilemmas, rare clinical presentations, and management pearls from real patient encounters.*\n\n`;
    if (caseArticles.length > 0) {
      caseArticles.slice(0, 3).forEach((art, idx) => {
        const link = `https://imedipedia.com/blog/${art.slug}`;
        markdownBody += `#### ${idx + 1}. [${art.title}](${link})\n`;
        markdownBody += `**Presentation:** ${art.subject || 'Clinical Case'} | **Author:** ${art.author || 'Clinician Contributor'}\n\n`;
        markdownBody += `${art.description || 'Clinical history, examination findings, differential diagnosis, and outcome.'}\n\n`;
        markdownBody += `👉 [Explore Case Presentation &rarr;](${link})\n\n`;
      });
    } else {
      markdownBody += `*Review real-world patient cases and differential diagnostic pearls in our [Case Reports](https://imedipedia.com/cases) library.*\n\n`;
    }
    markdownBody += `---\n\n`;

    // 4. CME & Board Preparation (Education)
    markdownBody += `### 🎓 4. Board Review & CME Learning Pearls\n`;
    markdownBody += `*High-yield exam prep, physics principles, and CME modules for USMLE, MRCP, FRCR, and ARDMS.*\n\n`;
    if (educationArticles.length > 0) {
      educationArticles.slice(0, 3).forEach((art, idx) => {
        const link = `https://imedipedia.com/blog/${art.slug}`;
        markdownBody += `#### ${idx + 1}. [${art.title}](${link})\n`;
        markdownBody += `**Exam Relevance:** ${art.topic || art.subject || 'Board Preparation'} | **Author:** ${art.author || 'Faculty Reviewer'}\n\n`;
        markdownBody += `${art.description || 'Key concepts, board-style question rationales, and high-yield study notes.'}\n\n`;
        markdownBody += `👉 [Review Learning Module &rarr;](${link})\n\n`;
      });
    } else {
      markdownBody += `*Access board review modules and practice questions in our [CME & Education](https://imedipedia.com/education) portal.*\n\n`;
    }
    markdownBody += `---\n\n`;

    // High-Yield Board Pearl of the Week
    markdownBody += `### 🎯 High-Yield Board Question of the Week\n`;
    markdownBody += `**Question:** A 62-year-old male with chronic kidney disease (eGFR 25 mL/min) and type 2 diabetes presents with acute gout flare. What is the preferred first-line anti-inflammatory agent?\n\n`;
    markdownBody += `**Answer & Pearl:** **Oral glucocorticoids (e.g., Prednisolone)** or intra-articular steroid injection. NSAIDs and standard-dose Colchicine are contraindicated or require severe dose adjustments in advanced renal impairment (eGFR < 30 mL/min).\n\n`;
    markdownBody += `---\n\n`;

    // Customized Message / Note from Editor
    markdownBody += `### 💬 Note from the Editor\n`;
    markdownBody += `<div style="background: rgba(99, 102, 241, 0.05); border-left: 4px solid #6366f1; padding: 16px 20px; border-radius: 8px; margin: 16px 0;">\n`;
    markdownBody += `  <p style="margin:0 0 8px 0; font-weight:600; color:#4f46e5;">Dear iMedipedia Readers & Medical Community,</p>\n`;
    markdownBody += `  <p style="margin:0; font-size:14px; line-height:1.6; color:#334155;">\n`;
    markdownBody += `    Thank you for being part of our medical education and research collective. We invite physicians, residents, and researchers to submit original case reports and clinical reviews through their Author Dashboard.\n`;
    markdownBody += `  </p>\n`;
    markdownBody += `</div>\n`;

    const now = Math.floor(Date.now() / 1000);
    const result = await db.prepare(
      "INSERT INTO newsletters (issue_number, title, subject, body_md, status, created_at) VALUES (?, ?, ?, ?, 'draft', ?)"
    ).bind(nextIssue, issueTitle, subject, markdownBody, now).run();

    const created = await db.prepare("SELECT * FROM newsletters WHERE id = ?").bind(result.meta.last_row_id).first();

    return new Response(JSON.stringify({
      success: true,
      message: `Drafted 4-Category Weekly Digest #${nextIssue} successfully.`,
      newsletter: created
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
