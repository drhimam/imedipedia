export const prerender = false;

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

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function normalizeTags(value) {
  if (!value) return '[]';
  if (Array.isArray(value)) return JSON.stringify(value.map(t => String(t).trim()).filter(Boolean));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return JSON.stringify(parsed.map(t => String(t).trim()).filter(Boolean));
    } catch {}
    // Comma-separated string
    return JSON.stringify(value.split(',').map(t => t.trim()).filter(Boolean));
  }
  return '[]';
}

function normalizeExams(value) {
  if (!value) return '[]';
  if (Array.isArray(value)) return JSON.stringify(value.map(e => String(e).trim()).filter(Boolean));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return JSON.stringify(parsed.map(e => String(e).trim()).filter(Boolean));
    } catch {}
    // Comma-separated string
    return JSON.stringify(value.split(',').map(e => e.trim()).filter(Boolean));
  }
  return '[]';
}

/**
 * POST /api/submissions/create
 * Body: { title, description, body, tags, type, subject, topic, exams, image, intextImages }
 */
export async function POST({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "D1 database connection binding is missing." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  const user = await getSessionUser(db, request);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized. Please log in." }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

  if (user.role !== 'contributor' && user.role !== 'admin' && user.role !== 'co-admin') {
    return new Response(JSON.stringify({ error: "Only contributors can submit articles." }), {
      status: 403, headers: { "Content-Type": "application/json" }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { title, description, tags, type, subject, topic, exams, image, intextImages } = body;
  const articleBody = body.body || '';

  if (!title || !description || !articleBody) {
    return new Response(JSON.stringify({ error: "Title, description, and body are required." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  // Author is always the logged-in user's full name
  const author = user.full_name || user.username;

  try {
    const now = Math.floor(Date.now() / 1000);
    const datePath = new Date().toISOString().slice(0, 7).replace('-', '/'); // e.g. "2026/08"
    const slug = `${slugify(title)}`;

    const result = await db.prepare(
      `INSERT INTO submissions (user_id, title, slug, description, author, tag, type, subject, topic, exams, image, body, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).bind(
      user.id,
      title.trim(),
      slug,
      description.trim(),
      author,
      normalizeTags(tags),
      (type || 'general').trim(),
      (subject || '').trim(),
      (topic || '').trim(),
      normalizeExams(exams),
      (image || '').trim(),
      articleBody,
      now,
      now
    ).run();

    return new Response(JSON.stringify({
      success: true,
      id: result.meta?.last_row_id || null,
      slug,
      message: "Your article has been submitted for review.",
    }), {
      status: 201, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Submission failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
