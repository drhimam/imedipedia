export const prerender = false;

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

  const { token, newPassword } = body;
  if (!token || !newPassword) {
    return new Response(JSON.stringify({ error: "Token and new password are required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const resetTokenRow = await db.prepare("SELECT * FROM password_reset_tokens WHERE id = ? AND expires_at > ?")
      .bind(token, now)
      .first();

    if (!resetTokenRow) {
      return new Response(JSON.stringify({ error: "Invalid or expired reset token." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const userId = resetTokenRow.user_id;

    // Hash the new password
    const newHash = await hashPassword(newPassword);

    // D1 Transactions / Sequential Execution: update password & purge sessions & delete token
    await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, userId).run();
    await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
    await db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(userId).run();

    return new Response(JSON.stringify({ success: true, message: "Password updated successfully. All active sessions revoked." }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Reset password execution failed: ${err.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
