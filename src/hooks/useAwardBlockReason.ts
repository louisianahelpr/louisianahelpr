import { useCurrentUser } from "@/hooks/useCurrentUser";
import { isIdentityVerified, type AwardBlockReason } from "@/lib/awardGate";

/**
 * Why the CURRENT user cannot be awarded a job right now, or `null` if nothing
 * stops them.
 *
 * WHY THIS EXISTS — the helper was the only party never told.
 *
 * `helper_award_block_reason()` gates every write that hands someone a job
 * (`jobs_award_gate`, migration 20260827191647). Both sides of that refusal
 * were already surfaced to SOMEBODY: the poster gets
 * {@link posterAwardBlockMessage} on a disabled Hire button, and a helper who
 * reaches the accept step gets `AwardGateDialog` — but that dialog is mounted
 * in exactly one place (`Activity.tsx`), on the OFFER response.
 *
 * Applying is deliberately ungated: a helper may browse and apply freely
 * (owner's decision, documented in `src/lib/awardGate.ts`), and
 * `useApplyFlow.ts` says so in a comment. That decision is right and this hook
 * does not change it. But it left a real hole — measured against prod
 * 2026-09-06, SEVEN of the eight non-seed profiles return
 * `helper_payout_setup_incomplete`, i.e. every one of them can apply to as
 * many jobs as they like while no poster is able to hire any of them. Nothing
 * anywhere told them that. They apply, they wait, and the silence looks like
 * rejection by posters rather than an unfinished setup step they own.
 *
 * So this is deliberately NOT a gate. It returns a reason for a surface to
 * EXPLAIN with; it never blocks the apply.
 *
 * DERIVED, NOT FETCHED. `useCurrentUser` already holds the caller's full
 * `profiles` row (`select("*")`) and keeps it live over realtime, so this adds
 * no round-trip on the apply path. The predicate below mirrors
 * `helper_award_block_reason` branch for branch — including the seed carve-out
 * — so the helper is never shown a block the server would not raise, and never
 * shown silence where it would.
 *
 * There is no operator pause any more (owner, 2026-09-07; migration
 * 20260908001056 deleted the flag and every reader of it), so the identity arm
 * is a pure function of the profile already in hand and settles synchronously.
 */
export function useAwardBlockReason(): AwardBlockReason | null {
  const { profile } = useCurrentUser();

  // No profile loaded is not "blocked" — it is "we do not know yet". Saying
  // nothing is the only honest render; `helper_unknown` is a real server
  // verdict about a MISSING row, not about a slow one.
  if (!profile) return null;

  // Fixture data stays usable, but only while it is actually fixture-shaped —
  // a seed profile holding a real Connect account is judged on Stripe's
  // answer. Verbatim from the server function.
  if (profile.is_seed === true && profile.stripe_account_id == null) return null;

  if (profile.stripe_account_id == null || profile.stripe_payouts_enabled !== true) {
    return "helper_payout_setup_incomplete";
  }

  const identityOk = isIdentityVerified({
    connectIdentityVerified: profile.stripe_identity_verified,
    idvStatus: profile.idv_status,
  });
  if (!identityOk) return "helper_identity_unverified";

  return null;
}
