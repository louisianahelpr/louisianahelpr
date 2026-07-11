/**
 * statusColors — the single source of truth for the COLOR a job-status chip
 * renders in. Mirrors the LABEL unification done in `statusLabels.ts` (#46
 * / #282): same state, same color everywhere it appears (chat header pill,
 * conversation row chip, activity cards, profile / earnings list, etc.).
 *
 * Why this exists: before this module, the seven `job_status` enum values
 * rendered in a dozen different palettes across surfaces.
 *   - `StatusBadge` mapped them to the abstract semantic tokens
 *     (`--success`, `--warning`, `--error`, `--info`), which in the brand
 *     theme all desaturate to the same muted olive-gray family.
 *   - `ChatView` and `ConversationRow` shipped bespoke bark + sienna pills
 *     with a custom map inlined per file.
 *   - `EarningsTab` used a third palette ("bark/sienna/gold-warm" but with
 *     `open` as sienna instead of olivewood).
 *   - `UserProfile` and `AdminAnalyticsDrilldowns` used `bg-accent/20
 *     text-accent-foreground` for both `accepted`, `in_progress`, AND
 *     `revision_requested` — three distinct states, one color.
 *
 * Voice for status colors (matches the warm earthy brand system, no
 * red-alarm or fluorescent):
 *   open               → olivewood          (neutral, helpful — available)
 *   accepted           → bark               (confident forward motion)
 *   in_progress        → burnt-sienna       (active warmth — work is on)
 *   completed          → bark, deeper       (earned, settled)
 *   cancelled          → low-opacity olive  (muted, no judgment)
 *   revision_requested → gold-warm          (gentle attention — needs you)
 *   disputed           → burnt-sienna deep  (serious but warm, not alarm-red)
 *
 * CRITICAL — brand-token plumbing: the warm-palette HSL channels are
 * declared as CSS custom properties on `:root` in `src/index.css` and are
 * NOT registered in `tailwind.config.ts` `theme.colors`. As a result a
 * naked utility like `bg-bark` or `text-burnt-sienna` SILENTLY produces no
 * styles. Always use the arbitrary-value form `bg-[hsl(var(--bark))]` /
 * `text-[hsl(var(--burnt-sienna))]` (with `/0.12` etc. for opacity).
 *
 * Usage:
 *   import { jobStatusColor } from "@/lib/statusColors";
 *   const { bg, text } = jobStatusColor("in_progress");
 *   <span style={{ backgroundColor: bg, color: text }}>…</span>
 *
 *   // or via the className helper for Tailwind contexts:
 *   import { jobStatusColorClasses } from "@/lib/statusColors";
 *   <span className={jobStatusColorClasses("in_progress")}>…</span>
 */

import type { JobStatus } from "@/lib/statusLabels";

export interface StatusColor {
  /** CSS color string for the chip background (low-opacity tint). */
  bg: string;
  /** CSS color string for the chip foreground text. */
  text: string;
}

/**
 * Canonical color per `job_status` enum value. Keys MUST match the enum
 * exactly — they are the source of truth for what every chip/badge paints
 * for that state. Values use raw `hsl(var(--token) / alpha)` strings so
 * the same map works for `style={{}}` props AND for Tailwind arbitrary
 * values (`jobStatusColorClasses` derives the className form below).
 */
export const JOB_STATUS_COLORS: Record<JobStatus, StatusColor> = {
  // Neutral, helpful — the job is on the board and available to anyone.
  open:               { bg: "hsl(var(--olivewood) / 0.12)", text: "hsl(var(--olivewood))" },
  // Confident forward motion — a helpr is locked in.
  accepted:           { bg: "hsl(var(--bark) / 0.12)",      text: "hsl(var(--bark))" },
  // Active warmth — work is happening right now.
  in_progress:        { bg: "hsl(var(--burnt-sienna) / 0.12)", text: "hsl(var(--burnt-sienna))" },
  // Earned, settled — slightly more saturation than `accepted` to mark
  // the difference between "agreed" and "done".
  completed:          { bg: "hsl(var(--bark) / 0.18)",      text: "hsl(var(--bark))" },
  // Muted, no judgment — terminal but quiet.
  cancelled:          { bg: "hsl(var(--olivewood) / 0.10)", text: "hsl(var(--olivewood) / 0.8)" },
  // Gentle attention — the poster asked for a change. Uses the amber
  // pending/revision pair (amber-ink is 4.5:1+ on the tint); plain gold-warm
  // text was only 2.53:1 and failed WCAG AA.
  revision_requested: { bg: "hsl(var(--amber-tint) / 0.14)", text: "hsl(var(--amber-ink))" },
  // Serious but warm, NOT red-alarm — kept in the brand sienna family.
  disputed:           { bg: "hsl(var(--burnt-sienna) / 0.18)", text: "hsl(var(--burnt-sienna))" },
  // Awaiting business-poster approval on a member-created posting that
  // exceeds the org's threshold. Gentle attention — same gold-warm as
  // revision_requested since it's "waiting on a person" not "in flight."
  pending_approval:   { bg: "hsl(var(--amber-tint) / 0.14)", text: "hsl(var(--amber-ink))" },
};

/**
 * Fallback color for unknown / non-enum status strings (e.g. the legacy
 * `assigned` conversation alias). Matches the muted-olivewood family so
 * an unrecognized value reads as "in flight, nothing dramatic" rather
 * than crashing or shouting in primary.
 */
export const FALLBACK_STATUS_COLOR: StatusColor = {
  bg: "hsl(var(--olivewood) / 0.10)",
  text: "hsl(var(--olivewood) / 0.9)",
};

/**
 * Look up the canonical color for a job status. Unknown / null / empty
 * values resolve to `FALLBACK_STATUS_COLOR` rather than throwing — chip
 * rendering must never crash the page if a new enum value lands ahead
 * of a client deploy (mirrors `jobStatusLabel`).
 */
export function jobStatusColor(status: string | null | undefined): StatusColor {
  if (!status) return FALLBACK_STATUS_COLOR;
  return JOB_STATUS_COLORS[status as JobStatus] ?? FALLBACK_STATUS_COLOR;
}

/**
 * Tailwind className form of `jobStatusColor` — useful in surfaces that
 * already drive their chip from `className` (StatusBadge, ScheduleTab,
 * UserProfile job lists, etc.). Renders the same paint as the
 * `style`-prop form above by leaning on Tailwind's arbitrary-value syntax
 * against the brand CSS vars.
 *
 * The HSL values are inlined as arbitrary Tailwind classes so a JIT pass
 * over this source file emits the rules at build time. Do NOT switch to
 * runtime string concatenation — Tailwind only scans static literals.
 */
const STATUS_COLOR_CLASSES: Record<JobStatus, string> = {
  open:               "bg-[hsl(var(--olivewood)/0.12)] text-[hsl(var(--olivewood))]",
  accepted:           "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))]",
  in_progress:        "bg-[hsl(var(--burnt-sienna)/0.12)] text-[hsl(var(--burnt-sienna))]",
  completed:          "bg-[hsl(var(--bark)/0.18)] text-[hsl(var(--bark))]",
  cancelled:          "bg-[hsl(var(--olivewood)/0.10)] text-[hsl(var(--olivewood)/0.8)]",
  revision_requested: "bg-[hsl(var(--amber-tint)/0.14)] text-[hsl(var(--amber-ink))]",
  disputed:           "bg-[hsl(var(--burnt-sienna)/0.18)] text-[hsl(var(--burnt-sienna))]",
  pending_approval:   "bg-[hsl(var(--amber-tint)/0.14)] text-[hsl(var(--amber-ink))]",
};

const FALLBACK_STATUS_COLOR_CLASSES =
  "bg-[hsl(var(--olivewood)/0.10)] text-[hsl(var(--olivewood)/0.9)]";

export function jobStatusColorClasses(status: string | null | undefined): string {
  if (!status) return FALLBACK_STATUS_COLOR_CLASSES;
  return STATUS_COLOR_CLASSES[status as JobStatus] ?? FALLBACK_STATUS_COLOR_CLASSES;
}
