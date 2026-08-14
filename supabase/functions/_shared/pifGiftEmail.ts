// Branded "someone sent you a Helpr credit" email for the directed Pay-It-
// Forward gift flow. Sent to ANY email the donor names — the recipient may not
// have an account yet, so the claim link both signs them up and attaches the
// prepaid credit to whatever account they land in (the claim token, not the
// email, is authoritative — see claim-pif-credit).
//
// Best-effort by contract: the donor's charge has already captured by the time
// this sends, so a mail failure must never throw back into the webhook. Callers
// log and move on; the credit still exists and shows under "Gifts sent to you"
// once the recipient signs in with the named email.

import { htmlEscape } from "./safe-strings.ts";
import { getAppUrl } from "./appUrl.ts";

const SITE_NAME = "Helpr";
const FROM_DOMAIN = "louisianahelpr.com";

export interface PifGiftEmailOpts {
  recipientEmail: string;
  donorName: string;
  amountCents: number;
  message?: string | null;
  claimToken: string;
}

async function sendWithResend(
  apiKey: string,
  params: { to: string; from: string; subject: string; html: string; text: string },
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

export function renderPifGiftEmail(opts: PifGiftEmailOpts): { html: string; text: string; subject: string } {
  const amount = `$${(opts.amountCents / 100).toFixed(0)}`;
  const donor = htmlEscape(opts.donorName || "Someone");
  // Claim link carries only an opaque token — no email in the query string, so
  // the link isn't a PII-leaking, guessable-by-address URL.
  const claimUrl = `${getAppUrl()}/pay-it-forward?claim=${encodeURIComponent(opts.claimToken)}`;
  const note = opts.message?.trim();
  const noteHtml = note
    ? `<p style="font-size:15px;line-height:1.6;margin:0 0 24px;padding:14px 16px;background:rgba(94,101,68,0.08);border-radius:10px;color:#2E2F22;font-style:italic;">“${htmlEscape(note)}”</p>`
    : "";
  const noteText = note ? `\n\n"${note}"\n` : "";

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
<body style="background:#F0F2F4;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;margin:0;padding:24px;color:#2E2F22;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px 28px;border:1px solid #CBCFD8;">
    <img src="https://www.louisianahelpr.com/helpr-wordmark.png" alt="Louisiana Helpr" width="150" style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;text-decoration:none;margin:0 0 24px;" />
    <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;line-height:1.3;">${donor} sent you a ${amount} Helpr credit</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;color:#55656D;">
      Someone wants to help you get something done. Your <strong style="color:#2E2F22;">${amount} credit</strong> can go toward any job on Helpr — cleaning, yard work, handyman help, groceries, and more.
    </p>
    ${noteHtml}
    <a href="${claimUrl}" style="display:inline-block;background:#5E6544;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:600;font-size:15px;">Claim your ${amount} credit</a>
    <p style="font-size:12px;line-height:1.6;margin:32px 0 0;color:#6E7C83;">
      New to Helpr? The link will help you create an account and add the credit automatically. If you didn't expect this, you can ignore it.
    </p>
  </div>
</body></html>`;

  const text = `${opts.donorName || "Someone"} sent you a ${amount} Helpr credit.

Your ${amount} credit can go toward any job on Helpr — cleaning, yard work, handyman help, groceries, and more.${noteText}

Claim your credit: ${claimUrl}

New to Helpr? The link will help you create an account and add the credit automatically. If you didn't expect this, you can safely ignore it.`;

  return { html, text, subject: `${opts.donorName || "Someone"} sent you a ${amount} Helpr credit` };
}

/**
 * Send the gift email. Returns true on success, false on any failure (missing
 * key or Resend error) — never throws, so a webhook caller can log-and-continue
 * without risking the already-captured charge.
 */
export async function sendPifGiftEmail(opts: PifGiftEmailOpts): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("[pifGiftEmail] RESEND_API_KEY not configured — gift email not sent");
    return false;
  }
  const { html, text, subject } = renderPifGiftEmail(opts);
  try {
    await sendWithResend(apiKey, {
      to: opts.recipientEmail,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      subject,
      html,
      text,
    });
    return true;
  } catch (err) {
    console.error("[pifGiftEmail] failed to send gift email", err);
    return false;
  }
}
