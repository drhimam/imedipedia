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

function isAdmin(user) {
  return user && (user.role === 'admin' || user.role === 'co-admin');
}

// Parse a single YAML scalar/array value from the frontmatter line.
function parseYamlValue(raw) {
  const val = (raw || '').trim();
  if (!val) return '';
  // Quoted string
  const quoted = val.match(/^"([\s\S]*)"$/) || val.match(/^'([\s\S]*)'$/);
  if (quoted) return quoted[1];
  // Inline JSON-ish array: ["a", "b"]
  if (val.startsWith('[') && val.endsWith(']')) {
    try {
      const arr = JSON.parse(val);
      return Array.isArray(arr) ? arr : val;
    } catch {
      return val;
    }
  }
  return val;
}

// Extract the YAML frontmatter object and body from a markdown string.
function parseFrontmatter(markdown) {
  const result = {
    title: '', description: '', author: '', type: '', topic: '',
    subjects: [], exams: [], pubDate: '', image: '', body: '',
  };
  if (!markdown) return result;

  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    result.body = markdown;
    return result;
  }

  const fm = match[1];
  result.body = match[2] || '';

  // Parse key: value lines (naive — sufficient for our controlled frontmatter)
  fm.split(/\r?\n/).forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    const value = parseYamlValue(rawValue);
    switch (key) {
      case 'title': result.title = typeof value === 'string' ? value : ''; break;
      case 'description': result.description = typeof value === 'string' ? value : ''; break;
      case 'author': result.author = typeof value === 'string' ? value : ''; break;
      case 'type': result.type = typeof value === 'string' ? value : ''; break;
      case 'topic': result.topic = typeof value === 'string' ? value : ''; break;
      case 'pubDate': result.pubDate = typeof value === 'string' ? value : ''; break;
      case 'image': result.image = typeof value === 'string' ? value : ''; break;
      case 'subjects': result.subjects = Array.isArray(value) ? value.map(String) : (value ? [String(value)] : []); break;
      case 'exams': result.exams = Array.isArray(value) ? value.map(String) : (value ? [String(value)] : []); break;
    }
  });

  return result;
}

/**
 * GET /api/admin/article-content?path=<github path>
 * Fetches a published article's raw markdown from GitHub and returns its
 * parsed frontmatter + body for editing in the admin dashboard.
 */
export async function GET({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "D1 database connection binding is missing." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  const user = await getSessionUser(db, request);
  if (!user || !isAdmin(user)) {
    return new Response(JSON.stringify({ error: "Forbidden." }), {
      status: 403, headers: { "Content-Type": "application/json" }
    });
  }

  const url = new URL(request.url);
  const filePath = url.searchParams.get('path');
  if (!filePath) {
    return new Response(JSON.stringify({ error: "Missing 'path' query parameter." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const token = locals.runtime?.env?.GITHUB_TOKEN || '';
    const repo = locals.runtime?.env?.GITHUB_REPO || 'drhimam/imedipedia';

    if (!token) {
      return new Response(JSON.stringify({ error: "GitHub token not configured." }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    const getResp = await fetch(
      `https://api.github.com/repos/${repo}/contents/${filePath}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "iMedipedia" } }
    );

    if (!getResp.ok) {
      return new Response(JSON.stringify({ error: "Article file not found on GitHub." }), {
        status: 404, headers: { "Content-Type": "application/json" }
      });
    }

    const existing = await getResp.json();
    const rawContent = atob(existing.content);
    const decodedContent = decodeURIComponent(escape(rawContent));

    const parsed = parseFrontmatter(decodedContent);

    return new Response(JSON.stringify({
      success: true,
      title: parsed.title,
      description: parsed.description,
      author: parsed.author,
      type: parsed.type,
      topic: parsed.topic,
      subjects: parsed.subjects,
      exams: parsed.exams,
      pubDate: parsed.pubDate,
      image: parsed.image,
      body: parsed.body,
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
