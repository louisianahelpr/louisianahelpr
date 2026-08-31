// The ONE way Helpr talks to Resend.
//
// Before this module there were nine hand-rolled copies of the same fetch
// (send-notification-email, process-email-queue, send-account-status-email,
// send-marketing-blast, admin-user-actions, contact-support, pifGiftEmail,
// notify-email-change, admin-update-email). They had drifted: only three
// passed a `text` part at all (HTML-only mail is a direct spam-score penalty
// and unreadable in text-only clients), and exactly one of them handled a 429
// / Retry-After, so the other eight hammered the provider straight through a
// rate-limit penalty. Four different From display names and two different
// envelope addresses were in play at the same time.
//
// Everything that sends mail imports from here. Add a capability HERE, never
// in a caller.

/**
 * ─────────────────────────────────────────────────────────────────────────
 * ACTION REQUIRED BY THE BUSINESS OWNER — CAN-SPAM §7704(a)(5)
 *
 * Commercial email (the marketing blast and the lifecycle/drip sequences)
 * must carry a valid PHYSICAL POSTAL ADDRESS for the sender. Helpr's address
 * is not in this repo and must NOT be invented, so it is read from a
 * Supabase function secret:
 *
 *     supabase secrets set HELPR_POSTAL_ADDRESS="123 Example St, Suite 4, New Orleans, LA 70112"
 *
 * Until that secret is set the constant is an empty string and the footer
 * renders WITHOUT a postal address — which means the marketing blast and the
 * engagement drips are shipping non-compliant. Set it before the next
 * commercial send.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const POSTAL_ADDRESS = Deno.env.get("HELPR_POSTAL_ADDRESS") ?? "";

export const RESEND_API_URL = "https://api.resend.com/emails";

/** The Resend-verified sending domain. */
export const SENDER_DOMAIN = "louisianahelpr.com";

/** Envelope address for every outbound Helpr email. */
export const SENDER_ADDRESS = `noreply@${SENDER_DOMAIN}`;

/** The one brand display name. Was: "The Helpr Team" / "Helpr" / "Louisiana Helpr". */
export const SENDER_NAME = "Helpr";

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
export interface ResendSendError extends Error {
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

/** Best-effort HTML → plaintext, for callers that only ever had an HTML body. */
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

/**
 * Send one email through Resend.
 *
 * Returns the Resend message id (use it as the `email_send_log.message_id`
 * correlation key when you are not going through the queue).
 *
 * Throws a `ResendSendError` with `.status` attached on any non-2xx, and with
 * `.retryAfterSeconds` additionally set on 429 so a worker can observe the
 * provider's cooldown instead of hammering through it.
 */
export async function sendWithResend(
  apiKey: string,
  params: SendEmailParams,
): Promise<string> {
  if (!apiKey) {
    const err: ResendSendError = new Error("Resend API key missing");
    err.status = 0;
    throw err;
  }
  if (!params.text || !params.text.trim()) {
    // Deliberately a hard failure, not a silent HTML-only send: the drift this
    // module exists to end started exactly here.
    const err: ResendSendError = new Error(
      "sendWithResend: `text` is required — pass a plaintext part (htmlToPlainText() if you have nothing else)",
    );
    err.status = 0;
    throw err;
  }

  const res = await fetch(RESEND_API_URL, {
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
      ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      ...(params.headers ? { headers: params.headers } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Message shape kept as `Resend API error [<status>]: <body>` because
    // process-email-queue's rate-limit sniffing also matches on the text.
    const err: ResendSendError = new Error(`Resend API error [${res.status}]: ${body}`);
    err.status = res.status;
    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const parsed = retryAfter ? parseInt(retryAfter, 10) : NaN;
      err.retryAfterSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
    }
    throw err;
  }

  const json = await res.json().catch(() => ({} as Record<string, unknown>));
  return typeof (json as { id?: unknown }).id === "string" ? (json as { id: string }).id : "";
}

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
