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

/**
 * POST /api/admin/subjects-save
 * Saves the entire subjects JSON array to GitHub (src/data/subjects.json).
 * Only admins and co-admins can use this.
 *
 * Body: { subjects: [{ name, parent }, ...] }
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
    return new Response(JSON.stringify({ error: "Unauthorized." }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: "Forbidden. Admin access required." }), {
      status: 403, headers: { "Content-Type": "application/json" }
    });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { subjects } = body;
  if (!Array.isArray(subjects)) {
    return new Response(JSON.stringify({ error: "subjects must be an array of { name, parent } objects." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  // Validate each entry
  for (const s of subjects) {
    if (!s.name || typeof s.name !== 'string') {
      return new Response(JSON.stringify({ error: "Each subject must have a 'name' string." }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }
  }

  const filePath = "src/data/subjects.json";
  const content = JSON.stringify(subjects, null, 2) + '\n';

  try {
    const token = locals.runtime?.env?.GITHUB_TOKEN || '';
    const repo = locals.runtime?.env?.GITHUB_REPO || 'drhimam/imedipedia';

    if (!token) {
      return new Response(JSON.stringify({
        error: "GitHub token is not configured."
      }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    // Get current file SHA
    let sha = null;
    const getResp = await fetch(
      `https://api.github.com/repos/${repo}/contents/${filePath}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "iMedipedia" } }
    );

    if (getResp.ok) {
      const existing = await getResp.json();
      sha = existing.sha;
    } else if (getResp.status === 403 || getResp.status === 401) {
      const errBody = await getResp.text();
      let detail = '';
      try { const j = JSON.parse(errBody); detail = j.message || ''; } catch {}
      return new Response(JSON.stringify({
        error: `GitHub authentication failed (${getResp.status}${detail ? ': ' + detail : ''}).`
      }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    // Encode as base64
    const encoder = new TextEncoder();
    const encoded = encoder.encode(content);
    let binary = '';
    for (let i = 0; i < encoded.length; i++) {
      binary += String.fromCharCode(encoded[i]);
    }
    const base64Content = btoa(binary);

    const putBody = {
      message: `Update subject taxonomy (${subjects.length} subjects)`,
      content: base64Content,
      branch: 'master',
    };
    if (sha) putBody.sha = sha;

    const putResp = await fetch(
      `https://api.github.com/repos/${repo}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "iMedipedia",
        },
        body: JSON.stringify(putBody),
      }
    );

    if (!putResp.ok) {
      const errBody = await putResp.text();
      let errMsg = `GitHub ${putResp.status}`;
      try {
        const errJson = JSON.parse(errBody);
        errMsg = errJson.message || errMsg;
      } catch {}
      return new Response(JSON.stringify({
        error: `Failed to save subjects: ${errMsg}`
      }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Subject taxonomy saved (${subjects.length} subjects). Deploying to Cloudflare...`,
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Save failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
