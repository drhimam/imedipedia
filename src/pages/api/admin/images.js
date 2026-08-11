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

/**
 * Delete an object from R2.
 * Priority: native R2 binding → S3 SDK → skip
 */
async function deleteR2Object(env, key) {
  // 1) Native R2 binding
  const r2Binding = env.IMAGES;
  if (r2Binding && typeof r2Binding.delete === 'function') {
    await r2Binding.delete(key);
    return true;
  }

  // 2) S3-compatible API
  const accountId = env.R2_ACCOUNT_ID || '81d2ff7d82745af438ec32fd05c824d8';
  const accessKeyId = env.R2_ACCESS_KEY_ID || '';
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY || '';

  if (accessKeyId && secretAccessKey) {
    const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
    await client.send(new DeleteObjectCommand({
      Bucket: env.R2_BUCKET_NAME || 'imedipedia-images',
      Key: key,
    }));
    return true;
  }

  return false;
}

/**
 * GET /api/admin/images
 * Query params:
 *   folder - filter by folder (covers, inline, uploads)
 *   page - page number (default 1)
 *   limit - items per page (default 50)
 */
export async function GET({ request, locals }) {
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

  try {
    const url = new URL(request.url);
    const folder = url.searchParams.get('folder') || '';
    const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit')) || 50));
    const offset = (page - 1) * limit;

    let query = 'SELECT i.*, u.username as uploader_name FROM images i LEFT JOIN users u ON i.uploaded_by = u.id';
    let countQuery = 'SELECT COUNT(*) as total FROM images';
    const params = [];
    const countParams = [];

    if (folder) {
      query += ' WHERE i.folder = ?';
      countQuery += ' WHERE folder = ?';
      params.push(folder);
      countParams.push(folder);
    }

    query += ' ORDER BY i.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const countResult = await db.prepare(countQuery).bind(...countParams).first();
    const images = await db.prepare(query).bind(...params).all();

    return new Response(JSON.stringify({
      images: images.results || [],
      total: countResult?.total || 0,
      page,
      limit,
      totalPages: Math.ceil((countResult?.total || 0) / limit),
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed to list images: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * DELETE /api/admin/images
 * Body: { id, key }
 * Deletes from both R2 and D1.
 */
export async function DELETE({ request, locals }) {
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
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { id, key } = body;
  if (!id && !key) {
    return new Response(JSON.stringify({ error: "Either id or key is required." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Get image record
    let imageRecord;
    if (id) {
      imageRecord = await db.prepare("SELECT * FROM images WHERE id = ?").bind(id).first();
    } else {
      imageRecord = await db.prepare("SELECT * FROM images WHERE key = ?").bind(key).first();
    }

    if (!imageRecord) {
      return new Response(JSON.stringify({ error: "Image not found." }), {
        status: 404, headers: { "Content-Type": "application/json" }
      });
    }

    // Delete from R2
    const env = locals.runtime?.env || {};
    try {
      await deleteR2Object(env, imageRecord.key);
    } catch (r2Err) {
      console.error('R2 delete failed:', r2Err.message);
    }

    // Delete from D1
    await db.prepare("DELETE FROM images WHERE id = ?").bind(imageRecord.id).run();

    return new Response(JSON.stringify({
      success: true,
      message: `Image "${imageRecord.name}" deleted.`,
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Delete failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
