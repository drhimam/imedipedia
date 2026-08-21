export const prerender = false;

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { buildDonationThankYouEmail, formatSenderAddress } from "../_email-template.js";

export async function POST({ request, locals }) {
  try {
    // Read the raw request body as text to preserve exact parameter order and encoding
    const rawBody = await request.text();
    
    // Parse parameters from raw urlencoded text
    const searchParams = new URLSearchParams(rawBody);
    const params = {};
    for (const [key, value] of searchParams.entries()) {
      params[key] = value;
    }

    const {
      txn_id,
      payer_email,
      first_name,
      last_name,
      mc_gross,
      mc_currency,
      payment_status,
      test_ipn
    } = params;

    // Validate IPN message authenticity by posting the exact raw body back to PayPal
    const verifyBody = 'cmd=_notify-validate&' + rawBody;

    const paypalUrl = test_ipn === '1' 
      ? 'https://ipnpb.sandbox.paypal.com/cgi-bin/webscr' 
      : 'https://ipnpb.paypal.com/cgi-bin/webscr';

    let isVerified = false;
    try {
      const verifyResp = await fetch(paypalUrl, {
        method: 'POST',
        body: verifyBody,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'iMedipedia-IPN-Handler'
        }
      });
      const verificationText = await verifyResp.text();
      isVerified = verificationText.trim() === 'VERIFIED';
      
      if (!isVerified) {
        console.warn("PayPal IPN verify check returned:", verificationText);
      }
    } catch (verifyErr) {
      console.error("PayPal verification connection error:", verifyErr.message);
    }

    // Allow mock/unverified requests ONLY in local development for testing convenience
    const isDev = process.env.NODE_ENV === 'development' || !locals.runtime;
    if (!isVerified && !isDev) {
      return new Response("IPN Verification Failed", { status: 400 });
    }

    // Process completed payments
    if (payment_status === 'Completed' || (isDev && payer_email)) {
      const db = locals.runtime?.env?.D1_DB || locals.runtime?.env?.DB;
      const donorName = `${first_name || ''} ${last_name || ''}`.trim();
      const amountFloat = parseFloat(mc_gross || '0');
      const now = Math.floor(Date.now() / 1000);

      // 1. Log transaction in the D1 Database (graceful catch if table doesn't exist)
      if (db) {
        try {
          await db.prepare(
            "INSERT OR IGNORE INTO donations (txn_id, donor_name, donor_email, amount, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          ).bind(
            txn_id || `MOCK_TXN_${crypto.randomUUID()}`,
            donorName,
            payer_email,
            amountFloat,
            mc_currency || 'USD',
            payment_status || 'Completed',
            now
          ).run();
        } catch (dbErr) {
          console.warn("D1 donation logging failed (likely schema table not applied yet):", dbErr.message);
        }
      }

      // 2. Dispatch thank-you email via AWS SES
      const awsAccessKey = locals.runtime?.env?.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
      const awsSecretKey = locals.runtime?.env?.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
      const awsRegion = locals.runtime?.env?.AWS_REGION || process.env.AWS_REGION || "us-east-1";
      const fromEmail = locals.runtime?.env?.SES_FROM_EMAIL || process.env.SES_FROM_EMAIL || "info@imedipedia.com";
      const senderName = locals.runtime?.env?.SES_FROM_NAME || process.env.SES_FROM_NAME || "iMedipedia Support";

      if (awsAccessKey && awsSecretKey && payer_email) {
        try {
          const ses = new SESClient({
            region: awsRegion,
            credentials: { accessKeyId: awsAccessKey, secretAccessKey: awsSecretKey }
          });
          const html = buildDonationThankYouEmail({
            name: donorName,
            amount: mc_gross || '0.00',
            currency: mc_currency || 'USD'
          });
          const command = new SendEmailCommand({
            Source: formatSenderAddress(fromEmail, senderName),
            Destination: { ToAddresses: [payer_email] },
            Message: {
              Subject: { Data: "Thank you for your donation to iMedipedia! ❤️", Charset: "UTF-8" },
              Body: { Html: { Data: html, Charset: "UTF-8" } }
            }
          });
          await ses.send(command);
        } catch (sesErr) {
          console.error("SES thank you email error:", sesErr.message);
        }
      } else {
        console.warn("Skipping SES email send: AWS credentials or payer email missing.");
      }
    }

    return new Response("OK", { status: 200 });

  } catch (err) {
    console.error("IPN handler general error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
