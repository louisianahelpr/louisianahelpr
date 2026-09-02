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

import * as React from "npm:react@18.3.1";
import { getAppUrl } from "./appUrl.ts";
// Sending and the From header come from the one Resend module — this file used
// to carry its own copy of the fetch and its own SITE_NAME/FROM_DOMAIN pair.
import { FROM_DEFAULT, sanitizeHeaderValue, sendWithResend } from "./resend.ts";
import { PifGiftEmail } from "./email-templates/pif-gift.tsx";
import { renderEmail } from "./email-templates/render.ts";

export interface PifGiftEmailOpts {
  recipientEmail: string;
  donorName: string;
  amountCents: number;
  message?: string | null;
  claimToken: string;
}

/**
 * Render both parts of the gift email from ONE react-email component.
 *
 * `renderEmail` produces the HTML and asks react-email for the plaintext twin,
 * so the two can never drift — the hand-written `text` string this function
 * used to carry beside the HTML is gone.
 *
 * ASYNC because react-email's renderer is. `sendPifGiftEmail` awaits it.
 */
async function renderPifGiftEmail(
  opts: PifGiftEmailOpts,
): Promise<{ html: string; text: string; subject: string }> {
  const amount = `$${(opts.amountCents / 100).toFixed(0)}`;
  // The donor name is attacker-influenced free text that lands in the Resend
  // `subject` HEADER. It used to go in raw: a newline in it is the classic
  // header-injection shape. Sanitize ONCE here and use the sanitized value for
  // the subject; React escapes the same value again in the body, so no
  // hand-applied htmlEscape() is needed there any more.
  const donorSafe = sanitizeHeaderValue(opts.donorName, 80) || "Someone";
  // Claim link carries only an opaque token — no email in the query string, so
  // the link isn't a PII-leaking, guessable-by-address URL.
  // `/gift-card`, not `/pay-it-forward` — the feature was renamed 2026-09-02 and
  // this is the link a recipient actually clicks. The OLD path stays alive as a
  // query-preserving redirect precisely because emails sent before today carry
  // it; deleting that route would turn a paid, unclaimed gift into a 404.
  const claimUrl = `${getAppUrl()}/gift-card?claim=${encodeURIComponent(opts.claimToken)}`;
  const note = opts.message?.trim();

  const { html, text } = await renderEmail(
    React.createElement(PifGiftEmail, {
      donorName: donorSafe,
      amount,
      claimUrl,
      note: note || null,
    }),
  );

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
  try {
    // Rendering is inside the try as well: it is now an async React render, and
    // a throw from it must be caught by the same contract that catches a send
    // failure — a Stripe webhook is upstream of this call.
    const { html, text, subject } = await renderPifGiftEmail(opts);
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
