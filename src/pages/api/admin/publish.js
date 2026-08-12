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

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 80);
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
  // Escape frontmatter delimiters to prevent YAML injection
  return body.replace(/^\s*---\s*$/gm, '— — —');
}

/**
 * POST /api/admin/publish
 * Publishes an approved submission as a markdown blog post and pushes to GitHub.
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
    return new Response(JSON.stringify({ error: "Forbidden." }), {
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

  const { submissionId } = body;
  if (!submissionId) {
    return new Response(JSON.stringify({ error: "submissionId is required." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const submission = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(submissionId).first();
    if (!submission) {
      return new Response(JSON.stringify({ error: "Submission not found." }), {
        status: 404, headers: { "Content-Type": "application/json" }
      });
    }

    if (submission.status !== 'approved') {
      return new Response(JSON.stringify({ error: "Only approved submissions can be published. Current status: " + submission.status }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    // Generate markdown file path
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const filePath = `src/content/blog/${yyyy}/${mm}/${submission.slug}.md`;

    // Parse subjects from subject column (now stores JSON array)
    let subjects = [];
    try { subjects = JSON.parse(submission.subject || '[]'); } catch {
      // Fallback: old single-string subject
      if (submission.subject && typeof submission.subject === 'string' && submission.subject.trim()) {
        subjects = [submission.subject.trim()];
      } else {
        subjects = [];
      }
    }
    if (!Array.isArray(subjects)) subjects = [];
    const subjectsYAML = subjects.length > 0 ? `["${subjects.map(s => escapeYAML(s)).join('", "')}"]` : '[]';

    // Parse exams — stored as JSON array in YAML
    let exams = [];
    try { exams = JSON.parse(submission.exams || '[]'); } catch { exams = []; }
    const examsYAML = exams.length > 0 ? `["${exams.map(e => escapeYAML(e)).join('", "')}"]` : '[]';

    // Build frontmatter (skip base64 data URIs, only store R2 URLs)
    const imageValue = submission.image && !submission.image.startsWith('data:') ? escapeYAML(submission.image) : '';
    const descValue = escapeYAML(submission.description || '');
    const topicValue = escapeYAML(submission.topic || '');

    const pubDate = `${yyyy}-${mm}-${String(now.getDate()).padStart(2, '0')}`;

    const frontmatter = `---
title: "${escapeYAML(submission.title)}"
pubDate: ${pubDate}
description: "${descValue}"
author: "${escapeYAML(submission.author)}"
type: "${escapeYAML(submission.type || 'general')}"
subjects: ${subjectsYAML}
topic: "${topicValue}"
exams: ${examsYAML}
---

${sanitizeBody(submission.body || '')}`;

    // Push to GitHub
    const token = locals.runtime?.env?.GITHUB_TOKEN || '';
    const repo = locals.runtime?.env?.GITHUB_REPO || 'drhimam/imedipedia';

    if (!token) {
      return new Response(JSON.stringify({
        error: "GitHub token is not configured. Please set the GITHUB_TOKEN environment variable to enable publishing."
      }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    // Get the file SHA if it already exists (for updates)
    let sha = null;
    const getResp = await fetch(
      `https://api.github.com/repos/${repo}/contents/${filePath}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "iMedipedia" } }
    );
    if (getResp.ok) {
      const existing = await getResp.json();
      sha = existing.sha;
    } else if (getResp.status === 403 || getResp.status === 401) {
      // Read GitHub's error body for detailed diagnostics
      const errBody = await getResp.text();
      console.error('GitHub GET check failed:', getResp.status, errBody);
      let detail = '';
      try {
        const j = JSON.parse(errBody);
        detail = j.message || '';
        if (j.errors) detail += ' | ' + JSON.stringify(j.errors);
      } catch {}
      // If GitHub didn't give us a parseable message, include the raw body
      if (!detail && errBody) detail = errBody.substring(0, 200);
      return new Response(JSON.stringify({
        error: `GitHub authentication failed (${getResp.status}${detail ? ': ' + detail : ''}). Token prefix: ${token.substring(0, 8)}... Repo: ${repo}. Verify the token has read access to this repository.`
      }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

      // Encode content as base64 (handle Unicode safely)
    let base64Content;
    try {
      const encoder = new TextEncoder();
      const encoded = encoder.encode(frontmatter);
      // Convert Uint8Array to binary string safely for large content
      let binary = '';
      for (let i = 0; i < encoded.length; i++) {
        binary += String.fromCharCode(encoded[i]);
      }
      base64Content = btoa(binary);
    } catch (encErr) {
      return new Response(JSON.stringify({
        error: `Content encoding failed: ${encErr.message}`
      }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    const putBody = {
      message: `Publish: ${submission.title}`,
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
        if (errJson.errors) {
          errMsg += ' | ' + JSON.stringify(errJson.errors);
        }
      } catch {}
      // If GitHub didn't give us a parseable message, include the raw body
      if (errMsg === `GitHub ${putResp.status}` && errBody) {
        errMsg += ': ' + errBody.substring(0, 300);
      }
      console.error('GitHub PUT failed:', putResp.status, errBody);

      let guidance = '';
      if (putResp.status === 403) {
        if (errMsg.includes('Resource not accessible')) {
          guidance = ' The token does not have write access to this repository.';
        } else if (errMsg.includes('branch protection')) {
          guidance = ' Branch protection rules are blocking this push. Check your repository settings.';
        } else {
          guidance = ' Check that the token has repo scope and has not expired. Also check if branch protection is enabled on the master branch.';
        }
      } else if (putResp.status === 409 && sha) {
        guidance = ' File was modified since we read it. Try publishing again.';
      }

      return new Response(JSON.stringify({
        error: `Publishing to GitHub failed: ${errMsg}.${guidance}`
      }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }

    // Update submission status to published
    await db.prepare(
      "UPDATE submissions SET status = 'published', updated_at = ? WHERE id = ?"
    ).bind(Math.floor(Date.now() / 1000), submissionId).run();

    return new Response(JSON.stringify({
      success: true,
      message: "Article published successfully to GitHub.",
      filePath,
      repoUrl: `https://github.com/${repo}/blob/master/${filePath}`,
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Publish failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
