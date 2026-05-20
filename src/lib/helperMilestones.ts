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
 * Diff helper: from the reached set, return only the milestones that
 * have NOT yet been celebrated for this helper. Preserves the order
 * defined in `HELPER_MILESTONES` so the toast cascade is stable.
 */
export function selectNewMilestones(
  storage: MilestoneStorage,
  helperId: string,
  stats: HelperMilestoneStats,
): HelperMilestoneDef[] {
  if (!helperId) return [];
  const reached = new Set(detectReachedMilestones(stats));
  return HELPER_MILESTONES.filter(
    (m) => reached.has(m.id) && !hasCelebrated(storage, helperId, m.id),
  );
}
