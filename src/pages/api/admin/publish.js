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

    // Generate markdown file path
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const filePath = `src/content/blog/${yyyy}/${mm}/${submission.slug}.md`;

    // Parse tags
    let tags = [];
    try { tags = JSON.parse(submission.tag || '[]'); } catch { tags = []; }
    const tagsYAML = tags.length > 0 ? `["${tags.map(t => escapeYAML(t)).join('", "')}"]` : '[]';

    // Parse exams
    let exams = [];
    try { exams = JSON.parse(submission.exams || '[]'); } catch { exams = []; }
    const examsYAML = exams.length > 0 ? `["${exams.map(e => escapeYAML(e)).join('", "')}"]` : '[]';

    // Build frontmatter (skip base64 data URIs, only store R2 URLs)
    const imageValue = submission.image && !submission.image.startsWith('data:') ? escapeYAML(submission.image) : '';

    const frontmatter = `---
title: "${escapeYAML(submission.title)}"
date: "${now.toISOString()}"
author: "${escapeYAML(submission.author)}"
description: "${escapeYAML(submission.description)}"
image: "${imageValue}"
tags: ${tagsYAML}
category: "${escapeYAML(submission.type || 'general')}"
subject: "${escapeYAML(submission.subject || '')}"
topic: "${escapeYAML(submission.topic || '')}"
exams: ${examsYAML}
type: "article"
---

${sanitizeBody(submission.body || '')}`;

    // Update submission status
    await db.prepare(
      "UPDATE submissions SET status = 'published', updated_at = ? WHERE id = ?"
    ).bind(Math.floor(Date.now() / 1000), submissionId).run();

    // Push to GitHub
    const token = locals.runtime?.env?.GITHUB_TOKEN || '';
    const repo = locals.runtime?.env?.GITHUB_REPO || 'drhimam/imedipedia';

    if (token) {
      try {
        // Get the file SHA if it already exists
        let sha = null;
        const getResp = await fetch(
          `https://api.github.com/repos/${repo}/contents/${filePath}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
        );
        if (getResp.ok) {
          const existing = await getResp.json();
          sha = existing.sha;
        }

        const base64Content = btoa(unescape(encodeURIComponent(frontmatter)));
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
            headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
            body: JSON.stringify(putBody),
          }
        );

        if (!putResp.ok) {
          console.error('GitHub push failed:', await putResp.text());
        }
      } catch (ghErr) {
        console.error('GitHub API error:', ghErr.message);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Article published successfully.",
      filePath,
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Publish failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
