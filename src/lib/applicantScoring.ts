export interface ApplicantScore {
  userId: string;
  /**
   * QUALITY ONLY — ratings, history, credentials, proximity, trust graph.
   * Never contains a paid signal. This is what the "Helpr Recommended" badge
   * is allowed to read, and what a poster is shown as the reason to hire.
   */
  score: number;
  signals: string[]; // human-readable trust signals for the card
  /** Points added by Priority Placement. 0 for free/Basic/unknown/expired. */
  priorityBoost: number;
  /** `score + priorityBoost` — the ORDER of the list, and nothing else. */
  rankScore: number;
}

export interface ApplicantData {
  userId: string;
  avgRating: number | null;
  reviewCount: number;
  completedJobs: number;
  repeatHirePercent: number | null; // 0-100
  onTimePercent: number | null;     // 0-100
  credentialTier: number;           // 0-3 from helper_credentials
  distanceKm: number | null;
  responseTimeMinutes: number | null;
  neighborCount: number;            // how many nearby addresses hired them (trust graph)
  /**
   * The applicant's ACTIVE membership tier, for the Priority Placement perk.
   * Must already have expiry folded in — `get_safe_profiles` does that in SQL
   * as of migration 20260901022522, so the raw field off that RPC is safe.
   * Omit or pass null to score with no placement bump at all.
   */
  priorityTier?: string | null;
}

/**
 * PRIORITY PLACEMENT — a BOUNDED boost, never an override.
 *
 * TIER_PERKS advertises "Priority Placement" on Pro and Elite ("application
 * floated higher in the poster's list"), and until now the app charged for it
 * and delivered nothing: useApplicantsState sorted the enriched applicants by
 * tier, and useApplicantComparison immediately re-sorted the same array by
 * scoreApplicant(), which takes no tier input. The tier sort was computed and
 * thrown away on every render.
 *
 * The fix has to answer "how much should money move a hiring decision?", and
 * the poster's interest settles it. A poster opens this list to find the best
 * person for their job. A tier that can outrank genuine quality does two bad
 * things at once: it sends the poster a worse helper, and it makes the perk
 * self-defeating, because a marketplace that surfaces worse helpers is worth
 * less to the helpers paying for placement. So the boost is capped BELOW the
 * smallest single quality increment the scorer can award:
 *
 *   one credential rung (unlicensed → licensed)     2.5 pts
 *   0 → 1 completed job                             4.5 pts
 *   a 0.3★ rating gap (4.6★ vs 4.9★)                2.1 pts
 *   PRIORITY_PLACEMENT_MAX_POINTS (Elite)           2.0 pts   ← strictly less
 *
 * on a scale whose maximum is 100. The consequence, stated plainly: the boost
 * decides between applicants who are genuinely close — which in this
 * marketplace is most of them, since new helpers arrive with no reviews and no
 * history and score identically — and it CANNOT lift a paying helper over one
 * who is measurably better. `applicantScoring.test.ts` pins that inequality so
 * a later "make the perk feel stronger" cannot quietly turn it into an
 * override.
 *
 * The boost also never touches `score`: the "Helpr Recommended" badge and the
 * signals on the card stay purely earned. Money can nudge the ORDER; it cannot
 * buy the endorsement.
 */
export const PRIORITY_PLACEMENT_MAX_POINTS = 2;

/**
 * Placement points for an ACTIVE tier. Basic does not include Priority
 * Placement (TIER_PERKS.basic.priorityPlacement === false), so it scores 0 —
 * as do free, null, an expired tier already resolved to null upstream, and any
 * unrecognised string including the retired 'business'. Unknown → no perk is
 * the same direction DEFAULT_TIER_FEE_PERCENT takes.
 */
export function priorityPlacementPoints(tier: string | null | undefined): number {
  const t = (tier ?? "").toLowerCase();
  if (t === "elite") return PRIORITY_PLACEMENT_MAX_POINTS;
  if (t === "pro") return PRIORITY_PLACEMENT_MAX_POINTS / 2;
  return 0;
}

export function scoreApplicant(a: ApplicantData): ApplicantScore {
  let score = 0;
  const signals: string[] = [];

  // Rating (0–5 → 0–35 pts)
  if (a.avgRating && a.reviewCount >= 3) {
    score += (a.avgRating / 5) * 35;
    if (a.avgRating >= 4.8) signals.push(`${a.avgRating.toFixed(1)}★`);
  }

  // Completed jobs (logarithmic, up to 20 pts)
  if (a.completedJobs > 0) {
    score += Math.min(20, Math.log10(a.completedJobs + 1) * 15);
    if (a.completedJobs >= 10) signals.push(`${a.completedJobs} job${a.completedJobs === 1 ? "" : "s"}`);
  }

  // Repeat hire % (up to 15 pts)
  if (a.repeatHirePercent != null) {
    score += (a.repeatHirePercent / 100) * 15;
    if (a.repeatHirePercent >= 50) signals.push(`${a.repeatHirePercent}% repeat hire`);
  }

  // On-time % (up to 10 pts)
  if (a.onTimePercent != null) {
    score += (a.onTimePercent / 100) * 10;
    if (a.onTimePercent >= 90) signals.push("On time");
  }

  // Credential tier (0–10 pts)
  score += a.credentialTier * 2.5;
  if (a.credentialTier >= 2) signals.push("Licensed");
  if (a.credentialTier >= 3) signals.push("Insured");

  // Distance (closer = better, up to 5 pts)
  if (a.distanceKm != null) {
    score += Math.max(0, 5 - a.distanceKm * 0.5);
  }

  // Neighbor trust (up to 5 pts)
  if (a.neighborCount > 0) {
    score += Math.min(5, a.neighborCount * 1.5);
    signals.push(`${a.neighborCount} neighbor${a.neighborCount > 1 ? "s" : ""} hired them`);
  }

  // Applied LAST and kept in its own field, so `score` remains the earned
  // number every other surface reads.
  const priorityBoost = priorityPlacementPoints(a.priorityTier);

  return { userId: a.userId, score, signals, priorityBoost, rankScore: score + priorityBoost };
}
