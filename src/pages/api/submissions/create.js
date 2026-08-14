export const prerender = false;
import { buildSubmissionReceivedEmail, formatSenderAddress } from "../_email-template.js";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

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

function normalizeTags(value) {
  if (!value) return '[]';
  if (Array.isArray(value)) return JSON.stringify(value.map(t => String(t).trim()).filter(Boolean));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return JSON.stringify(parsed.map(t => String(t).trim()).filter(Boolean));
    } catch {}
    // Comma-separated string
    return JSON.stringify(value.split(',').map(t => t.trim()).filter(Boolean));
  }
  return '[]';
}

function normalizeExams(value) {
  if (!value) return '[]';
  if (Array.isArray(value)) return JSON.stringify(value.map(e => String(e).trim()).filter(Boolean));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return JSON.stringify(parsed.map(e => String(e).trim()).filter(Boolean));
    } catch {}
    // Comma-separated string
    return JSON.stringify(value.split(',').map(e => e.trim()).filter(Boolean));
  }
  return '[]';
}

/**
 * Sanitize input: strip HTML tags, trim whitespace, enforce max length.
 * Prevents XSS and oversized inputs.
 */
function sanitize(str, maxLen = 100000) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/<[^>]*>/g, '')  // Strip HTML tags
    .replace(/```[\s\S]*?```/g, '') // Strip code blocks to prevent injection
    .trim()
    .substring(0, maxLen);
}

/**
 * Strip HTML from an array of strings.
 */
function sanitizeArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(s => sanitize(String(s), 500));
}

/**
 * Send email via AWS SES (same pattern as application-review.js).
 */
async function sendSESEmail(env, to, subject, htmlBody) {
  const awsRegion = env.AWS_REGION || 'ca-central-1';
  const accessKeyId = env.AWS_ACCESS_KEY_ID || '';
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY || '';
  const fromEmail = env.SES_FROM_EMAIL || '';

  if (!accessKeyId || !secretAccessKey || !fromEmail) {
    console.warn('SES not configured — skipping email.');
    return false;
  }

  const client = new SESClient({
    region: awsRegion,
    credentials: { accessKeyId, secretAccessKey },
  });
  const senderName = env.SES_FROM_NAME || 'iMedipedia Admin';
  await client.send(new SendEmailCommand({
    Source: formatSenderAddress(fromEmail, senderName),
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
    },
  }));
  return true;
}

/**
 * POST /api/submissions/create
 * Body: { title, description, tags, type, subject, topic, exams, image, intextImages, body }
 * description is now optional.
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

  if (user.role !== 'contributor' && user.role !== 'admin' && user.role !== 'co-admin') {
    return new Response(JSON.stringify({ error: "Only contributors can submit articles." }), {
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

  const { title, description, tag, type, subject, topic, exams, image, intextImages } = body;
  // Accept both "tag" and "tags" for backward compatibility
  const rawTags = tag || body.tags;
  const articleBody = body.body || '';

  // Accept "subjects" (new array) with fallback to old "tag" + "subject" (single string)
  // This ensures backward compatibility with old client code
  let subjectsArray = [];
  if (body.subjects !== undefined) {
    // New format: subjects is a JSON array of strings
    subjectsArray = body.subjects;
    if (typeof subjectsArray === 'string') {
      try { subjectsArray = JSON.parse(subjectsArray); } catch { subjectsArray = []; }
    }
    if (!Array.isArray(subjectsArray)) subjectsArray = [];
    subjectsArray = subjectsArray.map(function(s) { return sanitize(String(s), 200); }).filter(Boolean);
  } else {
    // Old format: build subjects from old tag + subject fields
    const oldTags = rawTags ? normalizeTags(rawTags) : '[]';
    let parsedTags = [];
    try { parsedTags = JSON.parse(oldTags); } catch { parsedTags = []; }
    const oldSubject = sanitize(subject || '', 200);
    // Merge tags + old subject, deduplicate
    var seen = {};
    subjectsArray = [];
    [].concat(parsedTags, oldSubject ? [oldSubject] : []).forEach(function(s) {
      if (s && !seen[s.toLowerCase()]) { seen[s.toLowerCase()] = true; subjectsArray.push(s); }
    });
  }

  // Sanitize all text inputs
  const cleanTitle = sanitize(title, 500);
  const cleanDescription = sanitize(description || '', 1000);
  const cleanTopic = sanitize(topic || '', 200);
  const cleanBody = sanitize(articleBody, 100000);
  const cleanImage = sanitize(image || '', 2000);

  if (!cleanTitle || !cleanBody) {
    return new Response(JSON.stringify({ error: "Title and body are required." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  // Author is always the logged-in user's full name
  const author = sanitize(user.full_name || user.username, 200);

  try {
    const now = Math.floor(Date.now() / 1000);
    const slug = `${slugify(cleanTitle)}`;

    const result = await db.prepare(
      `INSERT INTO submissions (user_id, title, slug, description, author, tag, type, subject, topic, exams, image, body, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).bind(
      user.id,
      cleanTitle,
      slug,
      cleanDescription,
      author,
      JSON.stringify(subjectsArray),  // Reuse tag column for subjects (backward compat)
      (type || 'general').trim(),
      JSON.stringify(subjectsArray),  // subject column now stores subjects array
      cleanTopic,
      normalizeExams(exams),
      cleanImage,
      cleanBody,
      now,
      now
    ).run();

    // Send confirmation email (non-blocking — failure does not fail the submission)
    const env = locals.runtime?.env || {};
    const userEmail = user.email || '';
    if (userEmail) {
      try {
        const origin = new URL(request.url).origin || 'https://imedipedia.com';
        const dashboardUrl = `${origin}/contributors/dashboard`;
        const htmlBody = buildSubmissionReceivedEmail({
          name: user.full_name || user.username,
          title: cleanTitle,
          dashboardUrl,
        });
        await sendSESEmail(env, userEmail,
          `Article Submission Received: "${cleanTitle}"`,
          htmlBody
        );
      } catch (emailErr) {
        console.error('Submission confirmation email failed (non-fatal):', emailErr.message);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      id: result.meta?.last_row_id || null,
      slug,
      message: "Your article has been submitted for review.",
      emailSent: !!userEmail,
    }), {
      status: 201, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Submission failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
