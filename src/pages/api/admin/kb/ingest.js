export const prerender = false;

import { ingestSource, fetchUrlText } from '../../../../lib/kb.js';

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
 * Decode a value that may be a data URI (data:...;base64,XXXX) or plain text.
 */
function decodeTextContent(value) {
  if (!value || typeof value !== 'string') return '';
  const m = value.match(/^data:([^;]*);base64,(.*)$/is);
  if (m) {
    try {
      const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      throw new Error('Could not decode base64 file content.');
    }
  }
  return value;
}

/**
 * Run a Tavily web search and return [{ title, url, content }].
 */
async function tavilySearch(env, query, maxResults) {
  const apiKey = env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('Web search is not configured (set TAVILY_API_KEY).');
  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: Math.min(Math.max(maxResults || 5, 1), 10),
      include_answer: false,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Tavily search failed: HTTP ${resp.status} ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data.results || []).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    content: r.content || '',
  }));
}

/**
 * POST /api/admin/kb/ingest
 * Body variants by `type`:
 *   { type: 'text',   title?, text }
 *   { type: 'url',    urls: string[] }
 *   { type: 'file',   title?, filename?, content }  // .txt/.md content or base64 data URI
 *   { type: 'search', query, maxResults? }
 * Returns { success, ingested: [{title, sourceUrl, chunks, alreadyExists}] }
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

  let input;
  try {
    input = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const env = locals.runtime?.env || {};
  const type = input.type || 'text';
  const createdBy = user.id;
  const sources = []; // { title, sourceUrl, text }

  try {
    if (type === 'text') {
      if (!(input.text || '').trim()) {
        return new Response(JSON.stringify({ error: "Provide text to ingest." }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }
      sources.push({ title: input.title || 'Pasted text', sourceUrl: '', text: input.text });
    } else if (type === 'url') {
      const urls = Array.isArray(input.urls) ? input.urls : (input.url ? [input.url] : []);
      if (!urls.length) {
        return new Response(JSON.stringify({ error: "Provide at least one URL to ingest." }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }
      for (const u of urls) {
        if (!u || typeof u !== 'string') continue;
        const text = await fetchUrlText(u.trim());
        if (!text.trim()) continue;
        sources.push({ title: '', sourceUrl: u.trim(), text });
      }
    } else if (type === 'file') {
      const filename = (input.filename || '').toLowerCase();
      if (filename && !/\.(txt|md|markdown)$/.test(filename)) {
        return new Response(JSON.stringify({ error: "Only .txt and .md files are supported." }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }
      const text = decodeTextContent(input.content);
      if (!text.trim()) {
        return new Response(JSON.stringify({ error: "File content is empty." }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }
      sources.push({ title: input.title || input.filename || 'Uploaded file', sourceUrl: '', text });
    } else if (type === 'search') {
      if (!(input.query || '').trim()) {
        return new Response(JSON.stringify({ error: "Provide a search query." }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }
      const results = await tavilySearch(env, input.query.trim(), input.maxResults);
      for (const r of results) {
        if (r.content && r.content.trim()) {
          sources.push({ title: r.title, sourceUrl: r.url, text: r.content.trim() });
        }
      }
      if (!sources.length) {
        return new Response(JSON.stringify({ error: "Search returned no usable results." }), {
          status: 502, headers: { "Content-Type": "application/json" }
        });
      }
    } else {
      return new Response(JSON.stringify({ error: "Unknown source type. Use text, url, file, or search." }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    const ingested = [];
    for (const s of sources) {
      const result = await ingestSource(env, db, {
        type,
        title: s.title,
        sourceUrl: s.sourceUrl,
        text: s.text,
        createdBy,
      });
      ingested.push({
        title: s.title || s.sourceUrl || '(untitled)',
        sourceUrl: s.sourceUrl || '',
        sourceId: result.sourceId,
        chunks: result.chunks,
        alreadyExists: result.alreadyExists,
      });
    }

    return new Response(JSON.stringify({ success: true, ingested }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Ingestion failed: ${err.message}` }), {
      status: 502, headers: { "Content-Type": "application/json" }
    });
  }
}
