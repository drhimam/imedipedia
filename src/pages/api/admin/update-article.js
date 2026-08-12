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

function escapeYAML(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function sanitizeBody(body) {
  if (!body) return '';
  return body.replace(/^\s*---\s*$/gm, '— — —');
}

/**
 * POST /api/admin/update-article
 * Updates an existing published article's markdown file on GitHub.
 */
export async function POST({ request, locals }) {
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

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { filePath, title, description, tags, body: articleBody, image, type, subject, topic, author, subjects } = body;

  if (!filePath) {
    return new Response(JSON.stringify({ error: "filePath is required." }), {
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

    // Get existing file SHA
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
    const existingContent = atob(existing.content);
    const decodedContent = decodeURIComponent(escape(existingContent));

    // Parse subjects from body (new format: JSON array) or fall back to old tags/subject
    let parsedSubjects = [];
    if (subjects !== undefined) {
      if (Array.isArray(subjects)) {
        parsedSubjects = subjects.map(s => String(s).trim()).filter(Boolean);
      } else if (typeof subjects === 'string') {
        try { const p = JSON.parse(subjects); parsedSubjects = Array.isArray(p) ? p.map(s => String(s).trim()).filter(Boolean) : []; } catch { parsedSubjects = []; }
      }
    } else {
      // Fallback: build from old tags + subject fields
      let oldTags = [];
      try { oldTags = typeof tags === 'string' ? JSON.parse(tags) : (Array.isArray(tags) ? tags : []); } catch { oldTags = []; }
      const oldSubject = (subject || '').trim();
      var seen = {};
      [].concat(oldTags, oldSubject ? [oldSubject] : []).forEach(function(s) {
        if (s && !seen[s.toLowerCase()]) { seen[s.toLowerCase()] = true; parsedSubjects.push(s); }
      });
    }
    const subjectsYAML = parsedSubjects.length > 0 ? `["${parsedSubjects.map(s => escapeYAML(s)).join('", "')}"]` : '[]';

    const imageValue = image && !image.startsWith('data:') ? escapeYAML(image) : '';

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const pubDate = `${yyyy}-${mm}-${dd}`;

    const frontmatter = `---
title: "${escapeYAML(title || '')}"
pubDate: ${pubDate}
description: "${escapeYAML(description || '')}"
author: "${escapeYAML(author || '')}"
type: "${escapeYAML(type || 'general')}"
subjects: ${subjectsYAML}
topic: "${escapeYAML(topic || '')}"
---

${sanitizeBody(articleBody || '')}`;

    const base64Content = btoa(unescape(encodeURIComponent(frontmatter)));

    const putResp = await fetch(
      `https://api.github.com/repos/${repo}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "iMedipedia" },
        body: JSON.stringify({
          message: `Update: ${title || 'Article'}`,
          content: base64Content,
          sha: existing.sha,
          branch: 'master',
        }),
      }
    );

    if (!putResp.ok) {
      const errText = await putResp.text();
      return new Response(JSON.stringify({ error: `GitHub update failed: ${errText}` }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Article updated successfully.",
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Update failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
