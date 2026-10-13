/**
 * UNDER 18: NO APPLYING AND NO POSTING (owner, 2026-10-12, Q1586(c): "Grey out
 * the button until the age is 18 or over").
 *
 * A member whose SAVED birthday makes them under 18 sees every Apply and Post a
 * Job entry point greyed out with one plain line (useAgeGate), and the server
 * refuses the same member too (20261013010621: apply_to_job, every applications
 * and job_accept_pending insert, and their own jobs insert raise 'under_18').
 * They become available on the member's 18th birthday. No birthday saved yet:
 * nothing changes: the sign-up 18+ box is the requirement (owner, 2026-10-13).
 * The birthday is asked before the first Apply/Post and is required only of a
 * Google/Apple sign-up, which never saw that box (ProtectedRoute).
 *
 * A birthday under 18 that the member types (PhotoPrompt, CompleteProfile,
 * complete-signup) is SAVED, never refused (owner, 2026-10-13): refusing it
 * left the birthday empty, so the honest minor tapped Not Now and went ahead
 * (lh-authz-rls review of 0f7786627, must-fix 1). Saved, the profiles lock
 * (lock_under_18_birthday) holds it and the grey-out and the server refusal
 * start at once.
 *
 * Same rule as the server's member_under_18: 18 from the first minute of the
 * 18th birthday; a 29 February birthday turns 18 on 28 February in a non-leap
 * year (Postgres's date + interval '18 years' clamps the same way). The date is
 * read from its YYYY-MM-DD parts, never `new Date("YYYY-MM-DD")`: that parses
 * as UTC midnight, which is the evening BEFORE in Louisiana, and would let a
 * member through a day early (CompleteProfile, PhotoPrompt and signupHelpers'
 * ageFromDob all had that slip; they read this rule now, and ageFromDob is gone).
 */
export const UNDER_18_APPLY_COPY = "You must be 18 or older to apply for jobs.";
export const UNDER_18_POST_COPY = "You must be 18 or older to post a job.";
/** Said when the member has just told us a birthday under 18 (PhotoPrompt, CompleteProfile). */
export const UNDER_18_SAVED_COPY =
  "Thanks for telling us. You must be 18 or older to apply for jobs or post a job, so those stay off until your 18th birthday.";

export type AgeGateKind = "apply" | "post";

export const ageGateCopy = (kind: AgeGateKind) => (kind === "apply" ? UNDER_18_APPLY_COPY : UNDER_18_POST_COPY);

const pad = (n: number) => String(n).padStart(2, "0");

/** The member's 18th birthday as YYYY-MM-DD, or null when `dob` is not a date. */
export function eighteenthBirthday(dob: string | null | undefined): string | null {
  if (typeof dob !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob.trim());
  if (!m) return null;
  const year = Number(m[1]) + 18;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(day, lastDay))}`;
}

/** Today's calendar date on this device, as YYYY-MM-DD. */
function localDateKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** True when a saved birthday makes the member under 18 today. No birthday: false. */
export function isUnder18(dob: string | null | undefined, now: Date = new Date()): boolean {
  const turns18 = eighteenthBirthday(dob);
  if (!turns18) return false;
  return localDateKey(now) < turns18;
}

/** The server's refusal (20261013010621), from any write or RPC error. */
export function isUnder18Refusal(error: unknown): boolean {
  const raw =
    typeof error === "string"
      ? error
      : ((error as { message?: unknown } | null)?.message ?? "");
  return typeof raw === "string" && /(^|[^a-z0-9_])under_18($|[^a-z0-9_])/.test(raw);
}
