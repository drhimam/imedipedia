export const prerender = false;

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

function base32Decode(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  base32 = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const output = [];
  let bits = 0, value = 0;
  for (const c of base32) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

async function generateTOTP(secret, timeStep = 30, digits = 6) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / timeStep);
  const counterBytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    counterBytes[7 - i] = (counter >>> (i * 8)) & 0xff;
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const hmac = await crypto.subtle.sign('HMAC', cryptoKey, counterBytes);
  const hmacArray = new Uint8Array(hmac);
  const offset = hmacArray[hmacArray.length - 1] & 0xf;
  const binary = ((hmacArray[offset] & 0x7f) << 24)
    | (hmacArray[offset + 1] << 16)
    | (hmacArray[offset + 2] << 8)
    | hmacArray[offset + 3];
  const otp = binary % (10 ** digits);
  return otp.toString().padStart(digits, '0');
}

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

  const { code } = body;
  if (!code || code.length !== 6) {
    return new Response(JSON.stringify({ error: "A valid 6-digit TOTP code is required." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const totpRecord = await db.prepare("SELECT * FROM totp_secrets WHERE user_id = ?")
    .bind(user.id).first();

  if (!totpRecord) {
    return new Response(JSON.stringify({ error: "No TOTP setup found. Please set up MFA first." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const expected = await generateTOTP(totpRecord.secret);
  if (code !== expected) {
    return new Response(JSON.stringify({ error: "Invalid verification code." }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  // Enable MFA
  await db.prepare("UPDATE totp_secrets SET enabled = 1 WHERE user_id = ?").bind(user.id).run();
  await db.prepare("UPDATE users SET mfa_enabled = 1 WHERE id = ?").bind(user.id).run();

  return new Response(JSON.stringify({
    success: true,
    message: "MFA enabled successfully.",
  }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
}
