/**
 * iMedipedia — Centralized Branded HTML Email Templates
 *
 * All transactional emails share the same indigo-themed design:
 * gradient header, professional footer, inline CSS for email clients.
 */

const BRAND_COLOR = '#6366f1'; // Indigo-500
const BRAND_COLOR_DARK = '#4f46e5'; // Indigo-600
const BACKGROUND = '#f4f5f7';
const TEXT_COLOR = '#1e293b';
const MUTED_COLOR = '#64748b';

export function buildEmail({ subject, preview, content }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(subject)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BACKGROUND};font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;">
  <!-- Preview text (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHTML(preview || '')}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BACKGROUND};">
    <tr>
      <td align="center" style="padding:24px 16px 40px;">
        <!-- Main container -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND_COLOR},${BRAND_COLOR_DARK});padding:32px 24px;border-radius:12px 12px 0 0;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">iMedipedia</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;font-weight:400;">Medical Research &amp; Education Platform</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:#ffffff;padding:32px 24px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;color:${MUTED_COLOR};">
                &copy; ${new Date().getFullYear()} <strong style="color:${BRAND_COLOR};">iMedipedia</strong>. All rights reserved.
              </p>
              <p style="margin:0;font-size:12px;color:#94a3b8;">
                Advancing medical knowledge through collaborative research.
              </p>
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;">
              <p style="margin:0;font-size:11px;color:#94a3b8;">
                This is an automated message from the iMedipedia platform.
                Please do not reply directly to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildButton(text, href, { fullWidth = false } = {}) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr>
      <td align="center" style="background-color:${BRAND_COLOR};border-radius:8px;padding:${fullWidth ? '14px 0' : '14px 32px'};${fullWidth ? 'width:100%;' : ''}">
        <a href="${escapeHTML(href)}" target="_blank" style="color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;display:inline-block;${fullWidth ? 'width:100%;' : ''}">${escapeHTML(text)}</a>
      </td>
    </tr>
  </table>`;
}

export function buildInfoBox(content, type = 'info') {
  const colors = {
    info: { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af' },
    success: { bg: '#f0fdf4', border: '#86efac', text: '#166534' },
    warning: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e' },
    danger: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b' },
  };
  const c = colors[type] || colors.info;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0;">
    <tr>
      <td style="background-color:${c.bg};border:1px solid ${c.border};border-left:4px solid ${c.border};padding:16px;border-radius:6px;">
        <p style="margin:0;font-size:14px;color:${c.text};line-height:1.6;">${content}</p>
      </td>
    </tr>
  </table>`;
}

// --- Specific Email Templates ---

export function buildAcceptanceEmail({ name, username, password, loginUrl }) {
  const content = `
    <h2 style="margin:0 0 8px;color:${TEXT_COLOR};font-size:22px;">Welcome to iMedipedia! 🎉</h2>
    <p style="margin:0 0 16px;color:${MUTED_COLOR};font-size:15px;line-height:1.6;">
      Dear ${escapeHTML(name)},<br><br>
      Congratulations! Your contributor application has been <strong style="color:#16a34a;">approved</strong>.
      You now have access to submit articles, manage your profile, and contribute to the iMedipedia medical research platform.
    </p>

    ${buildInfoBox(`
      <strong>Your Account Credentials</strong><br><br>
      <strong>Username:</strong> <code style="background:#e2e8f0;padding:2px 6px;border-radius:3px;">${escapeHTML(username)}</code><br>
      <strong>Temporary Password:</strong> <code style="background:#e2e8f0;padding:2px 6px;border-radius:3px;">${escapeHTML(password)}</code><br><br>
      <em style="font-size:13px;">Please change your password after your first login.</em>
    `)}

    ${buildButton('Log in to iMedipedia', loginUrl)}

    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;">
      Once logged in, head to your <strong>Dashboard</strong> to:
    </p>
    <ul style="margin:8px 0;padding-left:20px;font-size:14px;color:${TEXT_COLOR};line-height:1.8;">
      <li>Submit new medical articles for review</li>
      <li>Update your contributor profile and bio</li>
      <li>Track your submission status</li>
    </ul>
    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;">
      We're excited to have you on board!<br>
      <strong>— The iMedipedia Team</strong>
    </p>
  `;
  return buildEmail({
    subject: 'Welcome to iMedipedia — Your Contributor Account is Ready',
    preview: `Congratulations ${name}, your iMedipedia contributor application has been approved!`,
    content,
  });
}

export function buildRejectionEmail({ name, reason }) {
  const reasonText = reason
    ? `<p style="margin:8px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;"><strong>Reviewer notes:</strong> ${escapeHTML(reason)}</p>`
    : '';
  const content = `
    <h2 style="margin:0 0 8px;color:${TEXT_COLOR};font-size:22px;">Update on Your Application</h2>
    <p style="margin:0 0 16px;color:${MUTED_COLOR};font-size:15px;line-height:1.6;">
      Dear ${escapeHTML(name)},<br><br>
      Thank you for your interest in becoming an iMedipedia contributor. After careful review,
      we regret to inform you that your application has not been accepted at this time.
    </p>
    ${reasonText}
    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;">
      We encourage you to apply again in the future. If you have any questions, please contact
      the iMedipedia administration team.<br><br>
      <strong>— The iMedipedia Team</strong>
    </p>
  `;
  return buildEmail({
    subject: 'Update on Your iMedipedia Contributor Application',
    preview: `Dear ${name}, here is an update on your iMedipedia contributor application.`,
    content,
  });
}

export function buildSubmissionReceivedEmail({ name, title, dashboardUrl }) {
  const content = `
    <h2 style="margin:0 0 8px;color:${TEXT_COLOR};font-size:22px;">Article Submission Received 📝</h2>
    <p style="margin:0 0 16px;color:${MUTED_COLOR};font-size:15px;line-height:1.6;">
      Dear ${escapeHTML(name)},<br><br>
      Thank you for your submission to iMedipedia. We have received your article:
    </p>

    ${buildInfoBox(`
      <strong>Article Title:</strong><br>
      <span style="font-size:16px;">${escapeHTML(title)}</span>
    `, 'info')}

    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;">
      <strong>What happens next?</strong>
    </p>
    <ul style="margin:8px 0;padding-left:20px;font-size:14px;color:${TEXT_COLOR};line-height:1.8;">
      <li>Our editorial board will review your submission</li>
      <li>You will receive an email notification once a decision is made</li>
      <li>If approved, your article will be published on iMedipedia</li>
    </ul>

    ${buildButton('View Your Dashboard', dashboardUrl)}

    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;">
      You can track the status of your submission at any time from your contributor dashboard.<br><br>
      <strong>— The iMedipedia Editorial Team</strong>
    </p>
  `;
  return buildEmail({
    subject: `Article Submission Received: "${title}"`,
    preview: `Thank you ${name}, your article "${title}" has been submitted for review.`,
    content,
  });
}

export function buildSubmissionApprovedEmail({ name, title, dashboardUrl }) {
  const content = `
    <h2 style="margin:0 0 8px;color:${TEXT_COLOR};font-size:22px;">Article Approved! ✅</h2>
    <p style="margin:0 0 16px;color:${MUTED_COLOR};font-size:15px;line-height:1.6;">
      Dear ${escapeHTML(name)},<br><br>
      Great news! Your article has been <strong style="color:#16a34a;">approved</strong> by the editorial board:
    </p>

    ${buildInfoBox(`
      <strong>Article:</strong> ${escapeHTML(title)}<br>
      <strong>Status:</strong> <span style="color:#16a34a;">Approved — Queued for Publishing</span>
    `, 'success')}

    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;">
      Your article is now queued for publishing. The admin team will publish it to iMedipedia shortly.
      Once published, it will be visible to all readers on the platform.
    </p>

    ${buildButton('View Your Dashboard', dashboardUrl)}

    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;">
      <strong>— The iMedipedia Editorial Team</strong>
    </p>
  `;
  return buildEmail({
    subject: `Your Article Has Been Approved: "${title}"`,
    preview: `Congratulations ${name}! Your article "${title}" has been approved and queued for publishing.`,
    content,
  });
}

export function buildSubmissionRejectedEmail({ name, title, notes, dashboardUrl }) {
  const notesSection = notes
    ? `<p style="margin:8px 0 0;font-size:14px;color:${TEXT_COLOR};line-height:1.6;"><strong>Reviewer Feedback:</strong><br>${escapeHTML(notes)}</p>`
    : '';
  const content = `
    <h2 style="margin:0 0 8px;color:${TEXT_COLOR};font-size:22px;">Article Needs Revision</h2>
    <p style="margin:0 0 16px;color:${MUTED_COLOR};font-size:15px;line-height:1.6;">
      Dear ${escapeHTML(name)},<br><br>
      Thank you for your submission. After careful review, the editorial board has determined that your article requires revisions before it can be published:
    </p>

    ${buildInfoBox(`
      <strong>Article:</strong> ${escapeHTML(title)}<br>
      <strong>Status:</strong> Rejected — Revisions Requested
    `, 'warning')}

    ${notesSection}

    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;">
      You can edit and resubmit your article from your contributor dashboard.
      The editorial board will review your revised submission.
    </p>

    ${buildButton('Edit & Resubmit', dashboardUrl)}

    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;">
      If you have any questions about the review feedback, please contact the administration team.<br><br>
      <strong>— The iMedipedia Editorial Team</strong>
    </p>
  `;
  return buildEmail({
    subject: `Update on Your Article Submission: "${title}"`,
    preview: `Dear ${name}, your article "${title}" requires revisions. Please review the feedback.`,
    content,
  });
}

export function buildPasswordResetEmail({ name, resetUrl }) {
  const content = `
    <h2 style="margin:0 0 8px;color:${TEXT_COLOR};font-size:22px;">Reset Your Password</h2>
    <p style="margin:0 0 16px;color:${MUTED_COLOR};font-size:15px;line-height:1.6;">
      Hello ${escapeHTML(name || 'there')},<br><br>
      We received a request to reset the password for your iMedipedia account.
      Click the button below to set a new password.
    </p>

    ${buildButton('Reset Password', resetUrl)}

    ${buildInfoBox('<strong>This link expires in 1 hour.</strong> If you did not request a password reset, you can safely ignore this email.', 'warning')}

    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;">
      <strong>— The iMedipedia Team</strong>
    </p>
  `;
  return buildEmail({
    subject: 'Reset Your iMedipedia Password',
    preview: 'Click the link to reset your iMedipedia account password. Link expires in 1 hour.',
    content,
  });
}

export function buildNewsletterWelcomeEmail({ email, unsubscribeUrl }) {
  const content = `
    <h2 style="margin:0 0 8px;color:${TEXT_COLOR};font-size:22px;">Welcome to the iMedipedia Digest! 📬</h2>
    <p style="margin:0 0 16px;color:${MUTED_COLOR};font-size:15px;line-height:1.6;">
      Thank you for subscribing to the iMedipedia Weekly Research Digest! You are now set to receive our curated clinical updates, board review questions, and medical summaries straight to your inbox.
    </p>

    ${buildInfoBox(`
      <strong>Subscribed Email:</strong> ${escapeHTML(email)}<br>
      You will receive our weekly clinical digest every week.
    `, 'success')}

    <p style="margin:24px 0 0;font-size:12px;color:${MUTED_COLOR};text-align:center;">
      Changed your mind? You can <a href="${escapeHTML(unsubscribeUrl)}" style="color:${BRAND_COLOR};text-decoration:underline;">unsubscribe at any time</a>.
    </p>
  `;
  return buildEmail({
    subject: 'Welcome to iMedipedia Weekly Research Digest',
    preview: 'You are now subscribed to receive weekly clinical summaries from iMedipedia.',
    content,
  });
}

export function buildNewsletterEmail({ title, subject, htmlBody, unsubscribeUrl }) {
  const content = `
    <h2 style="margin:0 0 12px;color:${TEXT_COLOR};font-size:24px;line-height:1.3;">${escapeHTML(title)}</h2>
    <div style="font-size:15px;line-height:1.7;color:${TEXT_COLOR};margin-bottom:24px;">
      ${htmlBody}
    </div>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px;">
    <p style="margin:0;font-size:12px;color:${MUTED_COLOR};text-align:center;">
      You received this email because you subscribed to the iMedipedia Weekly Digest.<br>
      <a href="${escapeHTML(unsubscribeUrl)}" style="color:${BRAND_COLOR};text-decoration:underline;">Unsubscribe from this newsletter</a>
    </p>
  `;
  return buildEmail({
    subject,
    preview: title,
    content,
  });
}

export function buildPeerReviewInviteEmail({ reviewerName, articleTitle, articleType, reviewUrl }) {
  const content = `
    <h2 style="margin:0 0 8px;color:${TEXT_COLOR};font-size:22px;">Peer Review Invitation 🔬</h2>
    <p style="margin:0 0 16px;color:${MUTED_COLOR};font-size:15px;line-height:1.6;">
      Dear ${escapeHTML(reviewerName)},<br><br>
      You have been selected and invited by the iMedipedia Editorial Board to conduct a formal peer review for the following manuscript:
    </p>

    ${buildInfoBox(`
      <strong>Manuscript Title:</strong> ${escapeHTML(articleTitle)}<br>
      <strong>Category:</strong> ${escapeHTML(articleType || 'Clinical Research')}<br>
      <strong>Review Status:</strong> Pending Peer Evaluation
    `, 'info')}

    <p style="margin:16px 0;font-size:14px;color:${TEXT_COLOR};line-height:1.6;">
      Please log in to your Peer Reviewer Dashboard to examine the full article text and complete the standardized clinical evaluation rubric.
    </p>

    ${buildButton('Open Review Portal', reviewUrl)}

    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;">
      Thank you for advancing open, rigorous medical science.<br><br>
      <strong>— The iMedipedia Editorial Board</strong>
    </p>
  `;
  return buildEmail({
    subject: `Peer Review Request: "${articleTitle}"`,
    preview: `You have been invited to peer review the manuscript "${articleTitle}" on iMedipedia.`,
    content,
  });
}

export function buildArticleInReviewEmail({ authorName, articleTitle, reviewerNames, dashboardUrl }) {
  const reviewersList = reviewerNames && reviewerNames.length > 0
    ? reviewerNames.map(n => `• ${escapeHTML(n)}`).join('<br>')
    : 'Assigned expert peer reviewers';

  const content = `
    <h2 style="margin:0 0 8px;color:${TEXT_COLOR};font-size:22px;">Article Sent for Peer Review ⏳</h2>
    <p style="margin:0 0 16px;color:${MUTED_COLOR};font-size:15px;line-height:1.6;">
      Dear ${escapeHTML(authorName)},<br><br>
      Your article has entered the formal peer review stage. The editorial board has assigned your manuscript to our specialist medical reviewers:
    </p>

    ${buildInfoBox(`
      <strong>Manuscript:</strong> ${escapeHTML(articleTitle)}<br>
      <strong>Status:</strong> <span style="color:#6366f1;font-weight:600;">In Review</span><br>
      <strong>Reviewer Panel:</strong><br>${reviewersList}
    `, 'info')}

    <p style="margin:16px 0;font-size:14px;color:${TEXT_COLOR};line-height:1.6;">
      Once the reviewer completes their evaluation, you will receive a direct notification containing their detailed remarks and recommendation.
    </p>

    ${buildButton('Track in Dashboard', dashboardUrl)}

    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;">
      <strong>— The iMedipedia Editorial Team</strong>
    </p>
  `;
  return buildEmail({
    subject: `Your Article is Under Peer Review: "${articleTitle}"`,
    preview: `Your manuscript "${articleTitle}" has been assigned to peer reviewers.`,
    content,
  });
}

export function buildPeerReviewFeedbackEmail({ authorName, articleTitle, reviewerName, recommendation, scores, authorComments, dashboardUrl }) {
  const recColors = {
    accept: '#16a34a',
    minor_revisions: '#d97706',
    major_revisions: '#ea580c',
    reject: '#dc2626'
  };
  const recLabels = {
    accept: 'Accept / Publish Ready',
    minor_revisions: 'Minor Revisions Suggested',
    major_revisions: 'Major Revisions Required',
    reject: 'Unsuitable / Reject'
  };
  const recColor = recColors[recommendation] || '#4f46e5';
  const recLabel = recLabels[recommendation] || recommendation;

  const content = `
    <h2 style="margin:0 0 8px;color:${TEXT_COLOR};font-size:22px;">Peer Review Feedback Received 📝</h2>
    <p style="margin:0 0 16px;color:${MUTED_COLOR};font-size:15px;line-height:1.6;">
      Dear ${escapeHTML(authorName)},<br><br>
      Peer review evaluation has been submitted for your manuscript by <strong>${escapeHTML(reviewerName)}</strong>:
    </p>

    ${buildInfoBox(`
      <strong>Manuscript:</strong> ${escapeHTML(articleTitle)}<br>
      <strong>Recommendation:</strong> <span style="color:${recColor};font-weight:700;">${escapeHTML(recLabel)}</span><br>
      <strong>Scientific/Clinical Accuracy:</strong> ${scores.clinical_accuracy}/5<br>
      <strong>Structure & Clarity:</strong> ${scores.structure}/5<br>
      <strong>Evidence Base & References:</strong> ${scores.evidence}/5
    `, recommendation === 'accept' ? 'success' : 'warning')}

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:20px 0;">
      <h4 style="margin:0 0 8px 0;color:${TEXT_COLOR};font-size:15px;">Reviewer's Detailed Comments & Suggestions:</h4>
      <div style="font-size:14px;line-height:1.7;color:#334155;white-space:pre-wrap;">${escapeHTML(authorComments)}</div>
    </div>

    <p style="margin:16px 0;font-size:14px;color:${TEXT_COLOR};line-height:1.6;">
      You can make any requested revisions to your article right now by clicking below and using the <strong>✏️ Edit</strong> option on your Author Dashboard.
    </p>

    ${buildButton('Edit Article in Dashboard', dashboardUrl)}

    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;">
      <strong>— The iMedipedia Editorial Team</strong>
    </p>
  `;
  return buildEmail({
    subject: `Peer Review Feedback: "${articleTitle}" (${recLabel})`,
    preview: `Peer review feedback has been submitted for "${articleTitle}".`,
    content,
  });
}

export function buildReviewerApprovedEmail({ name, username, password, loginUrl }) {
  const content = `
    <h2 style="margin:0 0 8px;color:${TEXT_COLOR};font-size:22px;">Welcome to the Peer Review Board! 🩺</h2>
    <p style="margin:0 0 16px;color:${MUTED_COLOR};font-size:15px;line-height:1.6;">
      Dear ${escapeHTML(name)},<br><br>
      Congratulations! Your application to join the <strong>iMedipedia Peer Review Board</strong> has been approved. You now have access to review incoming clinical submissions, evaluate medical evidence, and guide prospective authors.
    </p>

    ${buildInfoBox(`
      <strong>Username:</strong> <code style="color:${BRAND_COLOR};font-size:15px;">${escapeHTML(username)}</code><br>
      <strong>Temporary Password:</strong> <code style="color:${BRAND_COLOR};font-size:15px;">${escapeHTML(password)}</code><br>
      <span style="font-size:12px;color:${MUTED_COLOR};">You will be prompted to change this password upon initial login.</span>
    `, 'success')}

    <p style="margin:16px 0;font-size:14px;color:${TEXT_COLOR};line-height:1.6;">
      Please log in to complete your public reviewer profile (academic affiliations, clinical specialties, and ORCID profile).
    </p>

    ${buildButton('Access Reviewer Portal', loginUrl)}

    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;">
      <strong>— The iMedipedia Editorial Board</strong>
    </p>
  `;
  return buildEmail({
    subject: 'Welcome to iMedipedia — Your Peer Reviewer Account is Ready',
    preview: `Congratulations ${name}, your peer reviewer application has been approved!`,
    content,
  });
}

export function buildPeerReviewSubmittedAdminEmail({ reviewerName, reviewerEmail, articleTitle, authorName, recommendation, scores, authorComments, editorNotes, adminDashboardUrl }) {
  const recColors = {
    accept: '#16a34a',
    minor_revisions: '#d97706',
    major_revisions: '#ea580c',
    reject: '#dc2626'
  };
  const recLabels = {
    accept: 'Accept / Publish Ready',
    minor_revisions: 'Minor Revisions Suggested',
    major_revisions: 'Major Revisions Required',
    reject: 'Unsuitable / Reject'
  };
  const recColor = recColors[recommendation] || '#4f46e5';
  const recLabel = recLabels[recommendation] || recommendation;

  const content = `
    <h2 style="margin:0 0 8px;color:${TEXT_COLOR};font-size:22px;">Peer Review Evaluation Completed 🩺</h2>
    <p style="margin:0 0 16px;color:${MUTED_COLOR};font-size:15px;line-height:1.6;">
      Hello Editorial Board,<br><br>
      A peer review evaluation has been submitted by <strong>${escapeHTML(reviewerName)}</strong> (${escapeHTML(reviewerEmail || 'Reviewer')}) for the following manuscript:
    </p>

    ${buildInfoBox(`
      <strong>Manuscript Title:</strong> ${escapeHTML(articleTitle)}<br>
      <strong>Lead Author:</strong> ${escapeHTML(authorName)}<br>
      <strong>Reviewer:</strong> ${escapeHTML(reviewerName)} (${escapeHTML(reviewerEmail || 'N/A')})<br>
      <strong>Editorial Recommendation:</strong> <span style="color:${recColor};font-weight:700;">${escapeHTML(recLabel)}</span><br>
      <strong>Clinical/Medical Accuracy:</strong> ${scores.clinical_accuracy}/5<br>
      <strong>Manuscript Structure & Clarity:</strong> ${scores.structure}/5<br>
      <strong>Evidence Base & Citations:</strong> ${scores.evidence}/5
    `, recommendation === 'accept' ? 'success' : 'info')}

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:20px 0;">
      <h4 style="margin:0 0 8px 0;color:${TEXT_COLOR};font-size:15px;">Reviewer's Feedback for Author:</h4>
      <div style="font-size:14px;line-height:1.7;color:#334155;white-space:pre-wrap;">${escapeHTML(authorComments)}</div>
    </div>

    ${editorNotes ? `
      <div style="background:#fffbeb;border:1px solid #fef3c7;border-left:4px solid #f59e0b;border-radius:8px;padding:16px;margin:20px 0;">
        <h4 style="margin:0 0 8px 0;color:#92400e;font-size:15px;">🔒 Confidential Notes for Editorial Board:</h4>
        <div style="font-size:14px;line-height:1.7;color:#78350f;white-space:pre-wrap;">${escapeHTML(editorNotes)}</div>
      </div>
    ` : ''}

    <p style="margin:16px 0;font-size:14px;color:${TEXT_COLOR};line-height:1.6;">
      You can inspect the full evaluation scorecard, review manuscript edits, or proceed with publication directly in the Admin Portal.
    </p>

    ${buildButton('Open Admin Review Status', adminDashboardUrl)}

    <p style="margin:16px 0 0;font-size:14px;color:${MUTED_COLOR};line-height:1.6;">
      <strong>— iMedipedia Peer Review System</strong>
    </p>
  `;
  return buildEmail({
    subject: `[Review Completed] "${articleTitle}" — ${recLabel}`,
    preview: `Peer review completed by ${reviewerName} for "${articleTitle}" (${recLabel}).`,
    content,
  });
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export { escapeHTML };


