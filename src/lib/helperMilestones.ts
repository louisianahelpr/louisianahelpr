/**
 * helperMilestones — detection + persistence for one-shot helper
 * achievement toasts. Pure retention nudge: celebrate the first
 * completed job, the 5th / 10th / 25th, the first $1k in lifetime
 * earnings, and the first 5-in-a-row 5-star streak.
 *
 * Each milestone fires exactly ONCE per helper. We persist a marker
 * in `safeStorage` (mirrors to Capacitor Preferences via the
 * `helpr_` prefix) so re-mounting the Earnings tab — or re-opening
 * the app on the same device — does NOT re-celebrate the same
 * milestone.
 *
 * Closes #120.
 *
 * Notes
 * - All thresholds are inclusive. A helper at exactly 5 completed
 *   jobs fires the "5 jobs" milestone; at 6, it's already marked
 *   as fired so it won't fire again.
 * - The list is intentionally additive — a helper who imports their
 *   stats and is already at, say, 12 completed jobs will fire ALL
 *   prior milestones the first time they hit the Earnings tab.
 *   That's the right behavior for a retention nudge: it doesn't
 *   discriminate between "you crossed this just now" and "you've
 *   been past this for ages, here's the recognition you missed."
 * - The five-star streak milestone uses the same algorithm as
 *   HelperStreakBadge (`computeFiveStarStreak`) — the threshold is
 *   5, which means a *current* streak of >= 5 fires it once.
 */

/** Storage key prefix — `helpr_` is auto-tracked by safeStorage. */
const KEY_PREFIX = "helpr_milestone_";

/** A helper milestone the app celebrates. */
export type HelperMilestoneId =
  | "first_job"
  | "five_jobs"
  | "ten_jobs"
  | "twenty_five_jobs"
  | "first_1k_earnings"
  | "first_five_star_streak_of_5";

/** Toast copy + the threshold that triggers it. */
export interface HelperMilestoneDef {
  id: HelperMilestoneId;
  title: string;
  description: string;
}

/**
 * Ordered list of milestones. Order matters only for the toast
 * cascade — if a helper crosses several at once we still fire them
 * smallest-first so the visual story reads correctly.
 */
export const HELPER_MILESTONES: readonly HelperMilestoneDef[] = [
  {
    id: "first_job",
    title: "🎉 Your first completed job",
    description: "Welcome to the team.",
  },
  {
    id: "five_jobs",
    title: "🔥 5 jobs in",
    description: "You're getting the hang of this.",
  },
  {
    id: "ten_jobs",
    title: "🌟 10 jobs!",
    description: "That's veteran-level. Keep it up.",
  },
  {
    id: "twenty_five_jobs",
    title: "🏆 25 jobs done",
    description: "You're an Elite-tier helper now.",
  },
  {
    id: "first_1k_earnings",
    title: "💰 You've crossed $1,000 in earnings",
    description: "Real money on real work.",
  },
  {
    id: "first_five_star_streak_of_5",
    title: "✨ 5 perfect ratings in a row",
    description: "Customers love you.",
  },
] as const;

/** Per-helper storage key for a milestone. Helper scope avoids cross-
 *  account contamination on a shared device. */
export function milestoneStorageKey(
  helperId: string,
  milestoneId: HelperMilestoneId,
): string {
  return `${KEY_PREFIX}${milestoneId}__${helperId}`;
}

/** Input stats the detector needs. All optional / defaultable so the
 *  caller can pass a partial snapshot without crashing. */
export interface HelperMilestoneStats {
  /** Lifetime count of jobs with status === "completed". */
  completedJobCount: number;
  /** Lifetime net earnings in dollars (NOT cents). */
  totalEarningsDollars: number;
  /** Current consecutive 5-star streak from `computeFiveStarStreak`. */
  fiveStarStreak: number;
}

/** Pure detector — returns which milestones the current stats
 *  satisfy (regardless of whether they've already been celebrated). */
export function detectReachedMilestones(
  stats: HelperMilestoneStats,
): HelperMilestoneId[] {
  const reached: HelperMilestoneId[] = [];
  if (stats.completedJobCount >= 1) reached.push("first_job");
  if (stats.completedJobCount >= 5) reached.push("five_jobs");
  if (stats.completedJobCount >= 10) reached.push("ten_jobs");
  if (stats.completedJobCount >= 25) reached.push("twenty_five_jobs");
  if (stats.totalEarningsDollars >= 1000) reached.push("first_1k_earnings");
  if (stats.fiveStarStreak >= 5) reached.push("first_five_star_streak_of_5");
  return reached;
}

/** Storage-gate interface — accepts anything with localStorage-shaped
 *  get/set. We DI it so the unit tests don't need a real DOM. */
export interface MilestoneStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/** Returns true if this helper has already celebrated `milestoneId`. */
export function hasCelebrated(
  storage: MilestoneStorage,
  helperId: string,
  milestoneId: HelperMilestoneId,
): boolean {
  return storage.getItem(milestoneStorageKey(helperId, milestoneId)) !== null;
}

/** Mark a milestone as celebrated for this helper. Idempotent. */
export function markCelebrated(
  storage: MilestoneStorage,
  helperId: string,
  milestoneId: HelperMilestoneId,
): void {
  storage.setItem(
    milestoneStorageKey(helperId, milestoneId),
    String(Date.now()),
  );
}

/**
 * How recently the qualifying event must have happened for a milestone to
 * still be worth celebrating.
 *
 * These toasts fire from the Earnings tab, which is the only screen that has
 * the stats — NOT from the moment a job completes. Without a freshness gate
 * that means the celebration goes off whenever the helper next happens to open
 * Earnings, which could be weeks after the fact: "🎉 Your first completed job"
 * with confetti, for a job finished last month, triggered by tapping a tab.
 * That is exactly how it was reported ("why did that just go off, that's
 * wrong — first completed job??").
 *
 * It also fires per DEVICE, because the celebrated-marker lives in
 * `safeStorage`. A new phone, a reinstall, or cleared storage replays every
 * milestone the helper ever crossed. The freshness gate fixes that case too:
 * on a fresh device, an old milestone is back-filled silently instead of
 * re-celebrated.
 *
 * 24 hours: long enough that a helper who finishes a job in the evening and
 * opens the app the next morning still gets their moment, short enough that
 * nothing historical ever fires.
 */
export const MILESTONE_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/**
 * Diff helper: from the reached set, return the milestones that have NOT yet
 * been celebrated for this helper, split by whether they are still worth
 * celebrating. Preserves the order defined in `HELPER_MILESTONES` so the toast
 * cascade is stable.
 *
 * - `fresh`   → toast + confetti these.
 * - `stale`   → mark celebrated WITHOUT any UI. They are real milestones the
 *               helper crossed, just not now; recording them stops the
 *               celebration ambushing them on some later, unrelated visit.
 *
 * @param lastQualifyingEventAt when the most recent completed job finished
 *        (ISO string). Every milestone here advances on job completion —
 *        counts obviously, and earnings and the five-star streak both move
 *        only when a job completes — so one timestamp gates all of them.
 *        `null` (unknown / no completions) is treated as stale: back-fill
 *        silently rather than guess.
 */
export function selectNewMilestones(
  storage: MilestoneStorage,
  helperId: string,
  stats: HelperMilestoneStats,
  lastQualifyingEventAt: string | null,
  now: number = Date.now(),
): { fresh: HelperMilestoneDef[]; stale: HelperMilestoneDef[] } {
  if (!helperId) return { fresh: [], stale: [] };
  const reached = new Set(detectReachedMilestones(stats));
  const uncelebrated = HELPER_MILESTONES.filter(
    (m) => reached.has(m.id) && !hasCelebrated(storage, helperId, m.id),
  );

  const ts = lastQualifyingEventAt ? Date.parse(lastQualifyingEventAt) : NaN;
  const isFresh = Number.isFinite(ts) && now - ts <= MILESTONE_FRESHNESS_MS;

  return isFresh
    ? { fresh: uncelebrated, stale: [] }
    : { fresh: [], stale: uncelebrated };
}
