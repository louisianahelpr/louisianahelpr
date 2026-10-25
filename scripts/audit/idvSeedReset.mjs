/**
 * prod-seed's IDV fixtures vs. the "a verified ID is final" rule.
 *
 * Migration 20261022010525 added zz_profiles_idv_verified_is_final: once a
 * profile's idv_status is 'verified' it may move only to 'failed', or back to
 * 'not_started' through the admin reset (admin_idv_request_reupload, which
 * sets lh.idv_admin_reset for its one UPDATE). The seed fixture "denied"
 * (helpr-seed-denied-0912@mailinator.com) wants manual_review, but its row
 * read 'verified' (updated 2026-10-22 21:17Z), so every `prod-seed --apply`
 * PATCH was refused with 403 idv_verified_is_final and the Vacuity (9 legs)
 * and Prod audit (4 legs) prod jobs failed before they started.
 *
 * The fixture is a test-owned is_seed account, so the seeder takes the same
 * sanctioned way back the admin console uses, then writes the wanted state.
 */

/** True when the seeder must reset this row through the admin path before its PATCH. */
export function needsIdvSeedReset(current, wantedProfile) {
  if (!current || current.is_seed !== true) return false;
  const wanted = wantedProfile?.idv_status;
  if (wanted === undefined || wanted === "verified" || wanted === "failed") return false;
  return current.idv_status === "verified";
}

/** Reset a verified SEED profile so the fixture's IDV state can be written. Throws unless exactly one row moved. */
export async function resetSeedIdv(userId, rpc) {
  const moved = await rpc("admin_idv_request_reupload", {
    p_user_id: userId,
    p_note: "prod-seed: fixture reset to its IDV state",
  });
  if (moved !== 1) throw new Error(`admin_idv_request_reupload(${userId}) moved ${JSON.stringify(moved)} row(s), not 1`);
}
