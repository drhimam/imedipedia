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

  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit')) || 10));
    const offset = (page - 1) * limit;

    const token = locals.runtime?.env?.GITHUB_TOKEN || '';
    const repo = locals.runtime?.env?.GITHUB_REPO || 'drhimam/imedipedia';

    if (!token) {
      return new Response(JSON.stringify({ articles: [], message: "GitHub token not configured." }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    // Use Git Trees API to get all files recursively
    const resp = await fetch(
      `https://api.github.com/repos/${repo}/git/trees/main?recursive=1`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "iMedipedia" } }
    );

    if (!resp.ok) {
      return new Response(JSON.stringify({ articles: [], message: "Failed to fetch tree from GitHub." }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    const treeData = await resp.json();
    let allArticles = (treeData.tree || [])
      .filter(item => item.type === 'blob' && item.path.startsWith('src/content/blog/') && item.path.endsWith('.md'))
      .map(item => ({
        name: item.path.split('/').pop(),
        path: item.path,
        sha: item.sha,
        url: `https://github.com/${repo}/blob/main/${item.path}`
      }));

    if (q) {
      allArticles = allArticles.filter(a => a.name.toLowerCase().includes(q) || a.path.toLowerCase().includes(q));
    }

    allArticles.sort((a, b) => b.path.localeCompare(a.path)); // Sort descending by path (often contains date)

    const total = allArticles.length;
    const totalPages = Math.ceil(total / limit);
    const paginatedArticles = allArticles.slice(offset, offset + limit);

    return new Response(JSON.stringify({ 
      articles: paginatedArticles,
      pagination: { total, page, limit, totalPages }
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
