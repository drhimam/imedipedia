export const prerender = false;

// Simple native Web Crypto PBKDF2/SHA-256 password hashing helper for Cloudflare Workers compatibility.
async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );
  const derivedKey = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    baseKey,
    256
  );
  const derivedHex = bytesToHex(new Uint8Array(derivedKey));
  const saltOutHex = bytesToHex(salt);
  return `${saltOutHex}:${derivedHex}`;
}

async function verifyPassword(password, storedHash) {
  const [saltHex, originalHashHex] = storedHash.split(":");
  if (!saltHex || !originalHashHex) return false;
  const result = await hashPassword(password, saltHex);
  const [, newHashHex] = result.split(":");
  return newHashHex === originalHashHex;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function POST({ request, locals }) {
  const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "D1 database connection binding is missing." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { username, password } = body;
  if (!username || !password) {
    return new Response(JSON.stringify({ error: "Username and Password are required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const user = await db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid username or password." }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return new Response(JSON.stringify({ error: "Invalid username or password." }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Generate session ID
    const sessionBytes = crypto.getRandomValues(new Uint8Array(20));
    const sessionId = bytesToHex(sessionBytes);
    // Expiry: 7 days
    const expiresAt = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

    await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(sessionId, user.id, expiresAt)
      .run();

    return new Response(JSON.stringify({ success: true, user: { username: user.username, role: user.role } }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `session_id=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Internal auth error: ${err.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
