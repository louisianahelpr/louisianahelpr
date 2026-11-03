import type { APIRequestContext } from "@playwright/test";
import { expect, rest, SUPABASE_URL, type Session } from "./fixtures";

/**
 * The legs that drive /complete-profile sign in as the `incomplete` seed
 * account (scripts/audit/prod-seed.mjs OWNED.incomplete). That page renders
 * only while ProtectedRoute's gate calls the profile incomplete; otherwise
 * CompleteProfile sends the account straight to /home, and the leg times out
 * on a field that is not there with nothing saying why.
 *
 * The gate (isProfileComplete, src/components/ProtectedRoute.tsx) is
 * full_name + a finished sign-up (a city, or accepted_terms_at, which only
 * complete-signup and Complete Profile write; 2026-10-27) for an email sign-up (plus the 18+ box,
 * age_attested_at, or a pre-2026-10-14 birthday, for Google/Apple). The seed account used to be incomplete by having no avatar;
 * the avatar left the gate in 2943847db and phone in c34c5fee5 (both owner,
 * 2026-10-09), which made it complete, so e2e-journeys 37996630522 landed it
 * on /home. prod-seed.mjs now leaves its city empty; until that has been
 * applied on prod (`node scripts/audit/prod-seed.mjs --apply`, which
 * prod-audit.yml runs), this says so instead of timing out.
 */
export async function expectGateSendsToCompleteProfile(api: APIRequestContext, session: Session): Promise<void> {
  const r = await api.get(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${session.user.id}&select=full_name,location,accepted_terms_at,is_legacy_user`, {
    headers: rest(session),
  });
  expect(r.ok(), `reading the incomplete seed account's profile: HTTP ${r.status()}`).toBe(true);
  const [row] = (await r.json()) as Array<{ full_name: string | null; location: string | null; accepted_terms_at: string | null; is_legacy_user: boolean | null }>;
  expect(row, "the incomplete seed account has no profile row").toBeTruthy();
  expect(row.is_legacy_user, "the incomplete seed account is legacy, so the gate never sends it to /complete-profile").not.toBe(true);
  // The same two halves as isProfileComplete for an email sign-up: a name, and
  // signupFinished (a city OR accepted_terms_at). Either half missing keeps the
  // account on /complete-profile.
  const named = !!row.full_name?.trim();
  const finished = !!row.location?.trim() || !!row.accepted_terms_at?.trim();
  expect(
    named && finished,
    `the incomplete seed account is COMPLETE under isProfileComplete (full_name set, and ${row.location?.trim() ? "a city" : `accepted_terms_at ${row.accepted_terms_at}`}), ` +
      "so /complete-profile redirects it to /home. accepted_terms_at cannot be cleared (tr_preserve_first_consent keeps the first value), " +
      "so re-applying the seed does not fix it. Re-create THIS account only: delete auth user helpr-seed-incomplete-0912@mailinator.com " +
      "(GoTrue admin DELETE; its profile rows cascade), then `SEED_PASSWORD_INCOMPLETE=<the PLAYWRIGHT_INCOMPLETE_PASSWORD secret> " +
      "node scripts/audit/prod-seed.mjs --apply` re-creates it with no city and no accepted_terms_at; `--verify` checks it. " +
      "Something submitted Complete Profile as this account: find and stop that writer too.",
  ).toBe(false);
}
