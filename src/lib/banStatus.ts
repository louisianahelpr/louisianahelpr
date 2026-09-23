// One definition of "is this account locked out right now", shared with the
// edge functions: see supabase/functions/_shared/banStatus.ts.
export { isLockedOut } from "../../supabase/functions/_shared/banStatus";

/**
 * True when a Postgres/PostgREST error is enforce_ban_gate's expected refusal
 * ("account_restricted", SQLSTATE 42501). That refusal is the ban working, not
 * a fault: callers show their normal fallback and do not report() it, or every
 * banned sign-in files a Sentry error (Q302).
 */
export function isAccountRestricted(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && message.trim() === "account_restricted";
}
