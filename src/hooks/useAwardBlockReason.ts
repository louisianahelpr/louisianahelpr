import { useCurrentUser } from "@/hooks/useCurrentUser";
import { acceptMissingFromProfile, reasonFromMissing, type AwardBlockReason } from "@/lib/awardGate";

/**
 * Why the CURRENT user cannot be awarded a job right now, or `null` if nothing
 * stops them.
 *
 * WHY THIS EXISTS — the helper was the only party never told.
 *
 * `helper_accept_block_reason()` gates the Helpr's ACCEPT of a job
 * (`jobs_award_gate`; since 20261003193541 the poster's Hire is only an offer
 * and is not judged, owner 2026-10-02/03), and `helper_award_block_reason()`
 * still gates a crew hire (roster gate). A helper
 * who reaches the accept step gets `AwardGateDialog`, but that dialog is
 * mounted in exactly one place (`Activity.tsx`), on the OFFER response.
 *
 * Applying is deliberately ungated: a helper may browse and apply freely
 * (owner's decision, documented in `src/lib/awardGate.ts`), and
 * `useApplyFlow.ts` says so in a comment. That decision is right and this hook
 * does not change it. But it left a real hole — measured against prod
 * 2026-09-06, SEVEN of the eight non-seed profiles return
 * `helper_payout_setup_incomplete`, i.e. every one of them could apply to as
 * many jobs as they liked while no poster was able to hire any of them (the
 * gate then fired at Hire). Nothing anywhere told them that. They applied,
 * waited, and the silence looked like rejection by posters rather than an
 * unfinished setup step they own. Today the offer reaches them and the accept
 * is where the setup is asked for; this notice still tells them first.
 *
 * So this is deliberately NOT a gate. It returns a reason for a surface to
 * EXPLAIN with; it never blocks the apply.
 *
 * DERIVED, NOT FETCHED. `useCurrentUser` already holds the caller's full
 * `profiles` row (`select("*")`) and keeps it live over realtime, so this adds
 * no round-trip on the apply path. The predicate below mirrors
 * `helper_accept_block_reason` branch for branch — including the seed carve-out
 * — so the helper is never shown a block the server would not raise, and never
 * shown silence where it would.
 *
 * Since 20261003193541 (Q1180) the Helpr's accept needs payout setup AND
 * Stripe ID, so this mirrors helper_accept_block_reason: payouts first, then
 * identity. Identity still gates nothing else (20261001222911).
 */
export function useAwardBlockReason(): AwardBlockReason | null {
  const { profile } = useCurrentUser();

  // No profile loaded is not "blocked" — it is "we do not know yet". Saying
  // nothing is the only honest render; `helper_unknown` is a real server
  // verdict about a MISSING row, not about a slow one.
  if (!profile) return null;

  // helper_accept_missing / helper_accept_block_reason (20261003193541),
  // mirrored branch for branch: the seed carve-out, payouts, then Stripe ID.
  return reasonFromMissing(acceptMissingFromProfile(profile));
}

/**
 * The same verdict, with "we don't know yet" kept apart from "nothing stops
 * you". The offer card needs the difference (owner, 2026-10-05): it shows
 * "Set Up Payouts" / "Finish Stripe Setup" as the ONE primary when the accept
 * would be refused, so it must not draw an enabled Accept Job while the profile
 * is still loading. Same derivation as useAwardBlockReason above (the client
 * mirror of helper_accept_missing, which is also what accept_job_offer answers
 * the gate dialog with), so the card and the dialog cannot disagree.
 */
export function useAcceptGate(): { loading: boolean; reason: AwardBlockReason | null } {
  const { profile, isLoading } = useCurrentUser();
  if (!profile) return { loading: isLoading, reason: null };
  return { loading: false, reason: reasonFromMissing(acceptMissingFromProfile(profile)) };
}
