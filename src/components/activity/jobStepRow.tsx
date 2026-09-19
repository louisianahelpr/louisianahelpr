import { Children, createContext, useContext, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * THE ONE ACTION ROW of a job step card, and how a control that is drawn deep
 * inside the card still lands in it.
 *
 * Owner, 2026-09-14 (VN-21): "can all the buttons be on 1 row" — every button
 * on a Jobs or Posts step card sits on ONE row, inside the tracker box, with
 * the primary action (the dark green `btn-grad-primary`) leading and the chips
 * beside it. See JobStepCard for the layout rule itself.
 *
 * The hard part is that three of those primaries are not the step's to draw:
 *
 *   - the tracker's next-step CTA ("I'm On My Way", "I've Arrived", "Mark Job
 *     Complete") lives inside JobTracking, with its own busy state, gates,
 *     location retry and confirm dialog;
 *   - the day-of "I'm Still On" lives inside JobConfirmation;
 *   - the revision's "I'll Fix It" lives inside HelperRevisionCard.
 *
 * Lifting their state out would fork three components that already carry
 * money and trust gates. Instead the shell publishes two DOM hosts through
 * context and those components render their control THROUGH A PORTAL into the
 * row. React state, events and the gates stay exactly where they were; only the
 * DOM position moves. Outside a step card (no context) a slot renders its
 * children in place, so the components behave as before anywhere else.
 *
 * A control that claims the `primary` slot SUPPRESSES the step's own `primary`
 * prop — "where a step has a tracker CTA, that CTA IS the primary; don't render
 * two primaries". That is what retires the Working card's stacked pair (the
 * tracker's "Mark Job Complete" above PayoutPrimary's identical one).
 */

export interface JobStepRowHosts {
  /** The row's leading, wider slot. */
  primaryHost: HTMLElement | null;
  /** One quiet line directly ABOVE the row that explains its primary ("Before
   *  & after photos are required…", "Confirm by Tue 12:00 PM…"). */
  noteHost: HTMLElement | null;
  /** Register a control in the primary slot; returns the release. */
  claimPrimary: () => () => void;
}

export const JobStepRowContext = createContext<JobStepRowHosts | null>(null);

/** True inside a JobStepCard — for a component whose surrounding chrome only
 *  makes sense when its control stays in place (e.g. JobTracking's divider). */
export function useInJobStepRow(): boolean {
  return useContext(JobStepRowContext) !== null;
}

/** Does this node render anything at all? `false`/`null`/`undefined` do not. */
export function hasRenderable(node: ReactNode): boolean {
  return Children.toArray(node).length > 0;
}

export function JobStepRowSlot({ slot, children }: { slot: "primary" | "note"; children?: ReactNode }) {
  const ctx = useContext(JobStepRowContext);
  const present = hasRenderable(children);
  const claim = ctx?.claimPrimary;
  useLayoutEffect(() => {
    if (!claim || slot !== "primary" || !present) return;
    return claim();
  }, [claim, slot, present]);

  if (!ctx) return <>{children}</>;
  const host = slot === "primary" ? ctx.primaryHost : ctx.noteHost;
  return host && present ? createPortal(children, host) : null;
}

/** `gap-1.5` on the row. */
export const JOB_STEP_ROW_GAP_PX = 6;
/** The floor for a labelled chip when its words cannot be measured. */
export const LABELLED_CHIP_MIN_PX = 68;
/** The primary takes this many chip-widths while labels are showing. */
export const PRIMARY_FLEX = 2;
/**
 * An icon-only chip beside a primary — EXACTLY the 44px tap target.
 *
 * It was 48px, which is where the last type tier came from: four 48px chips at
 * 320px left the primary 40px, too narrow for "Resolve", so the row grew a
 * `[data-tight]` rung that stepped the primary down to 12px and stripped its
 * icon — a THIRD size and a THIRD shape, on the one control that most needs to
 * look like the others. At 44px the same row leaves the primary 56px, which
 * fits every primary label this app has at 11px, so the rung is gone (owner,
 * 2026-09-19: one treatment, tone and position are the only variables).
 */
export const ICON_CHIP_PX = 44;

/**
 * Should the secondary chips drop to icon-only?
 *
 * Owner rule (VN-21): never wrap to a second row. The labelled layout gives the
 * primary `PRIMARY_FLEX` shares and each chip one share. If that squeezes a
 * chip below the width its longest label WORD needs (`chipNeedPx`) — or the
 * primary below its own (`primaryNeedPx`) — the chips lose their visible label
 * (it stays as their accessible name) and the primary keeps its own.
 *
 * Words, not whole labels: a chip label wraps onto two lines ("Report a" /
 * "Problem") and that is fine; a single word that does not fit is what clips.
 *
 * `width` 0 means "not laid out" (hidden, or a test DOM): never compact then.
 */
export function shouldCompactJobStepRow({
  width,
  chips,
  hasPrimary,
  chipNeedPx = LABELLED_CHIP_MIN_PX,
  primaryNeedPx = 0,
}: {
  width: number;
  chips: number;
  hasPrimary: boolean;
  chipNeedPx?: number;
  primaryNeedPx?: number;
}): boolean {
  if (!width || chips === 0) return false;
  const items = chips + (hasPrimary ? 1 : 0);
  if (items <= 1) return false;
  const shares = chips + (hasPrimary ? PRIMARY_FLEX : 0);
  const share = (width - JOB_STEP_ROW_GAP_PX * (items - 1)) / shares;
  if (share < chipNeedPx) return true;
  return hasPrimary && share * PRIMARY_FLEX < primaryNeedPx;
}

/**
 * Once the chips are icon-only, how much room is left for the primary?
 *
 * This used to be `shouldTightenJobStepPrimary`, a THIRD rung that answered
 * "is the primary still short?" by shrinking it — 12px type, no icon, no side
 * padding. That was the row's own answer to the owner's complaint being
 * written into the CSS: the main move ended up a different size and a
 * different shape from the chips beside it precisely when the row was most
 * crowded. The rung is deleted; `ICON_CHIP_PX` came down to the 44px tap floor
 * instead, which buys the primary the same pixels without changing what it is.
 *
 * Kept as a measurement so a future label that genuinely cannot fit is a
 * FAILING NUMBER somebody can read, not a silent step-down.
 */
export function primaryRoomAfterCompaction({
  width,
  chips,
}: {
  width: number;
  chips: number;
}): number {
  if (!width) return 0;
  return width - chips * ICON_CHIP_PX - JOB_STEP_ROW_GAP_PX * chips;
}

/** Width of `text`'s longest word in `like`'s font — or, with `lines`, the
 *  width the whole text needs to fit on that many lines (never less than its
 *  longest word). Measured by a detached, invisible span on <body> — never
 *  inside the row, whose mutations the shell observes. Returns 0 where nothing
 *  is laid out (test DOMs). */
function longestWordPx(like: Element, text: string, lines?: number, fontSize?: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || typeof document === "undefined") return 0;
  const cs = getComputedStyle(like);
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;top:0;pointer-events:none;";
  probe.style.fontFamily = cs.fontFamily;
  probe.style.fontSize = fontSize ?? cs.fontSize;
  probe.style.fontWeight = cs.fontWeight;
  probe.style.fontStyle = cs.fontStyle;
  probe.style.letterSpacing = cs.letterSpacing;
  document.body.appendChild(probe);
  let max = 0;
  for (const w of words) {
    probe.textContent = w;
    max = Math.max(max, probe.getBoundingClientRect().width);
  }
  if (lines) {
    probe.textContent = words.join(" ");
    // A little slack per line: a greedy wrap rarely splits exactly in half.
    max = Math.max(max, probe.getBoundingClientRect().width / lines + 12);
  }
  probe.remove();
  return max;
}

/** A chip's label: its text-bearing span(s) (the SOS / Share chips render
 *  their own), else the element's own text. */
function chipNeedPx(chip: Element): number {
  const span = chip.querySelector("span:not(.sr-only)");
  const text = (span?.textContent || chip.textContent || "").trim();
  // px-1 on each side, the 0.5px border, and a pixel of rounding.
  return longestWordPx(span ?? chip, text) + 12;
}

/** The primary control(s): the label on at most TWO lines ("Confirm They're
 *  Working" stacked three words high read as a squeezed button, not a primary)
 *  + px-1 each side + the hairline.
 *
 *  Measured at 11px — the row's ONE type size (JOB_ROW_LABEL_CLASS) — and no
 *  longer at the `sm` Button's 14px: the primary is the same stacked chip as
 *  its neighbours now, so its icon sits ABOVE the label and costs the label no
 *  width at all. The old +16 icon and +20 padding terms came from the inline
 *  shape and over-reserved ~36px, which is part of what pushed short rows into
 *  compaction earlier than they needed to be. */
function primaryNeedPx(primaryHost: Element): number {
  const buttons = [...primaryHost.children];
  if (buttons.length === 0) return 0;
  const per = buttons.map((b) => longestWordPx(b, (b.textContent || "").trim(), 2, "11px") + 12);
  return per.reduce((a, b) => a + b, 0) + JOB_STEP_ROW_GAP_PX * (buttons.length - 1);
}

export interface JobStepRowLayout {
  compact: boolean;
  hasPrimary: boolean;
  empty: boolean;
}

/** Read the row as laid out and decide its mode. Called by JobStepCard on
 *  mount, on resize, and whenever the row's contents change. */
export function measureJobStepRow(row: HTMLElement): JobStepRowLayout {
  const primaryHost = row.querySelector<HTMLElement>(":scope > [data-job-step-primary]");
  const hasPrimary = !!primaryHost && primaryHost.childElementCount > 0;
  const chipEls = [...row.children].filter((c) => c !== primaryHost);
  const width = row.getBoundingClientRect().width;
  const empty = !hasPrimary && chipEls.length === 0;
  if (!width) return { compact: false, hasPrimary, empty };
  const chipNeed = chipEls.reduce((m, c) => Math.max(m, chipNeedPx(c)), 0) || LABELLED_CHIP_MIN_PX;
  const primaryNeed = hasPrimary && primaryHost ? primaryNeedPx(primaryHost) : 0;
  const compact = shouldCompactJobStepRow({
    width,
    chips: chipEls.length,
    hasPrimary,
    chipNeedPx: chipNeed,
    primaryNeedPx: primaryNeed,
  });
  return { compact, hasPrimary, empty };
}
