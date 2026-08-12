export const prerender = false;

import { chatCompletion } from '../../../../lib/ai.js';

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

// --- Type-specific system prompts ---
const TYPE_SYSTEM = {
  general:
    "You are a senior medical editor who writes evidence-based Research/Clinical Digests for practicing clinicians. " +
    "Write in clean Markdown. Prioritize clinical accuracy and current evidence; clearly separate established knowledge " +
    "from emerging or uncertain findings. Use headings, bullet lists, and tables where they aid scanability. " +
    "Never invent citations, specific statistics, or study identifiers.",
  update:
    "You are a clinical guideline editor. You summarize guideline updates in an easy-to-understand, tabular and " +
    "infographic-first style for clinicians. Prefer Markdown tables over prose. Include strength-of-recommendation " +
    "(e.g. Class I–III, Level A–C) where relevant. Be explicit about what changed versus the previous version.",
  case:
    "You are a medical case-report author who follows the CARE (CAse REport) guidelines. Write a structured, " +
    "professional case report in Markdown with clear section headings. De-identify patient details (no names, dates, " +
    "or identifiers). Support discussion with high-quality evidence where relevant, but do not fabricate citations.",
  education:
    "You are a medical educator who creates board-review / CME material. Write high-yield, exam-focused content in " +
    "Markdown. Use mnemonics, comparison tables, bullet lists of high-yield points, and board-style multiple-choice " +
    "questions with answers and explanations.",
};

function buildUserPrompt(input) {
  const { type, title, topic, subjects, exams, brief, fineTune, caseNotes, guidelineVersion, comparePrevious } = input;

  const subjectsList = (Array.isArray(subjects) ? subjects : []).filter(Boolean).join(', ') || 'General Medicine';
  const examsList = (Array.isArray(exams) ? exams : []).filter(Boolean).join(', ') || '';
  const workingTitle = (title || '').trim() || (topic || '').trim() || 'Medical Article';

  const lines = [];

  if (type === 'update') {
    lines.push(`Write a Clinical Guidelines update article titled "${workingTitle}".`);
    if (guidelineVersion) lines.push(`Guideline: ${guidelineVersion}.`);
    lines.push(`Topic: ${(topic || '').trim() || 'General medicine'}.`);
    if (comparePrevious) lines.push('Compare this version against the previous version and clearly highlight what changed.');
  } else if (type === 'case') {
    lines.push(`Write a Case Report titled "${workingTitle}".`);
    if (caseNotes && caseNotes.trim()) {
      lines.push('Raw case notes provided by the author:\n"""\n' + caseNotes.trim() + '\n"""');
    }
    if ((topic || '').trim()) lines.push(`Topic: ${topic.trim()}.`);
  } else if (type === 'education') {
    lines.push(`Write a CME & Learning (Board Review) article titled "${workingTitle}".`);
    if ((topic || '').trim()) lines.push(`Topic: ${topic.trim()}.`);
    if (examsList) lines.push(`Target exams: ${examsList}.`);
  } else {
    lines.push(`Write a Research/Clinical Digest article titled "${workingTitle}".`);
    if ((topic || '').trim()) lines.push(`Topic: ${topic.trim()}.`);
  }

  lines.push(`Relevant subjects: ${subjectsList}.`);
  if (examsList && type !== 'education') lines.push(`Relevant exams: ${examsList}.`);
  if (brief && brief.trim()) lines.push(`Editorial brief: ${brief.trim()}.`);
  if (fineTune && fineTune.trim()) lines.push(`Additional fine-tuning instructions: ${fineTune.trim()}.`);

  if (type === 'update') {
    lines.push('\nUse this Markdown structure:');
    lines.push('## Overview');
    lines.push('## Key Recommendations (table: Recommendation | Strength | Change)');
    lines.push('## What Changed vs Previous Version (table: Area | Previous | Current | Rationale)');
    lines.push('## Practice Implications');
    lines.push('\nPrefer tables. Make it easy to understand.');
  } else if (type === 'case') {
    lines.push('\nUse this CARE Markdown structure:');
    lines.push('## Introduction');
    lines.push('## Case Presentation');
    lines.push('## Investigations');
    lines.push('## Differential Diagnosis');
    lines.push('## Treatment');
    lines.push('## Outcome & Follow-up');
    lines.push('## Discussion');
    lines.push('## Learning Points');
    lines.push('## References');
    lines.push('\nDe-identify the patient. Do not fabricate citations.');
  } else if (type === 'education') {
    lines.push('\nUse this Markdown structure:');
    lines.push('## Overview');
    lines.push('## High-Yield Key Points (bullets)');
    lines.push('## Mnemonics');
    lines.push('## Comparison Tables (Markdown table)');
    lines.push('## Board-Style Questions (Q&A with answers + explanations)');
    lines.push('## Summary');
    lines.push('\nMake it high-yield and exam-focused.');
  } else {
    lines.push('\nUse this Markdown structure:');
    lines.push('## Background');
    lines.push('## What\'s New (recent evidence, changed concepts, practice shifts, guideline updates, outbreaks, or medically important news)');
    lines.push('## Clinical & Practice Impact');
    lines.push('## Bottom Line');
    lines.push('\nWrite comprehensive, up-to-date, clinically accurate content. Use tables and bullet lists where helpful.');
  }

  return lines.join('\n');
}

/**
 * POST /api/admin/studio/generate
 * Body: { type, title, topic, subjects[], exams[], brief, fineTune?, caseNotes?, guidelineVersion?, comparePrevious? }
 * Runs a multi-step pipeline: body → (refined title + TL;DR in parallel).
 * Returns: { title, description, body }
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

  const type = TYPE_SYSTEM[input.type] ? input.type : 'general';
  const hasSeed = (input.title || '').trim() || (input.topic || '').trim() || (input.brief || '').trim() || (input.caseNotes || '').trim();
  if (!hasSeed) {
    return new Response(JSON.stringify({ error: "Provide a title, topic, brief, or case notes to generate from." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const env = locals.runtime?.env || {};

  try {
    const system = TYPE_SYSTEM[type];
    const userPrompt = buildUserPrompt({ ...input, type });

    // 1. Body
    const body = await chatCompletion(env, { system, user: userPrompt, temperature: 0.7 });

    // 2. Refined title + TL;DR in parallel (both derive from the finished body)
    const [refinedTitle, description] = await Promise.all([
      chatCompletion(env, {
        system: 'You are a medical editor. Produce a concise, SEO-friendly title.',
        user:
          'Refine the title for the following medical article into a crisp, professional, SEO-friendly title. ' +
          'Return ONLY the title text (no quotes, no markdown, max ~120 characters).\n\n' +
          `Working title: ${input.title || input.topic || ''}\nTopic: ${input.topic || ''}\n\n` +
          `Article:\n${body.slice(0, 6000)}`,
        temperature: 0.5,
      }),
      chatCompletion(env, {
        system: 'You are a medical editor. Produce a concise TL;DR summary.',
        user:
          'Write a TL;DR summary (2–3 sentences) of the following medical article. ' +
          'Return ONLY the summary as plain text (no markdown, no headings, no "TL;DR" label).\n\n' +
          `Article:\n${body.slice(0, 6000)}`,
        temperature: 0.4,
      }),
    ]);

    const cleanTitle = (refinedTitle || input.title || '').trim().slice(0, 200);
    const cleanDescription = (description || '').trim().slice(0, 600);

    return new Response(JSON.stringify({
      title: cleanTitle,
      description: cleanDescription,
      body: body.trim(),
    }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Generation failed: ${err.message}` }), {
      status: 502, headers: { "Content-Type": "application/json" }
    });
  }
}
