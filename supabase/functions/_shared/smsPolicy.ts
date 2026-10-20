// SMS alerts: the pure parts, shared by send-sms-notification and
// twilio-inbound and unit-tested in src/test/smsPolicy.test.ts.
//
// PRIVACY RULE (owner, 2026-10-20): a text is built ONLY from a fixed phrase
// chosen by `kind`, plus a link made from our own app URL and a job uuid.
// A notification's title or body is never an input here: they carry full
// names, job titles and street addresses, and SMS is not end-to-end private.
//
// ZERO imports, so the edge harness and vitest load the real module.

/** What sms_claim() decided the text is about. */
export type SmsKind = "message" | "job_match" | "job_offer" | "job_update";

const PHRASES: Record<SmsKind, string> = {
  message: "You have a new message.",
  job_match: "A new job was posted near you.",
  job_offer: "You have a new job offer.",
  job_update: "There is an update on one of your jobs.",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSmsKind(v: unknown): v is SmsKind {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PHRASES, v);
}

/** The in-app path a text links to. Only a well-formed uuid is ever embedded. */
export function smsLinkPath(kind: SmsKind, jobId: unknown): string {
  if (kind === "message") return "/messages";
  if (typeof jobId === "string" && UUID_RE.test(jobId)) return `/jobs?job=${jobId.toLowerCase()}`;
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
}): string {
  const base = input.appUrl.replace(/\/+$/, "");
  const parts = ["Louisiana Helpr:", PHRASES[input.kind], `${base}${smsLinkPath(input.kind, input.jobId)}`];
  if (input.firstText) parts.push("Reply STOP to stop.");
  return parts.join(" ");
}

/** The reply to HELP (sent as TwiML by twilio-inbound). */
export const SMS_HELP_REPLY =
  "Louisiana Helpr alerts: help at admin@louisianahelpr.com or louisianahelpr.com/support. Msg & data rates may apply. Reply STOP to cancel.";

export type InboundAction = "stop" | "start" | "help" | null;

// The CTIA / Twilio standard keyword sets. Matched on the whole trimmed body,
// case-insensitive, so "stop" opts out but "please don't stop" does not.
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"]);
const START_WORDS = new Set(["START", "UNSTOP", "YES", "OPTIN"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);

export function classifyInboundKeyword(body: unknown): InboundAction {
  if (typeof body !== "string") return null;
  const word = body.trim().replace(/[.!]+$/, "").toUpperCase();
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
export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function twiml(message?: string): string {
  return message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}
