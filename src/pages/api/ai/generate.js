export const prerender = false;

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

  // Environment bindings
  const apiBaseUrl = locals.runtime?.env?.AI_API_BASE_URL || import.meta.env.AI_API_BASE_URL;
  const modelName = locals.runtime?.env?.AI_MODEL_NAME || import.meta.env.AI_MODEL_NAME;
  const apiKey = locals.runtime?.env?.AI_API_KEY || import.meta.env.AI_API_KEY;

  if (!apiBaseUrl || !modelName) {
    return new Response(JSON.stringify({ error: "Missing AI endpoint configuration (AI_API_BASE_URL or AI_MODEL_NAME)." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const aiResponse = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey || ""}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: "You are a professional medical science writer." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      })
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      return new Response(JSON.stringify({ error: `External AI API error: ${errText}` }), {
        status: 502,
        headers: { "Content-Type": "application/json" }
      });
    }

    const aiData = await aiResponse.json();
    const result = aiData.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: `Fetch failed: ${error.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
