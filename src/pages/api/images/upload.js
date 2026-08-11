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

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateShortId() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
}

// Allowed image types and max size
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 1 * 1024 * 1024; // 1MB
const EXT_MAP = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/**
 * Get the public URL for a given key.
 */
function getPublicUrl(env, key) {
  const publicUrl = env.R2_PUBLIC_URL || '';
  if (publicUrl) {
    return `${publicUrl.replace(/\/$/, '')}/${key}`;
  }
  return `/api/images/${key}`;
}

/**
 * Upload a buffer to R2.
 * Priority: native R2 binding (Cloudflare Workers/Pages) → S3 SDK (local dev) → skip
 */
async function putR2Object(env, key, body, contentType) {
  // 1) Native R2 binding — available in wrangler dev and Cloudflare Workers/Pages
  const r2Binding = env.IMAGES;
  if (r2Binding && typeof r2Binding.put === 'function') {
    await r2Binding.put(key, body, {
      httpMetadata: { contentType },
      customMetadata: { uploadedAt: new Date().toISOString() },
    });
    return true;
  }

  // 2) S3-compatible R2 API via @aws-sdk/client-s3
  const accountId = env.R2_ACCOUNT_ID || '81d2ff7d82745af438ec32fd05c824d8';
  const accessKeyId = env.R2_ACCESS_KEY_ID || '';
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY || '';

  if (accessKeyId && secretAccessKey) {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    await client.send(new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME || 'imedipedia-images',
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    return true;
  }

  // 3) Neither binding nor S3 credentials — skip upload
  return false;
}

/**
 * POST /api/images/upload
 * Accepts JSON: { file: base64_data, name, description, folder }
 * folder: 'covers' | 'inline' | 'uploads' (default: 'uploads')
 *
 * Returns: { success, url, key, id }
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
    return new Response(JSON.stringify({ error: "Unauthorized. Please log in." }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { file, name, description, folder } = body;

  if (!file) {
    return new Response(JSON.stringify({ error: "No file data provided." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  // Parse base64 data URI
  const dataUriMatch = file.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!dataUriMatch) {
    return new Response(JSON.stringify({ error: "Invalid file format. Must be a base64 data URI." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const contentType = dataUriMatch[1];
  const base64Data = dataUriMatch[2];

  if (!ALLOWED_TYPES.includes(contentType)) {
    return new Response(JSON.stringify({
      error: `Unsupported file type: ${contentType}. Allowed: ${ALLOWED_TYPES.join(', ')}`
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Decode base64
  let fileBuffer;
  try {
    fileBuffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  } catch {
    return new Response(JSON.stringify({ error: "Invalid base64 encoding." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  // Check size
  if (fileBuffer.byteLength > MAX_SIZE) {
    return new Response(JSON.stringify({
      error: `File too large: ${(fileBuffer.byteLength / 1024).toFixed(1)}KB. Maximum is 1MB.`
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const env = locals.runtime?.env || {};

    // Generate unique key
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const slugName = slugify(name || 'image');
    const ext = EXT_MAP[contentType] || '.png';
    const imageFolder = folder || 'uploads';
    const uniqueId = generateShortId();
    const key = `${imageFolder}/${yyyy}/${mm}/${uniqueId}-${slugName}${ext}`;

    // Upload to R2
    const uploaded = await putR2Object(env, key, fileBuffer, contentType);
    if (!uploaded) {
      console.warn('R2 upload skipped — no binding or S3 credentials configured. Image tracked in D1 only.');
    }

    const url = getPublicUrl(env, key);
    const nowUnix = Math.floor(Date.now() / 1000);

    // Track in D1
    const result = await db.prepare(
      `INSERT INTO images (key, url, name, description, folder, content_type, size_bytes, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      key,
      url,
      (name || 'image').trim(),
      (description || '').trim(),
      imageFolder,
      contentType,
      fileBuffer.byteLength,
      user.id,
      nowUnix
    ).run();

    return new Response(JSON.stringify({
      success: true,
      id: result.meta?.last_row_id || null,
      key,
      url,
      name: (name || 'image').trim(),
      storageUsed: uploaded ? 'r2' : 'none',
    }), {
      status: 201, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Upload failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
