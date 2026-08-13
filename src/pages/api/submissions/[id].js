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

function normalizeTags(value) {
  if (!value) return '[]';
  if (Array.isArray(value)) return JSON.stringify(value.map(t => String(t).trim()).filter(Boolean));
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return JSON.stringify(parsed.map(t => String(t).trim()).filter(Boolean)); } catch {}
    return JSON.stringify(value.split(',').map(t => t.trim()).filter(Boolean));
  }
  return '[]';
}

function normalizeExams(value) {
  if (!value) return '[]';
  if (Array.isArray(value)) return JSON.stringify(value.map(e => String(e).trim()).filter(Boolean));
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return JSON.stringify(parsed.map(e => String(e).trim()).filter(Boolean)); } catch {}
    return JSON.stringify(value.split(',').map(e => e.trim()).filter(Boolean));
  }
  return '[]';
}

function sanitize(str, maxLen = 100000) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/<[^>]*>/g, '')  // Strip HTML tags
    .replace(/```[\s\S]*?```/g, '') // Strip code blocks to prevent injection
    .trim()
    .substring(0, maxLen);
}

/**
 * GET /api/submissions/:id
 * Returns a single submission. Must be owner or admin.
 */
export async function GET({ params, request, locals }) {
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

  const id = parseInt(params.id);
  if (isNaN(id)) {
    return new Response(JSON.stringify({ error: "Invalid submission ID." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const submission = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first();
    if (!submission) {
      return new Response(JSON.stringify({ error: "Submission not found." }), {
        status: 404, headers: { "Content-Type": "application/json" }
      });
    }

    // Only owner or admin can view
    if (submission.user_id !== user.id && !isAdmin(user)) {
      return new Response(JSON.stringify({ error: "Forbidden." }), {
        status: 403, headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ success: true, submission }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * PUT /api/submissions/:id
 * Update a submission. Only the owner can update it.
 * If the submission is published, reverts status to 'pending' for re-approval.
 */
export async function PUT({ params, request, locals }) {
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

  const id = parseInt(params.id);
  if (isNaN(id)) {
    return new Response(JSON.stringify({ error: "Invalid submission ID." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const existing = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first();
    if (!existing) {
      return new Response(JSON.stringify({ error: "Submission not found." }), {
        status: 404, headers: { "Content-Type": "application/json" }
      });
    }

    // Only owner can update
    if (existing.user_id !== user.id && !isAdmin(user)) {
      return new Response(JSON.stringify({ error: "Forbidden." }), {
        status: 403, headers: { "Content-Type": "application/json" }
      });
    }

    const { title, description, tag, type, subject, topic, exams, image, intextImages } = body;
    // Accept both "tag" and "tags" for backward compatibility
    const rawTags = tag || body.tags;
    const articleBody = body.body || '';

    // Accept "subjects" (new array) with fallback to old "tag" + "subject" (single string)
    let subjectsArray = null;  // null = not provided, use existing
    if (body.subjects !== undefined) {
      subjectsArray = body.subjects;
      if (typeof subjectsArray === 'string') {
        try { subjectsArray = JSON.parse(subjectsArray); } catch { subjectsArray = []; }
      }
      if (!Array.isArray(subjectsArray)) subjectsArray = [];
      subjectsArray = subjectsArray.map(function(s) { return sanitize(String(s), 200); }).filter(Boolean);
    } else if (rawTags !== undefined || subject !== undefined) {
      // Old format provided: build from tag + subject
      const oldTagsVal = rawTags !== undefined ? normalizeTags(rawTags) : existing.tag;
      let parsedTags = [];
      try { parsedTags = JSON.parse(oldTagsVal); } catch { parsedTags = []; }
      const oldSubjectVal = sanitize((subject !== undefined ? subject : existing.subject) || '', 200);
      var seen = {};
      subjectsArray = [];
      [].concat(parsedTags, oldSubjectVal ? [oldSubjectVal] : []).forEach(function(s) {
        if (s && !seen[s.toLowerCase()]) { seen[s.toLowerCase()] = true; subjectsArray.push(s); }
      });
    }
    const subjectsJSON = subjectsArray !== null ? JSON.stringify(subjectsArray) : existing.subject;

    const cleanTitle = sanitize(title || existing.title, 500);
    const cleanDescription = sanitize(description !== undefined ? description : existing.description, 1000);
    const cleanTopic = sanitize(topic || existing.topic || '', 200);
    const cleanBody = sanitize(articleBody || existing.body, 100000);
    const cleanImage = sanitize(image !== undefined ? image : existing.image, 2000);

    if (!cleanTitle || !cleanBody) {
      return new Response(JSON.stringify({ error: "Title and body are required." }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const slug = slugify(cleanTitle);

    // If the submission was published, revert to pending
    const newStatus = existing.status === 'published' ? 'pending' : existing.status;

    await db.prepare(
      `UPDATE submissions SET title = ?, slug = ?, description = ?, tag = ?, type = ?, subject = ?, topic = ?, exams = ?, image = ?, body = ?, status = ?, updated_at = ? WHERE id = ?`
    ).bind(
      cleanTitle,
      slug,
      cleanDescription,
      subjectsJSON,  // tag column now stores subjects JSON
      (type || existing.type || 'general').trim(),
      subjectsJSON,  // subject column also stores subjects JSON
      cleanTopic,
      normalizeExams(exams !== undefined ? exams : existing.exams),
      cleanImage,
      cleanBody,
      newStatus,
      now,
      id
    ).run();

    return new Response(JSON.stringify({
      success: true,
      message: existing.status === 'published'
        ? "Article updated and sent back for re-approval."
        : "Submission updated.",
      statusChanged: existing.status === 'published',
      newStatus,
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Update failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * DELETE /api/submissions/:id
 * Delete a submission. Only the owner can delete, and not if published.
 * Admins can delete any submission.
 */
export async function DELETE({ params, request, locals }) {
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

  const id = parseInt(params.id);
  if (isNaN(id)) {
    return new Response(JSON.stringify({ error: "Invalid submission ID." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const submission = await db.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first();
    if (!submission) {
      return new Response(JSON.stringify({ error: "Submission not found." }), {
        status: 404, headers: { "Content-Type": "application/json" }
      });
    }

    // Only owner or admin can delete
    if (submission.user_id !== user.id && !isAdmin(user)) {
      return new Response(JSON.stringify({ error: "Forbidden." }), {
        status: 403, headers: { "Content-Type": "application/json" }
      });
    }

    // Contributors cannot delete published articles
    if (!isAdmin(user) && submission.status === 'published') {
      return new Response(JSON.stringify({ error: "Cannot delete a published article." }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    await db.prepare("DELETE FROM submissions WHERE id = ?").bind(id).run();

    return new Response(JSON.stringify({
      success: true,
      message: "Submission deleted.",
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Delete failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
