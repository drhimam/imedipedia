export const prerender = false;
import { buildSubmissionApprovedEmail, buildSubmissionRejectedEmail } from "../_email-template.js";
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
  const fromEmail = env.SES_FROM_EMAIL || '';

  if (!accessKeyId || !secretAccessKey || !fromEmail) {
    console.warn('SES not configured — skipping email.');
    return false;
  }

  const client = new SESClient({
    region: awsRegion,
    credentials: { accessKeyId, secretAccessKey },
  });
  await client.send(new SendEmailCommand({
    Source: fromEmail,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
    },
  }));
  return true;
}

/**
 * POST /api/admin/review
 * Approve or reject a submission. Body: { submissionId, action: 'approve' | 'reject', notes? }
 * Sends email notification to the contributor on decision.
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

  const { submissionId, action, notes } = body;
  if (!submissionId || !action) {
    return new Response(JSON.stringify({ error: "submissionId and action are required." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    // Fetch submission with user email
    const submission = await db.prepare(
      `SELECT s.*, u.email as contributor_email, u.full_name as contributor_name, u.username as contributor_username
       FROM submissions s LEFT JOIN users u ON s.user_id = u.id
       WHERE s.id = ?`
    ).bind(submissionId).first();

    if (!submission) {
      return new Response(JSON.stringify({ error: "Submission not found." }), {
        status: 404, headers: { "Content-Type": "application/json" }
      });
    }

    const now = Math.floor(Date.now() / 1000);
    let newStatus = 'pending';
    if (action === 'approve') newStatus = 'approved';
    else if (action === 'reject') newStatus = 'rejected';

    await db.prepare(
      "UPDATE submissions SET status = ?, admin_notes = ?, updated_at = ? WHERE id = ?"
    ).bind(newStatus, notes || '', now, submissionId).run();

    // Send email notification to contributor (non-blocking)
    const env = locals.runtime?.env || {};
    const contributorEmail = submission.contributor_email || '';
    const contributorName = submission.contributor_name || submission.contributor_username || 'Contributor';
    const dashboardUrl = 'https://imedipedia.pages.dev/contributors/dashboard';

    if (contributorEmail) {
      try {
        if (action === 'approve') {
          const htmlBody = buildSubmissionApprovedEmail({
            name: contributorName,
            title: submission.title,
            dashboardUrl,
          });
          await sendSESEmail(env, contributorEmail,
            `Your Article Has Been Approved: "${submission.title}"`,
            htmlBody
          );
        } else if (action === 'reject') {
          const htmlBody = buildSubmissionRejectedEmail({
            name: contributorName,
            title: submission.title,
            notes: notes || '',
            dashboardUrl,
          });
          await sendSESEmail(env, contributorEmail,
            `Update on Your Article Submission: "${submission.title}"`,
            htmlBody
          );
        }
      } catch (emailErr) {
        console.error('Review notification email failed (non-fatal):', emailErr.message);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Submission ${newStatus}.`,
      emailSent: !!contributorEmail,
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Review failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
