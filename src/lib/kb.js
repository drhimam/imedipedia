// Shared knowledge-base helpers for the RAG / evidence-grounding pipeline.
//
// Storage is D1-backed (kb_sources + kb_chunks); embeddings are stored as JSON
// arrays in the kb_chunks.embedding column and retrieval is brute-force cosine
// similarity over all chunks — fine for a small/medium corpus.

import { embed } from './ai.js';

/**
 * Deterministic 32-bit FNV-1a hash, used to dedupe identical sources.
 */
export function hashContent(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Cosine similarity between two equal-length numeric vectors.
 */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Split text into overlapping chunks of roughly maxChars (≈600 tokens at 4 chars/token).
 * Splits on paragraph boundaries first, then hard-splits oversized paragraphs.
 */
export function chunkText(text, { maxChars = 2400, overlapChars = 200 } = {}) {
  const clean = (text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  const paras = clean.split(/\n{2,}/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean);

  const chunks = [];
  let buf = '';
  for (const p of paras) {
    const candidate = buf ? buf + '\n\n' + p : p;
    if (candidate.length <= maxChars) {
      buf = candidate;
      continue;
    }
    if (buf) { chunks.push(buf); buf = ''; }
    let rest = p;
    while (rest.length > maxChars) {
      chunks.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars - overlapChars);
    }
    if (rest.trim()) buf = rest;
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter((c) => c.trim().length >= 60);
}

/**
 * Convert an HTML document/string into plain text (best-effort, no deps).
 */
export function extractTextFromHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Fetch a URL and return its plain text.
 */
export async function fetchUrlText(url, { maxBytes = 2 * 1024 * 1024 } = {}) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'iMedipedia-RAG/1.0 (+https://imedipedia.com)' },
  });
  if (!resp.ok) throw new Error(`Could not fetch ${url} (HTTP ${resp.status}).`);
  const contentType = resp.headers.get('content-type') || '';
  const buf = await resp.arrayBuffer();
  if (buf.byteLength > maxBytes) {
    throw new Error(`Page too large (${(buf.byteLength / 1024 / 1024).toFixed(1)}MB).`);
  }
  const text = new TextDecoder('utf-8').decode(buf);
  if (contentType.includes('text/html') || /<\/?[a-z][\s\S]*>/i.test(text)) {
    return extractTextFromHtml(text);
  }
  return text;
}

/**
 * Embed text via the configured provider (reuses the chat provider's base URL/key).
 */
export function embedText(env, text) {
  return embed(env, text);
}

/**
 * Ingest a single source: dedupe by content hash, chunk, embed, and store.
 * Returns { alreadyExists, sourceId, chunks }.
 */
export async function ingestSource(env, db, { type, title, sourceUrl, text, createdBy }) {
  const content = (text || '').trim();
  if (!content) throw new Error('No content to ingest.');

  const hash = hashContent(content);
  const existing = await db.prepare('SELECT id FROM kb_sources WHERE content_hash = ?').bind(hash).first();
  if (existing) {
    return { alreadyExists: true, sourceId: existing.id, chunks: 0 };
  }

  const now = Math.floor(Date.now() / 1000);
  const srcRes = await db.prepare(
    `INSERT INTO kb_sources (type, title, source_url, content_hash, meta, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(type, (title || '').trim(), (sourceUrl || '').trim(), hash, '{}', createdBy || null, now).run();
  const sourceId = srcRes.meta?.last_row_id || null;

  const chunks = chunkText(content);
  const insertStmt = await db.prepare(
    `INSERT INTO kb_chunks (source_id, chunk_index, text, token_count, embedding) VALUES (?, ?, ?, ?, ?)`
  );

  let chunkCount = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    let embeddingStr = '';
    try {
      const vec = await embedText(env, c);
      if (Array.isArray(vec) && vec.length) embeddingStr = JSON.stringify(vec);
    } catch (err) {
      // Store the chunk without an embedding; retrieval will skip it.
      console.warn('kb embed failed for chunk', i, err.message);
    }
    await insertStmt.bind(sourceId, i, c, Math.ceil(c.length / 4), embeddingStr).run();
    chunkCount++;
  }

  return { alreadyExists: false, sourceId, chunks: chunkCount };
}

/**
 * Embed a query and return the top-K most similar chunks across the whole KB.
 * Returns [{ id, sourceId, text, title, sourceUrl, score }].
 */
export async function retrieveChunks(env, db, query, topK = 5) {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) return [];

  const queryVec = await embedText(env, cleanQuery);

  const rows = await db.prepare(
    `SELECT c.id, c.text, c.embedding, c.source_id, s.title, s.source_url
     FROM kb_chunks c JOIN kb_sources s ON c.source_id = s.id`
  ).all();

  const scored = [];
  for (const row of rows.results || []) {
    let vec = null;
    try { vec = JSON.parse(row.embedding); } catch {}
    if (!Array.isArray(vec) || vec.length === 0) continue;
    scored.push({
      id: row.id,
      sourceId: row.source_id,
      text: row.text,
      title: row.title || '',
      sourceUrl: row.source_url || '',
      score: cosineSimilarity(queryVec, vec),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
