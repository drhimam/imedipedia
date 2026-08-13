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
    return new Response(JSON.stringify({ error: "D1 database connection binding is missing." }), { status: 500 });
  }

  const user = await getSessionUser(db, request);
  if (!user || !isAdmin(user)) return new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });

  try {
    const url = new URL(request.url);
    const path = url.searchParams.get('path');
    if (!path) return new Response(JSON.stringify({ error: "Path is required." }), { status: 400 });

    const token = locals.runtime?.env?.GITHUB_TOKEN || '';
    const repo = locals.runtime?.env?.GITHUB_REPO || 'drhimam/imedipedia';

    if (!token) return new Response(JSON.stringify({ error: "GitHub token not configured." }), { status: 500 });

    const resp = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "iMedipedia" } }
    );

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch from GitHub." }), { status: 500 });
    }

    const data = await resp.json();
    const content = atob(data.content); // Decode base64
    
    return new Response(JSON.stringify({ content, sha: data.sha }), { status: 200 });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed: ${err.message}` }), { status: 500 });
  }
}

export async function POST({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) return new Response(JSON.stringify({ error: "D1 database connection binding is missing." }), { status: 500 });

  const user = await getSessionUser(db, request);
  if (!user || !isAdmin(user)) return new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });

  try {
    const body = await request.json();
    const { path, content, sha } = body;
    if (!path || !content || !sha) return new Response(JSON.stringify({ error: "Path, content, and sha are required." }), { status: 400 });

    const token = locals.runtime?.env?.GITHUB_TOKEN || '';
    const repo = locals.runtime?.env?.GITHUB_REPO || 'drhimam/imedipedia';

    if (!token) return new Response(JSON.stringify({ error: "GitHub token not configured." }), { status: 500 });

    // Encode content to base64
    const base64Content = btoa(unescape(encodeURIComponent(content)));

    const resp = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: { 
          Authorization: `Bearer ${token}`, 
          Accept: "application/vnd.github+json", 
          "User-Agent": "iMedipedia",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: `Admin update: ${path}`,
          content: base64Content,
          sha: sha
        })
      }
    );

    if (!resp.ok) {
      const errData = await resp.json();
      return new Response(JSON.stringify({ error: `GitHub API error: ${errData.message}` }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true, message: "Article republished successfully!" }), { status: 200 });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed: ${err.message}` }), { status: 500 });
  }
}
