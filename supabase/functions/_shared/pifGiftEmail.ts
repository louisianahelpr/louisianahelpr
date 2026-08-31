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
// Sending and the From header come from the one Resend module — this file used
// to carry its own copy of the fetch and its own SITE_NAME/FROM_DOMAIN pair.
import { FROM_DEFAULT, sanitizeHeaderValue, sendWithResend } from "./resend.ts";
import {
  emailButton,
  emailH1,
  emailP,
  emailShell,
  transactionalFooter,
} from "./emailLayout.ts";
import { brand } from "./email-templates/styles.ts";

export interface PifGiftEmailOpts {
  recipientEmail: string;
  donorName: string;
  amountCents: number;
  message?: string | null;
  claimToken: string;
}

export function renderPifGiftEmail(opts: PifGiftEmailOpts): { html: string; text: string; subject: string } {
  const amount = `$${(opts.amountCents / 100).toFixed(0)}`;
  // The donor name is attacker-influenced free text that lands in the Resend
  // `subject` HEADER. It used to go in raw: a newline in it is the classic
  // header-injection shape. Sanitize ONCE here and use the sanitized value for
  // both the subject and the plaintext body; the HTML body escapes it on top
  // of that.
  const donorSafe = sanitizeHeaderValue(opts.donorName, 80) || "Someone";
  const donor = htmlEscape(donorSafe);
  // Claim link carries only an opaque token — no email in the query string, so
  // the link isn't a PII-leaking, guessable-by-address URL.
  const claimUrl = `${getAppUrl()}/pay-it-forward?claim=${encodeURIComponent(opts.claimToken)}`;
  const note = opts.message?.trim();
  // Italic quoted note, unchanged visually — plus `e-text` so emailShell's
  // dark-mode block recolours it instead of leaving dark type on a dark card.
  const noteHtml = note
    ? `<p class="e-text" style="font-size:15px;line-height:1.6;margin:0 0 24px;padding:14px 16px;background:rgba(94,101,68,0.08);border-radius:10px;color:${brand.olivewood};font-style:italic;">“${htmlEscape(note)}”</p>`
    : "";
  const noteText = note ? `\n\n"${note}"\n` : "";

  // Was `<div style="max-width:480px;margin:0 auto">` — Outlook's Word engine
  // ignores `margin:0 auto` on a block element, so this email left-aligned and
  // stretched to the reading-pane width there. emailShell() is the shared
  // centred-table layout, and it owns the logo: the hand-rolled <img> had
  // width="80" fighting style="width:150px", so the wordmark rendered at two
  // different sizes depending on the client.
  const html = emailShell({
    // Without a preheader the inbox preview is the first words of the body.
    preheader: `${donor} sent you a ${amount} credit to spend on Helpr.`,
    title: `${donor} sent you a ${amount} Helpr credit`,
    body: `${emailH1(`${donor} sent you a ${amount} Helpr credit`)}
${emailP(`Someone wants to help you get something done. Your <strong style="color:${brand.olivewood}">${amount} credit</strong> can go toward any job on Helpr — cleaning, yard work, handyman help, groceries, and more.`)}
${noteHtml}
${emailButton(claimUrl, `Claim your ${amount} credit`, 250)}
${transactionalFooter(
      "New to Helpr? The link will help you create an account and add the credit automatically. If you didn't expect this, you can ignore it.",
    )}`,
  });

  const text = `${donorSafe} sent you a ${amount} Helpr credit.

Your ${amount} credit can go toward any job on Helpr — cleaning, yard work, handyman help, groceries, and more.${noteText}

Claim your credit: ${claimUrl}

New to Helpr? The link will help you create an account and add the credit automatically. If you didn't expect this, you can safely ignore it.`;

  return { html, text, subject: `${donorSafe} sent you a ${amount} Helpr credit` };
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
      from: FROM_DEFAULT,
      subject,
      html,
      text,
    });
    return true;
  } catch (err) {
    // sendWithResend throws on any non-2xx (and on a missing text part). The
    // catch is the contract: a Stripe webhook is upstream of this call.
    console.error("[pifGiftEmail] failed to send gift email", err);
    return false;
  }
}
