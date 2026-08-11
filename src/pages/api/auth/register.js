export const prerender = false;

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', data, { name: 'PBKDF2' }, false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key, 256
  );
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * POST /api/auth/register
 * Self-registration for contributors.
 * Body: { username, email, password, full_name }
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

  const { username, email, password, full_name } = body;

  if (!email || !password) {
    return new Response(JSON.stringify({ error: "Email and password are required." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  if (password.length < 8) {
    return new Response(JSON.stringify({ error: "Password must be at least 8 characters." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(JSON.stringify({ error: "Please provide a valid email address." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const uname = (username || email).trim();
    const existing = await db.prepare(
      "SELECT id FROM users WHERE username = ? OR email = ?"
    ).bind(uname, email).first();

    if (existing) {
      return new Response(JSON.stringify({ error: "A user with this username or email already exists." }), {
        status: 409, headers: { "Content-Type": "application/json" }
      });
    }

    const userId = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const passwordHash = await hashPassword(password);
    const now = Math.floor(Date.now() / 1000);

    await db.prepare(
      `INSERT INTO users (id, username, password_hash, role, email, full_name)
       VALUES (?, ?, ?, 'contributor', ?, ?)`
    ).bind(userId, uname, passwordHash, email, (full_name || '').trim()).run();

    return new Response(JSON.stringify({
      success: true,
      message: "Account created. You can now log in.",
    }), {
      status: 201, headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: `Registration failed: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
