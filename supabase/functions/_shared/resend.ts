// The ONE way Helpr talks to Resend — a thin wrapper over the OFFICIAL SDK.
//
// Before this module there were nine hand-rolled copies of the same
// `fetch('https://api.resend.com/emails')` (send-notification-email,
// process-email-queue, send-account-status-email, send-marketing-blast,
// admin-user-actions, contact-support, pifGiftEmail, notify-email-change,
// admin-update-email). They had drifted: only three passed a `text` part at
// all (HTML-only mail is a direct spam-score penalty and unreadable in
// text-only clients), and exactly one handled a 429 / Retry-After, so the
// other eight hammered the provider straight through a rate-limit penalty.
// Four different From display names and two envelope addresses were in play
// at the same time.
//
// WHY THE SDK RATHER THAN `fetch`
// `npm:resend` is the vendor's own client and is the pattern Supabase
// documents for Edge Functions, so the request shape, the error taxonomy and
// the retry semantics are maintained by Resend instead of by us. v6 returns
// `{ data, error, headers }` — the response headers are what make a correct
// 429 backoff possible (`Retry-After`), which is the one thing the old
// hand-rolled copies mostly got wrong.
//
// Everything that sends mail imports from here. Add a capability HERE, never
// in a caller.

import { Resend } from 'npm:resend@6.25.0'

/**
 * ═════════════════════════════════════════════════════════════════════════
 * THE POSTAL ADDRESS. ONE CONSTANT. ONE EDIT.
 *
 * ── WHAT THE LAW ASKS FOR ───────────────────────────────────────────────
 * CAN-SPAM (15 U.S.C. §7704) puts TWO independent requirements on every
 * message whose primary purpose is COMMERCIAL. Both must hold; satisfying
 * one does not excuse the other.
 *
 *   1. §7704(a)(3)-(4) — A WORKING OPT-OUT. A clear and conspicuous way to
 *      decline further commercial mail, honoured within 10 business days,
 *      functional for at least 30 days after the message was sent, and free
 *      — no login, no fee, no "tell us why" form as a precondition.
 *      → Helpr's is `supabase/functions/email-unsubscribe/index.ts`, reached
 *        from `MarketingFooter` and from the `List-Unsubscribe` headers
 *        below. See that file for the hop-by-hop path.
 *
 *   2. §7704(a)(5)(A)(iii) — A VALID PHYSICAL POSTAL ADDRESS for the sender,
 *      in the body of the message. This is the requirement THIS constant
 *      exists to satisfy, and it is currently UNMET (see below).
 *
 * ── WHAT COUNTS AS A "VALID PHYSICAL POSTAL ADDRESS" ────────────────────
 * The FTC's rule (16 C.F.R. §316.2(p), and the 2008 amendments) accepts
 * exactly three things. Anything else is not an address for this purpose:
 *
 *   (a) The sender's CURRENT STREET ADDRESS — where the business actually
 *       is. A home address is legally sufficient if that is the business
 *       address; that is the usual reason a sole operator balks at this.
 *   (b) A POST OFFICE BOX the sender has REGISTERED WITH THE USPS. An
 *       informally used box number is not enough — it must be a box rented
 *       in the sender's name.
 *   (c) A private mailbox at a COMMERCIAL MAIL RECEIVING AGENCY (a CMRA —
 *       a UPS Store / Postal Annex / registered-agent style mailbox), where
 *       the agency is established under USPS regulations and the box is
 *       registered to the sender.
 *
 * NOT acceptable, however tempting: an email address, a phone number, a URL,
 * a city/parish/state with no delivery point, "New Orleans, LA", a
 * competitor's or a landlord's address, or anything invented. A wrong
 * address is a worse outcome than a missing one — it is an affirmative
 * misrepresentation on top of the omission.
 *
 * ── HOW TO SET IT ───────────────────────────────────────────────────────
 * Put the real address on the line below, formatted as it would be written
 * on an envelope, in ONE line (commas, not newlines):
 *
 *     const POSTAL_ADDRESS_LITERAL = "Louisiana Helpr, 123 Example St, New Orleans, LA 70112"
 *
 * That is the whole change. Every commercial footer in the product reads
 * this one value through `MarketingFooter` — nothing else needs touching,
 * and no template needs to learn about it.
 *
 * You can ALSO set it without a code deploy, which takes precedence:
 *
 *     supabase secrets set HELPR_POSTAL_ADDRESS="Louisiana Helpr, 123 Example St, New Orleans, LA 70112"
 *
 * ── WHAT HAPPENS WHILE IT IS EMPTY (TODAY'S STATE) ──────────────────────
 * It renders as NOTHING. `MarketingFooter` omits the address block entirely
 * when this is blank, so no false or placeholder address is ever printed —
 * the message simply ships without the line the statute wants.
 *
 * That is a KNOWN, ACCEPTED GAP, not an oversight: the owner decided on
 * 2026-08-31 to restore commercial email with the address requirement still
 * unmet, having been told what the statute requires. The opt-out half of the
 * obligation IS implemented and working. Do not add a UI warning about this,
 * and do not re-litigate it — just fill in the line above when the address
 * exists.
 * ═════════════════════════════════════════════════════════════════════════
 */
const POSTAL_ADDRESS_LITERAL = "";

/**
 * The one postal address for every commercial footer in the product.
 *
 * Consumed by exactly one place — `MarketingFooter` in
 * `email-templates/components.tsx` — which every commercial template
 * (`drip.tsx`, `marketing-blast.tsx`, `lifecycle.tsx`) renders. To change it,
 * edit `POSTAL_ADDRESS_LITERAL` above or set `HELPR_POSTAL_ADDRESS`.
 *
 * Trimmed so a secret set to whitespace behaves like "unset" rather than
 * rendering an empty line under the unsubscribe links.
 */
export const POSTAL_ADDRESS = (Deno.env.get("HELPR_POSTAL_ADDRESS") ?? POSTAL_ADDRESS_LITERAL).trim();

/** The Resend-verified sending domain. */
export const SENDER_DOMAIN = "louisianahelpr.com";

/** Envelope address for every outbound Helpr email. */
const SENDER_ADDRESS = `noreply@${SENDER_DOMAIN}`;

/** The one brand display name. Was: "The Helpr Team" / "Helpr" / "Louisiana Helpr". */
const SENDER_NAME = "Helpr";

/** Default From header — use this unless you have a reason not to. */
export const FROM_DEFAULT = `${SENDER_NAME} <${SENDER_ADDRESS}>`;

/**
 * From header for the INTERNAL contact-form relay only (Helpr → the support
 * inbox). Keeping the "Contact" qualifier makes the support inbox sortable at
 * a glance; it never reaches a customer.
 */
export const FROM_CONTACT = `${SENDER_NAME} Contact <${SENDER_ADDRESS}>`;

/** Human support inbox. Overridable so the address can move without a deploy. */
export const SUPPORT_EMAIL = Deno.env.get("SUPPORT_INBOX_EMAIL") || `admin@${SENDER_DOMAIN}`;

/** Mailbox referenced by List-Unsubscribe on commercial/lifecycle mail. */
// RETIRED, deliberately not deleted. Nothing advertises this address any more:
// CAN-SPAM only permits a manual opt-out mechanism if a human honours it within
// 10 business days, and no code here reads that mailbox — so publishing it
// promised a channel nobody was listening on. The signed one-click link is the
// opt-out now. Kept as a named constant so that if the alias is ever actually
// staffed, wiring it back is one import rather than a rediscovery.
// Owner's call, 2026-08-31.
export const UNSUBSCRIBE_MAILBOX = `unsubscribe@${SENDER_DOMAIN}`;

export interface SendEmailParams {
  to: string;
  from: string;
  subject: string;
  html: string;
  /**
   * REQUIRED. A multipart send (text + html) is the single cheapest
   * deliverability win available and the only version a screen reader or a
   * text-only client can read. If you genuinely only have HTML, run it
   * through `htmlToPlainText()` — do not omit it.
   */
  text: string;
  /** Extra Resend headers (List-Unsubscribe on commercial/lifecycle mail). */
  headers?: Record<string, string>;
  /** Reply-To. Set it whenever the copy invites a reply — noreply@ does not accept one. */
  replyTo?: string;
}

/** Error thrown by `sendWithResend`, carrying the HTTP status for the caller. */
interface ResendSendError extends Error {
  status?: number;
  /** Only set on 429, from the Retry-After header (defaults to 60s). */
  retryAfterSeconds?: number;
}

/**
 * Strip control characters from a value that lands in an email HEADER
 * (subject, display name). A newline surviving into a header is the classic
 * header-injection shape and no legitimate subject line contains one.
 */
export function sanitizeHeaderValue(input: unknown, max = 200): string {
  if (typeof input !== "string") return "";
  return input
    // Every C0/C1 control character, no exceptions.
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * LEGACY FALLBACK ONLY — do not reach for this in new code.
 *
 * Every template now renders its plaintext part from the SAME react-email
 * component as its HTML (`email-templates/render.ts`), which is both more
 * accurate and impossible to let drift. This regex exists for exactly one
 * case: a message already sitting on the pgmq queue from before that rule,
 * whose payload carries `html` but no `text`. Such a message can never
 * succeed otherwise (the sender requires a text part), so it would burn its
 * five retries and land in the DLQ instead of being delivered.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cache one client per API key — building it per send is pure overhead. */
const clients = new Map<string, Resend>()
function client(apiKey: string): Resend {
  let c = clients.get(apiKey)
  if (!c) {
    c = new Resend(apiKey)
    clients.set(apiKey, c)
  }
  return c
}

/**
 * Send one email through Resend.
 *
 * Returns the Resend message id (use it as the `email_send_log.message_id`
 * correlation key when you are not going through the queue).
 *
 * Throws a `ResendSendError` with `.status` attached on any failure, and with
 * `.retryAfterSeconds` additionally set on 429 — read from the provider's
 * `Retry-After` response header, which the SDK exposes on the result — so a
 * worker can observe the cooldown instead of hammering through it.
 */
export async function sendWithResend(
  apiKey: string,
  params: SendEmailParams,
): Promise<string> {
  if (!apiKey) {
    const err: ResendSendError = new Error('Resend API key missing')
    err.status = 0
    throw err
  }
  if (!params.text || !params.text.trim()) {
    // Deliberately a hard failure, not a silent HTML-only send: the drift this
    // module exists to end started exactly here.
    const err: ResendSendError = new Error(
      'sendWithResend: `text` is required — render the template with renderEmail() so the plaintext part comes from the same component',
    )
    err.status = 0
    throw err
  }

  // The SDK RESOLVES `{ data, error, headers }` — like supabase-js, it does not
  // throw on a provider-side failure. Dropping `error` here would report every
  // rejected send as delivered.
  const { data, error, headers } = await client(apiKey).emails.send({
    from: params.from,
    to: [params.to],
    subject: params.subject,
    html: params.html,
    text: params.text,
    ...(params.replyTo ? { replyTo: params.replyTo } : {}),
    ...(params.headers ? { headers: params.headers } : {}),
  })

  if (error) {
    const status = error.statusCode ?? 0
    // Message shape kept as `Resend API error [<status>]: <body>` because
    // process-email-queue's rate-limit sniffing also matches on the text.
    const err: ResendSendError = new Error(
      `Resend API error [${status}]: ${error.name ?? 'error'} ${error.message ?? ''}`.trim(),
    )
    err.status = status
    if (status === 429) {
      const retryAfter = headers?.['retry-after'] ?? headers?.['Retry-After']
      const parsed = retryAfter ? parseInt(String(retryAfter), 10) : NaN
      err.retryAfterSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 60
    }
    throw err
  }

  return data?.id ?? ''
}

// `unsubscribeHeaders()` USED TO LIVE HERE and took no arguments: it always
// advertised `List-Unsubscribe-Post: One-Click` against the logged-in
// preferences page, which cannot honour a POST. It now lives in
// `_shared/unsubscribe.ts`, takes the recipient's address, and points at the
// signed `email-unsubscribe` endpoint — import it from there.
//
// This module keeps no unsubscribe logic of its own so there is exactly one
// definition of what an opt-out link is. `UNSUBSCRIBE_MAILBOX` above is the
// only piece that stayed, because it is part of the sender identity.

export interface QueuedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** `email_send_log.template_name` — how this send is found later. */
  templateName: string;
  from?: string;
  headers?: Record<string, string>;
  replyTo?: string;
  queue?: string;
}

export interface QueueEmailResult {
  ok: boolean;
  messageId: string;
  error?: string;
}

/**
 * Log + enqueue one email, the way send-notification-email does it.
 *
 * Every send in the product should be findable in `email_send_log`. Callers
 * that fired a bare `fetch(...).catch(console.error)` showed the operator a
 * success while the recipient got nothing and no row existed to prove it
 * either way — this exists so no caller has to remember the two steps.
 *
 * Never throws: returns `{ ok: false, error }` so the caller can surface a
 * partial-success flag instead of failing an action that already committed.
 *
 * NOTE `supabase.rpc()` RESOLVES `{ data, error }` — it does NOT throw on a
 * Postgres-side failure, so the error is destructured, never assumed away.
 */
export async function queueEmail(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  email: QueuedEmail,
): Promise<QueueEmailResult> {
  const messageId = crypto.randomUUID();
  const queue = email.queue ?? "transactional_emails";

  const { error: logError } = await supabase.from("email_send_log").insert({
    message_id: messageId,
    template_name: email.templateName,
    recipient_email: email.to,
    status: "pending",
  });
  if (logError) {
    // Not fatal — the mail still matters more than the audit row — but it is
    // never silent.
    console.error(`[queueEmail] email_send_log insert failed (${email.templateName}):`, logError.message);
  }

  const { error: enqueueError } = await supabase.rpc("enqueue_email", {
    queue_name: queue,
    payload: {
      message_id: messageId,
      to: email.to,
      from: email.from ?? FROM_DEFAULT,
      sender_domain: SENDER_DOMAIN,
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(email.replyTo ? { reply_to: email.replyTo } : {}),
      ...(email.headers ? { headers: email.headers } : {}),
      purpose: "transactional",
      label: email.templateName,
      queued_at: new Date().toISOString(),
    },
  });

  if (enqueueError) {
    console.error(`[queueEmail] enqueue_email failed (${email.templateName}):`, enqueueError.message);
    await supabase
      .from("email_send_log")
      .update({ status: "failed", error_message: `enqueue_email: ${enqueueError.message}`.slice(0, 1000) })
      .eq("message_id", messageId);
    return { ok: false, messageId, error: enqueueError.message };
  }

  return { ok: true, messageId };
}
