export const prerender = false;

// --- TOTP Helpers ---

// Base32 decode (RFC 4648)
function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  str = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bits = [];
  for (let i = 0; i < str.length; i++) {
    const val = alphabet.indexOf(str[i]);
    if (val === -1) continue;
    const b = val.toString(2).padStart(5, '0');
    for (let j = 0; j < 5; j++) bits.push(b[j]);
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | (bits[i * 8 + j] === '1' ? 1 : 0);
    }
    bytes[i] = byte;
  }
  return bytes;
}

// TOTP code generation (HMAC-SHA1, 6 digits, 30s step)
async function generateTOTP(secretBytes, timeStep) {
  timeStep = timeStep || Math.floor(Date.now() / 1000 / 30);
  // Build 8-byte big-endian counter
  const counter = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    counter[i] = timeStep & 0xFF;
    timeStep = Math.floor(timeStep / 256);
  }
  // HMAC-SHA1
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  // Dynamic truncation (RFC 4226)
  const offset = hmac[hmac.length - 1] & 0x0F;
  const code = ((hmac[offset] & 0x7F) << 24) |
               ((hmac[offset + 1] & 0xFF) << 16) |
               ((hmac[offset + 2] & 0xFF) << 8) |
               (hmac[offset + 3] & 0xFF);
  return String(code % 1000000).padStart(6, '0');
}

async function verifyTOTP(secretStr, code) {
  const secretBytes = base32Decode(secretStr);
  const nowStep = Math.floor(Date.now() / 1000 / 30);
  // Check current, previous, and next time windows (30s tolerance)
  for (let step = nowStep - 1; step <= nowStep + 1; step++) {
    const expected = await generateTOTP(secretBytes, step);
    if (expected === code) return true;
  }
  return false;
}

// --- Password Helpers ---

async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits", "deriveKey"]);
  const derivedKey = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, baseKey, 256);
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
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  // --- MFA Step 2: TOTP verification ---
  if (body.totpCode && body.tempSessionId) {
    try {
      const tempSession = await db.prepare(
        "SELECT * FROM sessions WHERE id = ? AND expires_at > ?"
      ).bind(body.tempSessionId, Math.floor(Date.now() / 1000)).first();

      if (!tempSession) {
        return new Response(JSON.stringify({ error: "MFA session expired. Please log in again." }), {
          status: 401, headers: { "Content-Type": "application/json" }
        });
      }

      // Verify this is a temp MFA session
      if (tempSession.id.indexOf('mfa_') !== 0) {
        return new Response(JSON.stringify({ error: "Invalid session. Please log in again." }), {
          status: 401, headers: { "Content-Type": "application/json" }
        });
      }

      const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(tempSession.user_id).first();
      if (!user) {
        return new Response(JSON.stringify({ error: "User not found." }), {
          status: 401, headers: { "Content-Type": "application/json" }
        });
      }

      // Get TOTP secret
      const totp = await db.prepare("SELECT * FROM totp_secrets WHERE user_id = ? AND enabled = 1")
        .bind(user.id).first();
      if (!totp) {
        return new Response(JSON.stringify({ error: "MFA not configured." }), {
          status: 400, headers: { "Content-Type": "application/json" }
        });
      }

      const valid = await verifyTOTP(totp.secret, String(body.totpCode).trim());
      if (!valid) {
        return new Response(JSON.stringify({ error: "Invalid verification code." }), {
          status: 401, headers: { "Content-Type": "application/json" }
        });
      }

      // Delete temp MFA session
      await db.prepare("DELETE FROM sessions WHERE id = ?").bind(body.tempSessionId).run();

      // Issue real session
      const sessionBytes = crypto.getRandomValues(new Uint8Array(20));
      const sessionId = bytesToHex(sessionBytes);
      const expiresAt = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

      await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(sessionId, user.id, expiresAt).run();

      return new Response(JSON.stringify({
        success: true,
        user: {
          username: user.username,
          role: user.role,
          force_password_change: !!user.force_password_change
        }
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": `session_id=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: `MFA verification failed: ${err.message}` }), {
        status: 500, headers: { "Content-Type": "application/json" }
      });
    }
  }

  // --- Password Step ---
  const { username, password } = body;
  if (!username || !password) {
    return new Response(JSON.stringify({ error: "Username and Password are required." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const user = await db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid username or password." }), {
        status: 401, headers: { "Content-Type": "application/json" }
      });
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return new Response(JSON.stringify({ error: "Invalid username or password." }), {
        status: 401, headers: { "Content-Type": "application/json" }
      });
    }

    // Check if MFA is enabled
    const totp = await db.prepare("SELECT * FROM totp_secrets WHERE user_id = ? AND enabled = 1")
      .bind(user.id).first();

    if (totp) {
      // MFA required — create temporary session
      const tempSessionId = 'mfa_' + bytesToHex(crypto.getRandomValues(new Uint8Array(20)));
      const tempExpires = Math.floor(Date.now() / 1000) + (5 * 60); // 5 minutes for MFA step

      await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(tempSessionId, user.id, tempExpires).run();

      return new Response(JSON.stringify({
        mfaRequired: true,
        tempSessionId: tempSessionId
      }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    // No MFA — issue real session directly
    const sessionBytes = crypto.getRandomValues(new Uint8Array(20));
    const sessionId = bytesToHex(sessionBytes);
    const expiresAt = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);

    await db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
      .bind(sessionId, user.id, expiresAt).run();

    return new Response(JSON.stringify({
      success: true,
      user: {
        username: user.username,
        role: user.role,
        force_password_change: !!user.force_password_change
      }
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `session_id=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Internal auth error: ${err.message}` }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
