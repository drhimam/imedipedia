export const prerender = false;

import { generateImage } from '../../../../lib/ai.js';

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

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function buildCoverPrompt({ prompt, title, topic }) {
  if (prompt && prompt.trim()) return prompt.trim();
  const subject = (title || '').trim() || (topic || '').trim() || 'medical science';
  return (
    'A clean, professional editorial cover illustration for a medical article titled "' + subject + '". ' +
    'Modern flat medical illustration, teal (#0d9488) and deep navy palette, minimal, high-quality, ' +
    'no text, no words, no watermark.'
  );
}

/**
 * POST /api/admin/studio/cover
 * Body: { prompt?, title?, topic? }
 * Calls the configured image API and returns the generated image as a base64 data URI.
 * The client downscales + encodes to AVIF (native canvas) and uploads to R2.
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

  try {
    const generated = await generateImage(env, buildCoverPrompt(input));

    // Provider returned a hosted URL — fetch it and convert to a data URI.
    if (generated.url) {
      const resp = await fetch(generated.url);
      if (!resp.ok) {
        return new Response(JSON.stringify({ error: `Could not download generated image (HTTP ${resp.status}).` }), {
          status: 502, headers: { "Content-Type": "application/json" }
        });
      }
      const contentType = resp.headers.get('content-type') || 'image/png';
      const buf = await resp.arrayBuffer();
      const dataUri = `data:${contentType};base64,${arrayBufferToBase64(buf)}`;
      return new Response(JSON.stringify({ success: true, imageData: dataUri }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    // Provider returned b64_json directly.
    const mime = generated.mime || 'image/png';
    const dataUri = `data:${mime};base64,${generated.data}`;
    return new Response(JSON.stringify({ success: true, imageData: dataUri }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Cover generation failed: ${err.message}` }), {
      status: 502, headers: { "Content-Type": "application/json" }
    });
  }
}
