export const prerender = false;

import { chatCompletion } from '../../../lib/ai.js';

export async function POST({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "D1 database connection binding is missing." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Session Authentication Check
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(/session_id=([^;]+)/);
  const sessionId = match ? match[1] : null;

  if (!sessionId) {
    return new Response(JSON.stringify({ error: "Unauthorized: No active session." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Validate session against database
  const now = Math.floor(Date.now() / 1000);
  const session = await db.prepare("SELECT * FROM sessions WHERE id = ? AND expires_at > ?")
    .bind(sessionId, now)
    .first();

  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized: Invalid or expired session." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Parse generating request payload
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { prompt } = payload;
  if (!prompt) {
    return new Response(JSON.stringify({ error: "Missing required 'prompt' field." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const env = locals.runtime?.env || import.meta.env;

  try {
    const result = await chatCompletion(env, {
      system: "You are a professional medical science writer.",
      user: prompt,
      temperature: 0.7,
    });

    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}
