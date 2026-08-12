export const prerender = false;

import { marked } from 'marked';

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

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  const d = value ? new Date(value) : new Date();
  if (isNaN(d.getTime())) return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * POST /api/admin/studio/preview
 * Body: { title, description, author, pubDate, image, body }
 * Returns an HTML fragment that mirrors the live article rendering.
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
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const title = escapeHtml(body.title || 'Untitled Article');
  const description = escapeHtml(body.description || '');
  const author = escapeHtml(body.author || 'iMedipedia Editorial Board');
  const pubDate = formatDate(body.pubDate);
  const image = escapeHtml(body.image || '');
  const markdown = body.body || '';

  let html;
  try {
    html = marked.parse(markdown, { gfm: true, breaks: false });
  } catch {
    html = '<p>Could not render preview.</p>';
  }

  const fragment =
    '<article class="article-view">' +
      '<header class="article-header">' +
        `<div class="article-meta"><span>Published ${escapeHtml(pubDate)}</span><span>By ${author}</span></div>` +
        `<h1 class="article-title">${title}</h1>` +
      '</header>' +
      (image ? `<div class="article-image-container"><img src="${image}" class="article-image" alt="${title}" /></div>` : '') +
      `<div class="tldr-box"><strong>TL;DR Summary:</strong> ${description}</div>` +
      `<div class="article-body">${html}</div>` +
    '</article>';

  return new Response(JSON.stringify({ success: true, html: fragment }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
}
