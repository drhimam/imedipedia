export const prerender = false;
import { buildPeerReviewFeedbackEmail, buildPeerReviewSubmittedAdminEmail, formatSenderAddress } from "../_email-template.js";
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
 * GET /api/reviewers/assignments
 * Fetch all assigned submissions for the logged-in reviewer
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

  try {
    const assignments = await db.prepare(
      `SELECT a.id as assignment_id, a.status as assignment_status, a.assigned_at, a.completed_at,
              s.id as submission_id, s.title, s.slug, s.description, s.author, s.type, s.subject, s.topic, s.image, s.body, s.created_at,
              r.id as review_id, r.recommendation, r.clinical_accuracy_score, r.structure_score, r.evidence_score, r.author_comments, r.editor_notes
       FROM peer_review_assignments a
       JOIN submissions s ON a.submission_id = s.id
       LEFT JOIN peer_reviews r ON a.id = r.assignment_id
       WHERE a.reviewer_user_id = ?
       ORDER BY a.assigned_at DESC`
    ).bind(user.id).all();

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
 * POST /api/reviewers/assignments
 * Reviewer submits structured evaluation for an assignment
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
    return new Response(JSON.stringify({ error: "Unauthorized." }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { assignmentId, recommendation, clinicalAccuracy, structure, evidence, authorComments, editorNotes } = body;

  if (!assignmentId || !recommendation || !authorComments) {
    return new Response(JSON.stringify({
      error: "assignmentId, recommendation, and author comments are required."
    }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Verify assignment belongs to user
    const assignment = await db.prepare(
      `SELECT a.*, s.title as article_title, s.user_id as author_user_id,
              u.email as author_email, u.full_name as author_name, u.username as author_username
       FROM peer_review_assignments a
       JOIN submissions s ON a.submission_id = s.id
       JOIN users u ON s.user_id = u.id
       WHERE a.id = ? AND a.reviewer_user_id = ?`
    ).bind(assignmentId, user.id).first();

    if (!assignment) {
      return new Response(JSON.stringify({ error: "Review assignment not found or access denied." }), {
        status: 404, headers: { "Content-Type": "application/json" }
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const accuracyScore = Math.max(1, Math.min(5, parseInt(clinicalAccuracy) || 5));
    const structureScore = Math.max(1, Math.min(5, parseInt(structure) || 5));
    const evidenceScore = Math.max(1, Math.min(5, parseInt(evidence) || 5));

    // Save or update peer review
    const existingReview = await db.prepare("SELECT id FROM peer_reviews WHERE assignment_id = ?").bind(assignmentId).first();

    if (existingReview) {
      await db.prepare(
        `UPDATE peer_reviews
         SET recommendation = ?, clinical_accuracy_score = ?, structure_score = ?, evidence_score = ?,
             author_comments = ?, editor_notes = ?
         WHERE id = ?`
      ).bind(
        recommendation,
        accuracyScore,
        structureScore,
        evidenceScore,
        authorComments.trim(),
        (editorNotes || '').trim(),
        existingReview.id
      ).run();
    } else {
      await db.prepare(
        `INSERT INTO peer_reviews (assignment_id, submission_id, reviewer_user_id, recommendation, clinical_accuracy_score, structure_score, evidence_score, author_comments, editor_notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        assignmentId,
        assignment.submission_id,
        user.id,
        recommendation,
        accuracyScore,
        structureScore,
        evidenceScore,
        authorComments.trim(),
        (editorNotes || '').trim(),
        now
      ).run();
    }

    // Mark assignment completed
    await db.prepare(
      "UPDATE peer_review_assignments SET status = 'completed', completed_at = ? WHERE id = ?"
    ).bind(now, assignmentId).run();

    // Send Feedback Email directly to the Contributor/Author
    const env = locals.runtime?.env || {};
    const origin = new URL(request.url).origin || 'https://imedipedia.com';
    const authorEmail = assignment.author_email || '';
    const authorName = assignment.author_name || assignment.author_username || 'Author';

    if (authorEmail) {
      try {
        const dashboardUrl = `${origin}/contributors/dashboard`;
        const feedbackEmail = buildPeerReviewFeedbackEmail({
          authorName,
          articleTitle: assignment.article_title,
          reviewerName: user.full_name || user.username || 'Peer Reviewer',
          recommendation,
          scores: {
            clinical_accuracy: accuracyScore,
            structure: structureScore,
            evidence: evidenceScore
          },
          authorComments: authorComments.trim(),
          dashboardUrl
        });

        await sendSESEmail(
          env,
          authorEmail,
          `Peer Review Completed: "${assignment.article_title}"`,
          feedbackEmail
        );
      } catch (emailErr) {
        console.error("Failed to send review feedback email to author:", emailErr);
      }
    }

    // Send Admin Notification Email
    const adminEmail = env.SES_ADMIN_EMAIL || env.ADMIN_EMAIL || 'admin@imedipedia.com';
    try {
      const adminDashboardUrl = `${origin}/admin`;
      const adminEmailHtml = buildPeerReviewSubmittedAdminEmail({
        reviewerName: user.full_name || user.username || 'Peer Reviewer',
        reviewerEmail: user.email || '',
        articleTitle: assignment.article_title,
        authorName,
        recommendation,
        scores: {
          clinical_accuracy: accuracyScore,
          structure: structureScore,
          evidence: evidenceScore
        },
        authorComments: authorComments.trim(),
        editorNotes: (editorNotes || '').trim(),
        adminDashboardUrl
      });

      await sendSESEmail(
        env,
        adminEmail,
        `[Review Completed] "${assignment.article_title}" (${recommendation})`,
        adminEmailHtml
      );
    } catch (adminEmailErr) {
      console.error("Failed to send review notification email to admin:", adminEmailErr);
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Peer review submitted successfully. Feedback delivered to author and notification sent to Editorial Board."
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Review submission failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
