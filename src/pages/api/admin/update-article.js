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

function parseYamlValue(raw) {
  const val = (raw || '').trim();
  if (!val) return '';
  const quoted = val.match(/^"([\s\S]*)"$/) || val.match(/^'([\s\S]*)'$/);
  if (quoted) return quoted[1];
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

// Extract frontmatter key/values from existing markdown so edits preserve fields
// the client did not send (pubDate, subjects, exams, author, type, topic, image).
function parseFrontmatter(markdown) {
  const result = { title: '', description: '', author: '', type: '', topic: '', subjects: [], exams: [], pubDate: '', image: '', body: '' };
  if (!markdown) return result;
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) { result.body = markdown; return result; }
  result.body = match[2] || '';
  match[1].split(/\r?\n/).forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const value = parseYamlValue(line.slice(idx + 1).trim());
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

  const { filePath, title, description, tags, body: articleBody, image, type, subject, topic, author, subjects, exams, pubDate: providedPubDate } = body;

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

    // Preserve fields the client did not send by parsing the existing frontmatter
    const existingFm = parseFrontmatter(decodedContent);

    // Parse subjects from body (new format: JSON array) or fall back to old tags/subject/existing
    let parsedSubjects = [];
    if (subjects !== undefined) {
      if (Array.isArray(subjects)) {
        parsedSubjects = subjects.map(s => String(s).trim()).filter(Boolean);
      } else if (typeof subjects === 'string') {
        try { const p = JSON.parse(subjects); parsedSubjects = Array.isArray(p) ? p.map(s => String(s).trim()).filter(Boolean) : []; } catch { parsedSubjects = []; }
      }
    } else {
      // Fallback: build from old tags + subject fields + existing frontmatter subjects
      let oldTags = [];
      try { oldTags = typeof tags === 'string' ? JSON.parse(tags) : (Array.isArray(tags) ? tags : []); } catch { oldTags = []; }
      const oldSubject = (subject || '').trim();
      var seen = {};
      [].concat(oldTags, oldSubject ? [oldSubject] : [], Array.isArray(existingFm.subjects) ? existingFm.subjects : []).forEach(function(s) {
        if (s && !seen[s.toLowerCase()]) { seen[s.toLowerCase()] = true; parsedSubjects.push(s); }
      });
    }
    const subjectsYAML = parsedSubjects.length > 0 ? `["${parsedSubjects.map(s => escapeYAML(s)).join('", "')}"]` : '[]';

    // Parse exams from body (new) or preserve existing frontmatter exams
    let parsedExams = [];
    if (exams !== undefined) {
      if (Array.isArray(exams)) {
        parsedExams = exams.map(e => String(e).trim()).filter(Boolean);
      } else if (typeof exams === 'string') {
        try { const p = JSON.parse(exams); parsedExams = Array.isArray(p) ? p.map(e => String(e).trim()).filter(Boolean) : []; } catch { parsedExams = []; }
      }
    } else {
      parsedExams = Array.isArray(existingFm.exams) ? existingFm.exams.map(e => String(e).trim()).filter(Boolean) : [];
    }
    const examsYAML = parsedExams.length > 0 ? `["${parsedExams.map(e => escapeYAML(e)).join('", "')}"]` : '[]';

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    // Preserve original pubDate on edit unless explicitly overridden
    const pubDate = providedPubDate || existingFm.pubDate || `${yyyy}-${mm}-${dd}`;

    const finalTitle = title || existingFm.title || '';
    const finalDescription = (description !== undefined && description !== '') ? description : existingFm.description;
    const finalAuthor = author || existingFm.author || '';
    const finalType = type || existingFm.type || 'general';
    const finalTopic = (topic !== undefined && topic !== '') ? topic : existingFm.topic;

    const frontmatter = `---
title: "${escapeYAML(finalTitle)}"
pubDate: ${pubDate}
description: "${escapeYAML(finalDescription)}"
author: "${escapeYAML(finalAuthor)}"
type: "${escapeYAML(finalType)}"
subjects: ${subjectsYAML}
topic: "${escapeYAML(finalTopic)}"
exams: ${examsYAML}
---

${sanitizeBody(articleBody || '')}`;

    const base64Content = btoa(unescape(encodeURIComponent(frontmatter)));

    const putResp = await fetch(
      `https://api.github.com/repos/${repo}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "iMedipedia" },
        body: JSON.stringify({
          message: `Update: ${finalTitle || 'Article'}`,
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
