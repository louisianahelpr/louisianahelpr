/**
 * Q837: an edge function refuses a caller whose email is unconfirmed.
 *
 * Q807 (20260927234313) refuses a write from an unconfirmed session on every
 * public table, but it reads auth.uid(), and when an edge function writes with
 * the SERVICE ROLE after verifying the caller with auth.getUser(), auth.uid()
 * is NULL there: the database cannot see the end user. So each user-facing
 * function checks the user it just verified, by the rule the database applies
 * (public.session_email_unconfirmed(): no email_confirmed_at on the caller's
 * auth.users row).
 *
 * Pass the user `auth.getUser()` returned. JWT claims (`auth.getClaims()`)
 * carry no email_confirmed_at, so passing claims would refuse every caller.
 *
 * The 403 body follows the edge convention the client reads: `error` is the
 * sentence shown to the person (src/lib/supabaseResult.ts reads `body.error`),
 * `code` is the machine-readable reason.
 *
 * Exempt by design, each named with its reason in
 * src/test/edge/requireConfirmedEmail.test.ts: the flows an unconfirmed
 * account must still run (complete-signup, contact-support,
 * delete-own-account, export-my-data), verify-apple-iap (Apple has already
 * charged: it never refuses a paid purchase), and the admin-only functions,
 * which already require the admin role.
 *
 * Pure: no imports, so the edge test harness loads the real module.
 */
export const EMAIL_UNCONFIRMED = "email_unconfirmed";

export const EMAIL_UNCONFIRMED_MESSAGE = "Confirm your email address to continue.";

type MaybeUser = { email_confirmed_at?: string | null } | null | undefined;

/** True when the verified caller has no confirmed email, or there is no caller. */
export function emailUnconfirmed(user: MaybeUser): boolean {
  return !user?.email_confirmed_at;
}

/**
 * A 403 for an unconfirmed caller, or null to carry on. Call it right after
 * the function's own "not signed in" 401, with that function's CORS headers,
 * before any write, RPC, Stripe call or fetch.
 */
export function refuseUnconfirmedEmail(user: MaybeUser, headers: Record<string, string>): Response | null {
  if (!emailUnconfirmed(user)) return null;
  return new Response(
    JSON.stringify({ error: EMAIL_UNCONFIRMED_MESSAGE, code: EMAIL_UNCONFIRMED }),
    { status: 403, headers: { ...headers, "Content-Type": "application/json" } },
  );
}
