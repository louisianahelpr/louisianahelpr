// Branded "someone sent you a Helpr credit" email for the directed Pay-It-
// Forward gift flow. Sent to ANY email the donor names — the recipient may not
// have an account yet, so the claim link both signs them up and attaches the
// prepaid credit to whatever account they land in (the claim token, not the
// email, is authoritative — see claim-gift-card).
//
// Best-effort by contract: the donor's charge has already captured by the time
// this queues, so a mail failure must never throw back into the webhook. It is
// no longer SILENT, though — a failure pages ops, because for a recipient with
// no account this email is the only delivery channel there is.

import * as React from "npm:react@18.3.1";
import { getAppUrl } from "./appUrl.ts";
// Sending and the From header come from the one Resend module — this file used
// to carry its own copy of the fetch and its own SITE_NAME/FROM_DOMAIN pair.
import { FROM_DEFAULT, queueEmail, sanitizeHeaderValue } from "./resend.ts";
import { postSlackOpsAlert } from "./slack-alerts.ts";
import { GiftCardEmail } from "./email-templates/gift-card.tsx";
import { renderEmail } from "./email-templates/render.ts";

export interface GiftCardEmailOpts {
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
 * ASYNC because react-email's renderer is. `sendGiftCardEmail` awaits it.
 */
async function renderGiftCardEmail(
  opts: GiftCardEmailOpts,
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
  // The Gift Card profile tab, DIRECTLY (Q194, 2026-09-23). This used to be
  // `/gift-card?claim=`, a redirect route kept alive for already-sent emails;
  // prod held 0 gift_cards rows and 0 gift emails in email_send_log when it
  // was deleted, so no sent email carried it. GiftCard.tsx reads `claim` off
  // the tab's own query.
  const claimUrl = `${getAppUrl()}/profile?tab=gift_card&claim=${encodeURIComponent(opts.claimToken)}`;
  const note = opts.message?.trim();

  const { html, text } = await renderEmail(
    React.createElement(GiftCardEmail, {
      donorName: donorSafe,
      amount,
      claimUrl,
      note: note || null,
    }),
  );

  return { html, text, subject: `${donorSafe} sent you a ${amount} Helpr credit` };
}

/**
 * Queue the gift email. Returns true when it reached the queue, false on any
 * failure — never throws, so a webhook caller can log-and-continue without
 * risking the already-captured charge.
 *
 * IT GOES ON THE pgmq QUEUE, not straight to Resend.
 *
 * This used to call `sendWithResend` directly: one synchronous shot from inside
 * the Stripe webhook, with NO retry, NO `email_send_log` row, and — because
 * there is no resend path anywhere in the codebase and no admin gift surface —
 * no way to ever try again. The only trace of a failure was a `logStep` line.
 *
 * That matters more here than almost anywhere else in the product. The headline
 * use of this feature is gifting somebody who does NOT have an account yet, and
 * for them `recipient_id` is null, so the in-app notification is skipped and
 * this email is the ONLY delivery channel that exists. A single transient
 * Resend blip meant the donor was charged and the gift was invisible forever.
 *
 * `queueEmail` writes the `email_send_log` row and hands the message to
 * `process-email-queue`, which drains every 5 minutes with the retry and
 * visibility-timeout behaviour every other transactional mail in the app
 * already gets. A gift arriving a few minutes later is a fair trade for one
 * that arrives at all.
 */
export async function sendGiftCardEmail(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: GiftCardEmailOpts,
): Promise<boolean> {
  try {
    // Rendering is inside the try: it is an async React render and a throw from
    // it must be caught by the same contract that catches a queue failure — a
    // Stripe webhook is upstream of this call.
    const { html, text, subject } = await renderGiftCardEmail(opts);
    const queued = await queueEmail(supabase, {
      to: opts.recipientEmail,
      from: FROM_DEFAULT,
      subject,
      html,
      text,
      templateName: "gift-card",
    });
    if (!queued.ok) {
      // The donor's card has already captured. A gift that never reaches its
      // recipient is money in with nothing out, so this is a page, not a log.
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: "Gift card email could not be queued — recipient may never learn",
        message:
          "A gift card was minted and the donor charged, but the claim email could not be enqueued. If the recipient has no account this was the only delivery channel. Re-send manually from the claim token on the gift_cards row.",
        fields: {
          Recipient: opts.recipientEmail,
          Amount: `$${(opts.amountCents / 100).toFixed(2)}`,
          Error: queued.error ?? "unknown",
        },
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error("[giftCardEmail] failed to queue gift email", err);
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Gift card email threw before it could be queued",
      message:
        "A gift card was minted and the donor charged, but rendering or enqueuing the claim email threw. Re-send manually from the claim token on the gift_cards row.",
      fields: {
        Recipient: opts.recipientEmail,
        Amount: `$${(opts.amountCents / 100).toFixed(2)}`,
        Error: String(err).slice(0, 300),
      },
    });
    return false;
  }
}
