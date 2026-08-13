export const prerender = false;

import { fetchUrlText, extractTextFromHtml } from '../../../../lib/kb.js';

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

const MAX_CHARS = 50000;

/**
 * Extract a YouTube video ID from various URL formats.
 * Supports: youtube.com/watch?v=X, youtu.be/X, youtube.com/embed/X, etc.
 */
function extractYouTubeVideoId(url) {
  if (!url) return null;
  // youtu.be/VIDEO_ID
  let m = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  // youtube.com/watch?v=VIDEO_ID
  m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  // youtube.com/embed/VIDEO_ID or youtube.com/v/VIDEO_ID
  m = url.match(/\/(?:embed|v)\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  // youtube.com/shorts/VIDEO_ID
  m = url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  return null;
}

/**
 * Fetch YouTube transcript from youtube-transcript.ai (free, no API key).
 */
async function fetchYouTubeTranscript(videoId) {
  const resp = await fetch(`https://youtube-transcript.ai/transcript/${videoId}.txt`, {
    headers: { 'User-Agent': 'iMedipedia-Studio/1.0' },
  });
  if (!resp.ok) {
    throw new Error(`YouTube transcript not available (HTTP ${resp.status}). The video may not have captions.`);
  }
  const text = await resp.text();
  if (!text || !text.trim()) {
    throw new Error('YouTube transcript is empty — the video may not have captions.');
  }
  return text.trim();
}

/**
 * Extract text from a document/image via Mistral OCR API.
 * Accepts base64 data URIs for both images and documents.
 */
async function mistralOcr(env, filename, base64DataUri) {
  const apiKey = env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('Document OCR is not configured (set MISTRAL_API_KEY in environment variables).');
  }

  // Determine if this is an image or a document
  const mimeMatch = base64DataUri.match(/^data:([^;]+);/);
  const mime = mimeMatch ? mimeMatch[1] : '';
  const isImage = mime.startsWith('image/');

  const docType = isImage ? 'image_url' : 'document_url';
  const document = { type: docType, [docType]: base64DataUri };

  const resp = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'mistral-ocr-latest',
      document,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Mistral OCR failed (HTTP ${resp.status}): ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();
  if (!data.pages || !data.pages.length) {
    throw new Error('Mistral OCR returned no pages — the file may be empty or unsupported.');
  }

  // Concatenate all pages' markdown content
  const text = data.pages
    .map((p) => (p.markdown || '').trim())
    .filter(Boolean)
    .join('\n\n---\n\n');

  return text;
}

/**
 * Extract the <title> tag from HTML before stripping it.
 */
function extractHtmlTitle(html) {
  if (!html) return '';
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : '';
}

/**
 * POST /api/admin/studio/extract-content
 *
 * Body variants by `type`:
 *   { type: "url",     url: "https://..." }
 *   { type: "youtube", videoId: "dQw4w9WgXcQ" }
 *                 — or { type: "youtube", url: "https://youtube.com/watch?v=..." }
 *   { type: "ocr",     filename: "paper.pdf", content: "data:...;base64,..." }
 *
 * Returns: { success, title, text, charCount }  or  { success: false, error, fallback? }
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
  const type = input.type || '';

  try {
    let title = '';
    let text = '';

    if (type === 'url') {
      const url = (input.url || '').trim();
      if (!url) {
        return new Response(JSON.stringify({ error: "Provide a URL." }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }

      // Fetch the raw HTML first to extract <title>, then get the plain text
      try {
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'iMedipedia-Studio/1.0 (+https://imedipedia.com)' },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const html = await resp.text();
        title = extractHtmlTitle(html) || url;
        text = extractTextFromHtml(html);
      } catch (fetchErr) {
        // Fallback to kb.js fetchUrlText which handles its own error messages
        text = await fetchUrlText(url);
        title = url;
      }

      if (!text.trim()) {
        return new Response(JSON.stringify({ error: "Could not extract text from this URL." }), {
          status: 422, headers: { "Content-Type": "application/json" }
        });
      }

    } else if (type === 'youtube') {
      // Accept either a videoId or a full URL
      let videoId = input.videoId || '';
      if (!videoId && input.url) {
        videoId = extractYouTubeVideoId(input.url);
      }
      if (!videoId) {
        return new Response(JSON.stringify({ error: "Could not parse a YouTube video ID from the URL." }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }

      try {
        text = await fetchYouTubeTranscript(videoId);
        title = `YouTube: ${videoId}`;
      } catch (ytErr) {
        // Signal that the client should show the fallback paste area
        return new Response(JSON.stringify({
          success: false,
          error: ytErr.message,
          fallback: true,
          videoId,
        }), {
          status: 422, headers: { "Content-Type": "application/json" }
        });
      }

    } else if (type === 'ocr') {
      const content = (input.content || '').trim();
      const filename = (input.filename || 'document').trim();
      if (!content) {
        return new Response(JSON.stringify({ error: "Provide file content (base64 data URI)." }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }

      text = await mistralOcr(env, filename, content);
      title = filename;

      if (!text.trim()) {
        return new Response(JSON.stringify({ error: "OCR returned no text — the file may be empty or contain only images without readable text." }), {
          status: 422, headers: { "Content-Type": "application/json" }
        });
      }

    } else {
      return new Response(JSON.stringify({ error: "Unknown type. Use 'url', 'youtube', or 'ocr'." }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    // Truncate to per-item cap
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS);
    }

    return new Response(JSON.stringify({
      success: true,
      title,
      text,
      charCount: text.length,
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Extraction failed: ${err.message}` }), {
      status: 502, headers: { "Content-Type": "application/json" }
    });
  }
}
