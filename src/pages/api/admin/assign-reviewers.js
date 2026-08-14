export const prerender = false;
import { buildPeerReviewInviteEmail, buildArticleInReviewEmail, formatSenderAddress } from "../_email-template.js";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

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

async function sendSESEmail(env, to, subject, htmlBody) {
  const awsRegion = env.AWS_REGION || 'ca-central-1';
  const accessKeyId = env.AWS_ACCESS_KEY_ID || '';
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY || '';
  const fromEmail = env.SES_FROM_EMAIL || 'support@imedipedia.com';

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
 * GET /api/admin/assign-reviewers?submissionId=...
 * Fetch current assignments and completed reviews for a submission
 */
export async function GET({ request, locals }) {
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

  const url = new URL(request.url);
  const subId = url.searchParams.get('submissionId');

  try {
    let assignments;
    if (subId) {
      assignments = await db.prepare(
        `SELECT a.*, s.title as submission_title, s.author as submission_author, s.status as submission_status, s.type as submission_type, s.topic as submission_topic,
                u.full_name as reviewer_name, u.username as reviewer_username, u.email as reviewer_email, u.specialty as reviewer_specialty,
                r.id as review_id, r.recommendation, r.clinical_accuracy_score, r.structure_score, r.evidence_score,
                r.author_comments, r.editor_notes, r.created_at as review_submitted_at
         FROM peer_review_assignments a
         JOIN submissions s ON a.submission_id = s.id
         JOIN users u ON a.reviewer_user_id = u.id
         LEFT JOIN peer_reviews r ON a.id = r.assignment_id
         WHERE a.submission_id = ?
         ORDER BY a.assigned_at DESC`
      ).bind(subId).all();
    } else {
      assignments = await db.prepare(
        `SELECT a.*, s.title as submission_title, s.author as submission_author, s.status as submission_status, s.type as submission_type, s.topic as submission_topic,
                u.full_name as reviewer_name, u.username as reviewer_username, u.email as reviewer_email, u.specialty as reviewer_specialty,
                r.id as review_id, r.recommendation, r.clinical_accuracy_score, r.structure_score, r.evidence_score,
                r.author_comments, r.editor_notes, r.created_at as review_submitted_at
         FROM peer_review_assignments a
         JOIN submissions s ON a.submission_id = s.id
         JOIN users u ON a.reviewer_user_id = u.id
         LEFT JOIN peer_reviews r ON a.id = r.assignment_id
         ORDER BY a.assigned_at DESC`
      ).all();
    }

    return new Response(JSON.stringify({
      success: true,
      assignments: assignments.results || []
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
 * POST /api/admin/assign-reviewers
 * Assigns one or more peer reviewers to a submission, sets status='in_review', sends SES emails.
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
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { submissionId, reviewerUserIds } = body;
  if (!submissionId || !Array.isArray(reviewerUserIds) || reviewerUserIds.length === 0) {
    return new Response(JSON.stringify({ error: "submissionId and at least one reviewerUserId are required." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Fetch submission and author details
    const submission = await db.prepare(
      `SELECT s.*, u.email as author_email, u.full_name as author_full_name, u.username as author_username
       FROM submissions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ?`
    ).bind(submissionId).first();

    if (!submission) {
      return new Response(JSON.stringify({ error: "Submission not found." }), {
        status: 404, headers: { "Content-Type": "application/json" }
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const env = locals.runtime?.env || {};
    const origin = new URL(request.url).origin || 'https://imedipedia.com';
    const assignedReviewerNames = [];

    // Assign reviewers
    for (const revUserId of reviewerUserIds) {
      const reviewer = await db.prepare("SELECT * FROM users WHERE id = ?").bind(revUserId).first();
      if (!reviewer) continue;

      // Check if assignment already exists
      const existing = await db.prepare(
        "SELECT id FROM peer_review_assignments WHERE submission_id = ? AND reviewer_user_id = ?"
      ).bind(submissionId, revUserId).first();

      if (!existing) {
        await db.prepare(
          `INSERT INTO peer_review_assignments (submission_id, reviewer_user_id, status, assigned_by, assigned_at)
           VALUES (?, ?, 'pending', ?, ?)`
        ).bind(submissionId, revUserId, user.id, now).run();
      }

      assignedReviewerNames.push(reviewer.full_name || reviewer.username);

      // Send Invitation Email to Reviewer
      if (reviewer.email) {
        try {
          const reviewPortalUrl = `${origin}/contributors/dashboard?tab=reviews`;
          const inviteEmail = buildPeerReviewInviteEmail({
            reviewerName: reviewer.full_name || reviewer.username,
            articleTitle: submission.title,
            articleType: submission.type,
            reviewUrl: reviewPortalUrl
          });
          await sendSESEmail(env, reviewer.email, `Peer Review Invitation: "${submission.title}"`, inviteEmail);
        } catch (emailErr) {
          console.error(`Failed to send invite email to ${reviewer.email}:`, emailErr);
        }
      }
    }

    // Update submission status to 'in_review'
    await db.prepare(
      "UPDATE submissions SET status = 'in_review', updated_at = ? WHERE id = ?"
    ).bind(now, submissionId).run();

    // Send Alert Email to Contributor
    const authorEmail = submission.author_email || '';
    const authorName = submission.author_full_name || submission.author || 'Author';
    if (authorEmail) {
      try {
        const dashboardUrl = `${origin}/contributors/dashboard`;
        const inReviewEmail = buildArticleInReviewEmail({
          authorName,
          articleTitle: submission.title,
          reviewerNames: assignedReviewerNames,
          dashboardUrl
        });
        await sendSESEmail(env, authorEmail, `Your Article is Under Peer Review: "${submission.title}"`, inReviewEmail);
      } catch (authorEmailErr) {
        console.error("Failed to send in-review alert to author:", authorEmailErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Article assigned to ${assignedReviewerNames.length} reviewer(s). Status updated to 'in_review'.`
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Assignment failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * DELETE /api/admin/assign-reviewers
 * Body: { assignmentId }
 */
export async function DELETE({ request, locals }) {
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
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { assignmentId } = body;
  if (!assignmentId) {
    return new Response(JSON.stringify({ error: "assignmentId is required." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Delete peer review if exists
    await db.prepare("DELETE FROM peer_reviews WHERE assignment_id = ?").bind(assignmentId).run();
    // Delete assignment
    await db.prepare("DELETE FROM peer_review_assignments WHERE id = ?").bind(assignmentId).run();

    return new Response(JSON.stringify({
      success: true,
      message: "Review assignment deleted successfully."
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Deletion failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
