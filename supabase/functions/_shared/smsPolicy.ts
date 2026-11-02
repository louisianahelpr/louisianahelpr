// SMS alerts: the pure parts, shared by send-sms-notification and
// twilio-inbound and unit-tested in src/test/smsPolicy.test.ts.
//
// PRIVACY RULE (owner, 2026-10-20): a text is built ONLY from a fixed phrase
// chosen by `kind`, plus a link made from our own app URL and a job uuid.
// A notification's title or body is never an input here: they carry full
// names, job titles and street addresses, and SMS is not end-to-end private.
//
// ZERO imports, so the edge harness and vitest load the real module.

/**
 * What a text is about: public.sms_kind_for() (20261021193738) decides it from
 * the notification's type and exact title. SMS_KIND_PHRASES lists exactly the
 * kinds that function returns, plus 'confirm' (src/test/smsAlerts.test.ts). There is no nearby-job kind: a
 * job_match notification is never texted (owner 2026-10-23, migration 20261023181442).
 */
export type SmsKind =
  | "message" | "job_offer" | "application" | "starting_soon" | "reschedule"
  | "dispute" | "job_cancelled" | "money_problem" | "job_update" | "needs_you" | "confirm";

export const SMS_KIND_PHRASES: Record<SmsKind, string> = {
  message: "You have a new message.",
  job_offer: "New job offer. Answer before it expires.",
  application: "Someone applied to your job.",
  starting_soon: "Your job starts soon.",
  reschedule: "A new date or time was requested on a job.",
  dispute: "A problem was reported on one of your jobs.",
  job_cancelled: "One of your jobs was cancelled.",
  money_problem: "There is a problem with a payment or payout. Please check your account.",
  job_update: "There is an update on one of your jobs.",
  // A3-85 (owner 11-01): a step due before a deadline (answer an offer or a refund step, check out, hand over,
  // approve finished work). Migration 20261102002011.
  needs_you: "Something needs you before a deadline.",
  confirm: "",
};
const PHRASES = SMS_KIND_PHRASES;

/**
 * The double opt-in text, sent once when a member ticks the box. Alerts start
 * only after the phone replies YES with the 4-digit code in THIS text: the
 * code ties the YES to the account the confirmation was sent for, so another
 * account that asked for the same number cannot take the opt-in (lh-authz-rls
 * review of the SMS slice). Carries the CTIA disclosures (program, frequency,
 * rates, HELP, STOP); no link, so it cannot be mistaken for phishing.
 */
export function smsConfirmText(code: string): string {
  if (!/^\d{4}$/.test(code)) throw new Error("a confirmation code is 4 digits");
  return `Louisiana Helpr: Reply YES ${code} to get alerts about your jobs and messages. Msg frequency varies. Msg&data rates may apply. HELP for help, STOP to cancel.`;
}

/** The reply to a YES without the code (nothing changes). */
export const SMS_CONFIRM_HINT =
  "Louisiana Helpr: to turn on alerts, reply YES and the 4-digit code from our text, like YES 1234. Reply STOP to cancel.";

/** "YES 4821" (or START/OPTIN 4821) -> "4821"; anything else -> null. */
export function parseConfirmCode(body: unknown): string | null {
  if (typeof body !== "string") return null;
  const m = body.trim().replace(/[.!]+$/, "").match(/^(?:YES|START|OPTIN)\s+(\d{4})$/i);
  return m ? m[1] : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSmsKind(v: unknown): v is SmsKind {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PHRASES, v);
}

/** The in-app path a text links to. Only a well-formed uuid is ever embedded. */
export function smsLinkPath(kind: SmsKind, jobId: unknown): string {
  if (kind === "message") return "/messages";
  if (kind === "money_problem") return "/profile?tab=earnings";
  if (typeof jobId === "string" && UUID_RE.test(jobId)) return `/jobs?job=${jobId.toLowerCase()}`;
  // A needs-you reminder with no job is a Declutter step (offer, refund, checkout, pickup).
  if (kind === "needs_you") return "/declutter";
  return "/jobs";
}

/**
 * The whole text. Kept under 160 GSM-7 characters so it is billed as one
 * segment (no emoji: one emoji turns the text into UCS-2 and 70-char segments).
 * The first text after an opt-in also says how to stop.
 */
export function buildSmsBody(input: {
  kind: SmsKind;
  jobId?: unknown;
  firstText: boolean;
  appUrl: string;
  /** The 4-digit code a confirmation text carries (kind 'confirm' only). */
  confirmCode?: unknown;
}): string {
  if (input.kind === "confirm") return smsConfirmText(String(input.confirmCode ?? ""));
  const base = input.appUrl.replace(/\/+$/, "");
  const parts = ["Louisiana Helpr:", PHRASES[input.kind], `${base}${smsLinkPath(input.kind, input.jobId)}`];
  if (input.firstText) parts.push("Reply STOP to stop.");
  return parts.join(" ");
}

/**
 * The text the owner gets when someone writes to support (owner 10-30). Fixed words and a link, so nothing a member or
 * guest typed ever goes by SMS. The link is the Support inbox; a reply in a Team thread shows only in that thread, so it
 * links there (lead 10-30). Only a well-formed uuid is ever embedded.
 */
export function ownerSupportText(appUrl: string, teamThreadUserId?: unknown): string {
  const path = typeof teamThreadUserId === "string" && UUID_RE.test(teamThreadUserId)
    ? `/messages?teamThread=${teamThreadUserId.toLowerCase()}`
    : "/admin?view=support";
  return `New Helpr support message ${appUrl.replace(/\/+$/, "")}${path}`;
}

/** The reply to HELP (sent as TwiML by twilio-inbound). */
export const SMS_HELP_REPLY =
  "Louisiana Helpr alerts: help at louisianahelpr.com/support or admin@louisianahelpr.com. Msg & data rates may apply. Reply STOP to cancel.";

/**
 * The reply to a confirmed opt-in ("YES <code>" that sms_inbound_keyword accepted). Twilio's A2P campaign review
 * requires an opt-in confirmation auto-reply (owner, 2026-10-23). One GSM-7 segment (<= 160).
 * Guard: src/test/smsPolicy.test.ts, src/test/edge/sms-alerts.test.ts.
 */
export const SMS_OPTED_IN_REPLY =
  "Louisiana Helpr: You're now signed up for job alert texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.";

export type InboundAction = "stop" | "start" | "help" | null;

// The CTIA / Twilio standard keyword sets. Matched on the whole trimmed body,
// case-insensitive, so "stop" opts out but "please don't stop" does not.
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"]);
const START_WORDS = new Set(["START", "UNSTOP", "YES", "OPTIN"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);

export function classifyInboundKeyword(body: unknown): InboundAction {
  if (typeof body !== "string") return null;
  // "YES 4821": the keyword with the confirmation code (parseConfirmCode).
  const word = body.trim().replace(/[.!]+$/, "").replace(/\s+\d{4}$/, "").toUpperCase();
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (HELP_WORDS.has(word)) return "help";
  return null;
}

/** All three secrets present (the owner pastes them in Supabase > Edge Functions > Secrets). */
export function twilioConfig(get: (k: string) => string | undefined): {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string;
} | null {
  const accountSid = get("TWILIO_ACCOUNT_SID")?.trim() ?? "";
  const authToken = get("TWILIO_AUTH_TOKEN")?.trim() ?? "";
  const messagingServiceSid = get("TWILIO_MESSAGING_SERVICE_SID")?.trim() ?? "";
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid) || !authToken || !/^MG[0-9a-f]{32}$/i.test(messagingServiceSid)) {
    return null;
  }
  return { accountSid, authToken, messagingServiceSid };
}

/**
 * Twilio's webhook signature: base64(HMAC-SHA1(authToken, url + each POST
 * param name+value, names sorted)). https://www.twilio.com/docs/usage/security
 */
export async function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): Promise<string> {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Escape text placed inside a TwiML <Message>. */
function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function twiml(message?: string): string {
  return message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}
