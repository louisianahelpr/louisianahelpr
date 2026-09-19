/**
 * ONE COLOUR RULE FOR THE PROGRESS RAIL — read by the full rail and the
 * compact one, so "it is the same rail, only denser" is true by construction
 * rather than by two files agreeing.
 *
 * ── WHY THIS MODULE EXISTS NOW ────────────────────────────────────────────
 * The rule lived inline inside JobTracking's render, and
 * `src/test/alarmColourInvariant.test.ts` said so in as many words: "It is
 * transcribed rather than imported because the rule lives inline inside a
 * 1500-line component's render and there is no export to reach." A
 * transcription is a copy, and a copy of a colour rule is exactly the drift
 * that rule exists to prevent — the guard even carries a second test whose
 * only job is to notice when the transcription goes stale.
 *
 * The owner's 2026-09-19 collapsed-rail ruling forced the issue: a SECOND rail
 * now paints these dots, at 16px with no labels, and a second transcription
 * would have been a third copy. So the rule is extracted, both rails call it,
 * and the guard imports it instead of describing it.
 *
 * ── THE RULE ITSELF IS UNCHANGED ──────────────────────────────────────────
 * Two owner findings, one rule:
 *   "Shouldn't be 2 different green. Yellow if they're on that step until
 *    they're done that step."
 *   "Both can't be red."
 * So, per row:
 *   ALARM     exactly one, and only on a disputed job's CURRENT step. Keyed to
 *             the cursor (`idx === displayIdx`), which makes "at most one"
 *             true by construction — a pin keyed to a step NAME can match a
 *             step the cursor is nowhere near, which is how Working and Done
 *             both went red on one card.
 *   AMBER     exactly one: "you are on this step and it is not finished".
 *   GREEN     every step that genuinely completed, plus the whole rail once
 *             the job reaches Done. It is the PRIMARY BUTTON'S green
 *             (`--bark`), not the emerald `--success-ink` it used to be —
 *             owner, 2026-09-19, and see railGreenMatchesPrimary.test.ts.
 *   GREY      not reached.
 */

/** The four roles a dot can play. `bark-tint` is kept for the full rail's
 *  unreachable `isActive && !isPassed && !isCurrent` branch — reported, not
 *  deleted, because deleting a branch is not this change's business. */
export type RailTone = "alarm" | "amber" | "green" | "bark-tint" | "grey";

export interface RailStepPaint {
  tone: RailTone;
  /** The dot's fill. */
  fill: string;
  /** Ring colour for the CURRENT step, or null where there is no ring. */
  ring: string | null;
  /** The ring's outer (transparent) stop, for the pulse animation. */
  ringEnd: string | null;
  /** Colour of the glyph or, in the compact rail, the border. */
  ink: string;
}

const PAINT: Record<RailTone, Omit<RailStepPaint, "tone">> = {
  // ONE ALARM, and only ever the disputed cursor.
  alarm: {
    fill: "hsl(var(--destructive))",
    ring: null,
    ringEnd: null,
    ink: "hsl(var(--parchment))",
  },
  // "You are here, and it is not finished."
  amber: {
    fill: "hsl(var(--amber-solid))",
    ring: "hsl(var(--amber-solid) / 0.30)",
    ringEnd: "hsl(var(--amber-solid) / 0)",
    ink: "hsl(var(--parchment))",
  },
  // THE PRIMARY BUTTON'S GREEN (owner, 2026-09-19). `--bark` is the dominant
  // mid stop of `.btn-grad-primary`'s radial; the class itself would paint a
  // 28px dot almost entirely from its LIGHT stop and read lighter than the
  // button it is supposed to match.
  green: {
    fill: "hsl(var(--bark))",
    ring: "hsl(var(--bark) / 0.30)",
    ringEnd: "hsl(var(--bark) / 0)",
    ink: "hsl(var(--parchment))",
  },
  "bark-tint": {
    fill: "hsl(var(--bark) / 0.18)",
    ring: null,
    ringEnd: null,
    ink: "hsl(var(--bark))",
  },
  grey: {
    fill: "hsl(var(--olivewood) / 0.08)",
    ring: null,
    ringEnd: null,
    ink: "hsl(var(--olivewood) / 0.80)",
  },
};

/** Which tone one step of the rail wears. Pure; the single definition. */
export function railStepTone({
  idx,
  displayIdx,
  stepCount,
  jobStatus,
}: {
  idx: number;
  displayIdx: number;
  stepCount: number;
  jobStatus?: string;
}): RailTone {
  const allDone = displayIdx === stepCount - 1;
  const isCurrent = idx === displayIdx;
  const isPassed = idx < displayIdx;
  const isActive = idx <= displayIdx;
  // Keyed to the CURSOR, never to a step name — at most one, always.
  if (jobStatus === "disputed" && isCurrent) return "alarm";
  if (isCurrent) return allDone ? "green" : "amber";
  if (isPassed || (isActive && allDone)) return "green";
  if (isActive) return "bark-tint";
  return "grey";
}

/** Tone plus the colours it resolves to. */
export function railStepPaint(args: Parameters<typeof railStepTone>[0]): RailStepPaint {
  const tone = railStepTone(args);
  return { tone, ...PAINT[tone] };
}

/**
 * THE COMPACT RAIL'S GEOMETRY — owner, 2026-09-19: "16px dots, no labels".
 *
 * MEASURED, not chosen. The card's inner width is its `px-4` box inside
 * `JobCardShell`, which is the same box `[data-job-step-row]` occupies — and
 * that row was measured on prod on both engines (see
 * src/test/jobStepRowWidthFloor.test.tsx): 212px at a 320 viewport, 262px at
 * 375, 1035px at 1440.
 *
 *   full rail, 8 steps:  8×28 + 7×6 = 266px  >  212  ✗ overflows and scrolls
 *   compact,   8 steps:  8×16 + 7×6 = 170px  ≤  212  ✓ fits, 42px to spare
 *   compact,   7 steps:  7×16 + 6×6 = 148px  ≤  212  ✓
 *
 * WHY THE DOTS CARRY NO TAP TARGET. The full rail's dots are buttons (they
 * open a timestamp tooltip) and defeat the 44px floor with an invisible 44px
 * overlay. These are not controls at all: the whole collapsed card is one
 * expand target, and tapping the rail opens the card, which shows the full
 * labelled rail with its tooltips. So the compact rail is decorative
 * (`aria-hidden`) with one screen-reader sentence beside it — three 16px
 * buttons per row would fail WCAG 2.5.5 and there is nothing to gain.
 */
export const COMPACT_DOT_PX = 16;
export const COMPACT_GAP_PX = 6;
/** The current step is drawn larger — SIZE is one of the two non-colour
 *  channels that separate it from a completed dot (the other is its ring). */
export const COMPACT_CURRENT_DOT_PX = 20;

/** Width the compact rail needs for `steps` dots. Pure, so the fit is a test. */
export function compactRailWidthPx(steps: number): number {
  if (steps <= 0) return 0;
  // The current dot is the widest; assume it is present, which is the widest
  // the rail can ever be.
  return (steps - 1) * COMPACT_DOT_PX + COMPACT_CURRENT_DOT_PX + (steps - 1) * COMPACT_GAP_PX;
}
