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
 * full_name + location for an email sign-up (date_of_birth only for
 * Google/Apple). The seed account used to be incomplete by having no avatar;
 * the avatar left the gate in 2943847db and phone in c34c5fee5 (both owner,
 * 2026-10-09), which made it complete, so e2e-journeys 37996630522 landed it
 * on /home. prod-seed.mjs now leaves its city empty; until that has been
 * applied on prod (`node scripts/audit/prod-seed.mjs --apply`, which
 * prod-audit.yml runs), this says so instead of timing out.
 */
export async function expectGateSendsToCompleteProfile(api: APIRequestContext, session: Session): Promise<void> {
  const r = await api.get(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${session.user.id}&select=full_name,location,is_legacy_user`, {
    headers: rest(session),
  });
  expect(r.ok(), `reading the incomplete seed account's profile: HTTP ${r.status()}`).toBe(true);
  const [row] = (await r.json()) as Array<{ full_name: string | null; location: string | null; is_legacy_user: boolean | null }>;
  expect(row, "the incomplete seed account has no profile row").toBeTruthy();
  expect(row.is_legacy_user, "the incomplete seed account is legacy, so the gate never sends it to /complete-profile").not.toBe(true);
  const missing = [!row.full_name?.trim() && "full_name", !row.location?.trim() && "location"].filter(Boolean);
  expect(
    missing.length,
    "the incomplete seed account is COMPLETE under isProfileComplete (full_name and location are both set), so /complete-profile " +
      "redirects it to /home. Re-apply the seed (node scripts/audit/prod-seed.mjs --apply), which leaves its city empty.",
  ).toBeGreaterThan(0);
}
