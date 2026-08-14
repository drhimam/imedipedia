export const prerender = false;

function sanitize(str, maxLen = 500) {
  if (!str) return '';
  return String(str).trim().substring(0, maxLen);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * GET /api/reviewers/apply
 * Returns active reviewers list for public showcase
 */
export async function GET({ locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "D1 database connection binding is missing." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const reviewers = await db.prepare(
      `SELECT id, username, full_name, email, affiliation, specialty, bio, avatar_url, role
       FROM users
       WHERE role = 'reviewer' OR role = 'admin' OR role = 'co-admin'
       ORDER BY full_name ASC`
    ).all();

    return new Response(JSON.stringify({
      success: true,
      reviewers: reviewers.results || []
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * POST /api/reviewers/apply
 * Handles public peer reviewer applications
 */
export async function POST({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "D1 database connection binding is missing." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { name, email, title_affiliation, specialties, qualifications, orcid_or_portfolio } = body;

  const cleanName = sanitize(name, 200);
  const cleanEmail = sanitize(email, 200).toLowerCase();
  const cleanAffiliation = sanitize(title_affiliation, 300);
  const cleanQualifications = sanitize(qualifications, 2000);
  const cleanOrcid = sanitize(orcid_or_portfolio, 500);

  let specialtiesArr = [];
  if (Array.isArray(specialties)) {
    specialtiesArr = specialties.map(s => sanitize(s, 100)).filter(Boolean);
  } else if (typeof specialties === 'string') {
    specialtiesArr = specialties.split(',').map(s => sanitize(s, 100)).filter(Boolean);
  }

  if (!cleanName || !cleanEmail || !cleanAffiliation || !cleanQualifications) {
    return new Response(JSON.stringify({
      error: "Name, email, clinical affiliation, and qualifications are required."
    }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  if (!isValidEmail(cleanEmail)) {
    return new Response(JSON.stringify({ error: "Invalid email format." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Check if email already applied or exists
    const existingApp = await db.prepare(
      "SELECT id, status FROM peer_review_applications WHERE email = ?"
    ).bind(cleanEmail).first();

    if (existingApp) {
      if (existingApp.status === 'pending') {
        return new Response(JSON.stringify({
          error: "An application with this email is already pending editorial board review."
        }), {
          status: 409, headers: { "Content-Type": "application/json" }
        });
      }
    }

    const existingUser = await db.prepare(
      "SELECT id FROM users WHERE email = ?"
    ).bind(cleanEmail).first();

    if (existingUser) {
      // Check if already a reviewer
      const userObj = await db.prepare("SELECT role FROM users WHERE id = ?").bind(existingUser.id).first();
      if (userObj && (userObj.role === 'reviewer' || userObj.role === 'admin')) {
        return new Response(JSON.stringify({
          error: "You are already an active member of the Peer Review Board. Please log in directly."
        }), {
          status: 409, headers: { "Content-Type": "application/json" }
        });
      }
    }

    const now = Math.floor(Date.now() / 1000);
    await db.prepare(
      `INSERT INTO peer_review_applications (name, email, title_affiliation, specialties, qualifications, orcid_or_portfolio, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).bind(
      cleanName,
      cleanEmail,
      cleanAffiliation,
      JSON.stringify(specialtiesArr),
      cleanQualifications,
      cleanOrcid,
      now
    ).run();

    return new Response(JSON.stringify({
      success: true,
      message: "Your application to join the iMedipedia Peer Review Board has been submitted. Our editorial team will review your qualifications."
    }), {
      status: 201, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Application submission failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
