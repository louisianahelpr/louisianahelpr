/**
 * SMS alerts consent (owner, 2026-10-20). The exact wording next to the
 * unticked box, and the version the SERVER stamps on every opt-in
 * (public.set_sms_consent writes consent_text_version = 'sms-v1').
 *
 * Changing the wording means a new version here AND in the migration
 * (src/test/smsAlerts.test.ts keeps them equal), and the same text is what the
 * owner submitted to Twilio's toll-free verification.
 */
export const SMS_CONSENT_TEXT_VERSION = "sms-v1";

/** The consent sentence, split so the two legal links can be real links. */
export const SMS_CONSENT_TEXT_BEFORE_LINKS =
  "Text me alerts from Louisiana Helpr about my jobs, offers, nearby jobs and new messages at this number. Message frequency varies. Msg & data rates may apply. Reply STOP to cancel, HELP for help. Consent is not a condition of using Louisiana Helpr. See our";

export interface SmsConsent {
  phone_e164: string | null;
  sms_opt_in: boolean;
  opted_in_at: string | null;
  opted_out_at: string | null;
  opt_out_source: string | null;
  /** Asked for in the last 24 h and waiting for the phone to reply YES. */
  pending_phone: string | null;
  pending_since: string | null;
  /** "New job near you" texts, their own switch (owner 2026-10-22); on unless turned off. */
  job_match_texts: boolean;
}

/** US numbers only, mirroring public.sms_normalize_phone. Null when invalid. */
export function normalizeUsPhone(input: string): string | null {
  const d = input.replace(/\D/g, "");
  const e = d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith("1") ? `+${d}` : null;
  return e && /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(e) ? e : null;
}

/** "+12255550123" -> "(225) 555-0123". */
export function formatUsPhone(e164: string | null): string {
  const m = e164?.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : "";
}

export function parseSmsConsent(data: unknown): SmsConsent {
  const o = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    phone_e164: str(o.phone_e164),
    sms_opt_in: o.sms_opt_in === true,
    opted_in_at: str(o.opted_in_at),
    opted_out_at: str(o.opted_out_at),
    opt_out_source: str(o.opt_out_source),
    pending_phone: str(o.pending_phone),
    pending_since: str(o.pending_since),
    job_match_texts: o.job_match_texts !== false,
  };
}
