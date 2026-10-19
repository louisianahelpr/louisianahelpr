import { tierRank } from "@/lib/subscriptionTiers";
import type { DisputedJob } from "./types";

/** The Open queue's order (moved out of AdminDisputes.tsx, component size ratchet). */
export function sortOpenDisputes(openJobs: DisputedJob[], tMap: Record<string, string | null>): DisputedJob[] {
  // Priority Dispute Resolution. Tiering rules (most important first):
  //   1. Chargeback-risk disputes (>5 days) — Stripe lets card issuers
  //      reverse the charge directly past this window, costing the
  //      platform the dispute fee + the original transaction. These
  //      MUST be at the top regardless of subscriber tier.
  //   2. Stale disputes (>48h) — about to become chargeback risk.
  //   3. Subscriber priority, by rank on TIER_ORDER (the existing tier sort).
  //   4. Within each tier, oldest first.
  // Rank comes from TIER_ORDER, so a new rung sorts in the moment it exists.
  // The hand-written `elite ? 3 : pro ? 2 : basic ? 1 : 0` it replaces put
  // Plus — a tier ABOVE Pro — at the bottom of the queue with free accounts
  // (CC-019).
  const tierPriority = (uid: string | null) => (uid ? tierRank(tMap[uid]) : 0);
  const ageHours = (j: DisputedJob): number => {
    if (!j.disputed_at) return 0;
    return (Date.now() - new Date(j.disputed_at).getTime()) / 3600_000;
  };
  return openJobs.sort((a, b) => {
    const aAge = ageHours(a);
    const bAge = ageHours(b);
    const aChargeback = aAge > 120; // 5 days
    const bChargeback = bAge > 120;
    if (aChargeback !== bChargeback) return aChargeback ? -1 : 1;
    const aStale = aAge > 48;
    const bStale = bAge > 48;
    if (aStale !== bStale) return aStale ? -1 : 1;
    const aMax = Math.max(tierPriority(a.customer_id), tierPriority(a.helper_id));
    const bMax = Math.max(tierPriority(b.customer_id), tierPriority(b.helper_id));
    if (aMax !== bMax) return bMax - aMax;
    return bAge - aAge; // older first within the same priority bucket
  });
}
