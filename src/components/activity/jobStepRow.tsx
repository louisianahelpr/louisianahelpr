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
 * THE TAP TARGET IS A WIDTH FLOOR TOO — 44px, for every control in the row.
 *
 * `index.css` floors `min-height: 44px` on every button and floors NOTHING on
 * the width, which is the hole a 12px primary shipped through: the row simply
 * divided the pixels it had and painted the loser's label onto the card.
 * Measured on prod 2026-09-19, both engines, at 320: helper `disputed`
 * "Withdraw Dispute" 12px wide with 43px of label outside it; poster
 * `disputed` "Resolve & Pay" 12px with 31px outside — the control that
 * releases escrow.
 *
 * Nothing in CSS can fix that, because CSS has no way to say "and if they do
 * not all fit, take one out". The floor is therefore enforced where the count
 * is decided — `allocateJobStepRow` below — and `index.css` carries the same
 * 44px as a last-ditch `min-width` so a stale measurement yields a clipped row
 * inside the card's own `overflow-hidden` rather than a legible-looking
 * control that is 12px wide.
 */
export const ROW_CONTROL_MIN_PX = 44;
/**
 * An icon-only chip beside a primary — EXACTLY the 44px tap target, the same
 * number as {@link ROW_CONTROL_MIN_PX} because it IS that number.
 *
 * It was 48px, which is where the last type tier came from: four 48px chips at
 * 320px left the primary 40px, too narrow for "Resolve", so the row grew a
 * `[data-tight]` rung that stepped the primary down to 12px and stripped its
 * icon — a THIRD size and a THIRD shape, on the one control that most needs to
 * look like the others. The rung is gone (owner, 2026-09-19: one treatment,
 * tone and position are the only variables) and 44px is the floor instead.
 */
export const ICON_CHIP_PX = ROW_CONTROL_MIN_PX;

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
 * Once the chips are icon-only, how much room is left for the primary SLOT?
 *
 * This is not a policy, it is a transcription of what the browser does with
 * `index.css`'s compact rung: each chip is `flex: 0 1 44px`, the primary slot
 * is `flex: 1 0 …`, so the slot gets whatever the chips and the gaps leave.
 * `chips` is the number of chip SLOTS actually rendered — after
 * {@link allocateJobStepRow} has moved any that do not fit into the overflow
 * control, and counting that control itself as one.
 *
 * ── THE NUMBER THIS DOC BLOCK USED TO ASSERT WAS FALSE ─────────────────────
 * It said "four 44px icon chips at 320px leave the primary ~56px", from a row
 * width of 256 that was stated and never measured. The row measures 212px at
 * 320 (measured on prod, 2026-09-19, helper and poster `disputed`), so four
 * chips leave 212 − 176 − 24 = **12px**, and that is exactly what shipped:
 *
 *     3 chips @320:  212 − 132 − 18 = 62px   ✓ fits "Withdraw"
 *     4 chips @320:  212 − 176 − 24 = 12px   ✗ 43px of label on the card
 *
 * A wrong number in a comment is how this shipped past a green suite, so the
 * arithmetic is now a test as well as a sentence — see
 * `src/test/jobStepRowWidthFloor.test.tsx`.
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

/**
 * The width ONE control in the primary slot must have before its label starts
 * painting onto the card: its longest word plus the control's own padding,
 * never below the tap floor.
 *
 * Deliberately the LONGEST WORD and not the two-line ideal that
 * `primaryNeedPx` measures for the compaction decision. Those are two
 * different questions: "would this look squeezed?" (compaction, may say yes
 * generously) versus "is this broken?" (this, must say yes only when a word
 * genuinely cannot fit). Using the generous number here would take controls
 * out of rows that render correctly today at 375.
 */
export function primaryControlFloorPx(longestWordPx: number): number {
  return Math.max(ROW_CONTROL_MIN_PX, longestWordPx);
}

export interface JobStepRowAllocation {
  /** Chips that stay in the row. */
  visibleChips: number;
  /** Chips that move into the overflow control. 0 when everything fits. */
  overflowChips: number;
  /** Chip SLOTS the row draws — `visibleChips` plus the overflow control. */
  chipSlots: number;
  /** Width the whole primary slot ends up with, 0 when there is no primary. */
  primaryPx: number;
  /** Width EACH control inside the primary slot ends up with (they are equal
   *  flex children), 0 when there is no primary. */
  perPrimaryPx: number;
  /** Width each chip ends up with. */
  chipPx: number;
}

/**
 * HOW MANY CONTROLS THIS ROW CAN ACTUALLY HOLD, and what each one gets.
 *
 * The row is ONE row that never wraps (owner, VN-21) and every control in it
 * is the same object (owner, 2026-09-19). Both of those are kept. What is no
 * longer pretended is that a row of any length fits: at 320 the row measures
 * 212px, and FIVE controls at the 44px tap floor need
 * `5×44 + 4×6 = 244px`. They do not fit, and no amount of shape-work makes
 * them — the honest answer is that one of them has to leave the row.
 *
 *     capacity(212, primary needing 56px) = 3 chips  → 4 controls
 *     capacity(262, primary needing 56px) = 4 chips  → 5 controls  (375)
 *     capacity(1035, …)                   = no limit in practice   (1440)
 *
 * So: when the step wants more chips than fit, the last of them move into an
 * overflow control (`JobStepOverflowChip`) that takes ONE chip slot and opens
 * them in a panel. Nothing is dropped, nothing shrinks below the tap target,
 * the row stays one row, and the overflow control is the same object as every
 * other chip — one shape, still.
 *
 * WHAT THIS DELIBERATELY IS NOT: a second size, a second stack direction, or a
 * `[data-tight]`-style rung. Those all answer "it does not fit" by making the
 * control smaller, which is the bug this replaces.
 *
 * ── THE PRIMARY SLOT MAY HOLD MORE THAN ONE CONTROL ────────────────────────
 * `primaryNeeds` is one entry per control in the slot, because two of them
 * land there today: JobTracking portals "Try My Location Again" AND its
 * next-step CTA through a single `JobStepRowSlot`, and on a day-of confirmation
 * JobTracking's CTA and JobConfirmation's "I'm Still On" arrive through two
 * separate ones. They are equal flex children (`index.css`), so the slot is
 * sized to `n × the widest of them` — sizing it to the SUM would still leave
 * the wider control short of its own need.
 *
 * `width` 0 means "not laid out" (hidden, or a test DOM): allocate nothing and
 * take nothing out of the row, exactly as `shouldCompactJobStepRow` does.
 */
export function allocateJobStepRow({
  width,
  chips,
  compact,
  primaryNeeds,
}: {
  width: number;
  chips: number;
  /** The row's measured mode — the labelled layout has its own arithmetic and
   *  only ever applies when everything already fits. */
  compact: boolean;
  /** Longest-word floor per control in the primary slot; empty = no primary. */
  primaryNeeds: number[];
}): JobStepRowAllocation {
  const primaries = primaryNeeds.length;
  const none: JobStepRowAllocation = {
    visibleChips: chips,
    overflowChips: 0,
    chipSlots: chips,
    primaryPx: 0,
    perPrimaryPx: 0,
    chipPx: 0,
  };
  if (!width) return none;

  if (!compact) {
    // Labelled. By construction `shouldCompactJobStepRow` said every chip's
    // longest word and the primary's own need already fit their shares, so
    // nothing leaves the row; report the geometry the shares produce.
    const items = chips + (primaries ? 1 : 0);
    const shares = chips + (primaries ? PRIMARY_FLEX : 0);
    if (!shares) return none;
    const share = (width - JOB_STEP_ROW_GAP_PX * Math.max(0, items - 1)) / shares;
    const primaryPx = primaries ? share * PRIMARY_FLEX : 0;
    return {
      ...none,
      primaryPx,
      perPrimaryPx: primaries
        ? (primaryPx - JOB_STEP_ROW_GAP_PX * (primaries - 1)) / primaries
        : 0,
      chipPx: share,
    };
  }

  const floor = primaries ? Math.max(...primaryNeeds.map(primaryControlFloorPx)) : 0;
  const primaryBlock = primaries
    ? primaries * floor + JOB_STEP_ROW_GAP_PX * (primaries - 1)
    : 0;
  const roomForChips = width - primaryBlock - (primaries ? JOB_STEP_ROW_GAP_PX : 0);
  const capacity =
    roomForChips < ROW_CONTROL_MIN_PX
      ? 0
      : Math.floor((roomForChips + JOB_STEP_ROW_GAP_PX) / (ROW_CONTROL_MIN_PX + JOB_STEP_ROW_GAP_PX));

  let visibleChips = chips;
  let overflowChips = 0;
  if (chips > capacity) {
    // One of the slots goes to the overflow control itself. `capacity` 0 is
    // the degenerate row — not reachable by any state in the app today, and
    // `src/test/jobStepRowWidthFloor.test.tsx` fails if one arrives — so it
    // still shows the overflow control rather than silently losing the chips.
    visibleChips = Math.max(0, capacity - 1);
    overflowChips = chips - visibleChips;
  }
  const chipSlots = visibleChips + (overflowChips ? 1 : 0);
  const primaryPx = primaries ? primaryRoomAfterCompaction({ width, chips: chipSlots }) : 0;
  return {
    visibleChips,
    overflowChips,
    chipSlots,
    primaryPx,
    perPrimaryPx: primaries
      ? (primaryPx - JOB_STEP_ROW_GAP_PX * (primaries - 1)) / primaries
      : 0,
    chipPx: ROW_CONTROL_MIN_PX,
  };
}

/**
 * WHICH chips leave the row when they do not all fit — the ends never do.
 *
 * `allocateJobStepRow` answers HOW MANY. Until 2026-09-19 the shell then took
 * the LAST `n`, which was fine while chip order was arbitrary. The owner then
 * pinned both ends of the row:
 *
 *   "report a problem always all the way on the left"
 *   "before and after photos should be to the left of the primary buttons"
 *
 * Taking from the end would now hide the photo chip — the control the owner
 * had just asked to put beside the primary — and taking from the front would
 * hide Report a Problem. So the overflow comes out of the MIDDLE, the `More`
 * control sits where the missing chips came from, and the two pinned controls
 * are always on screen at every width.
 *
 * WHICH END OF THE MIDDLE GOES FIRST: the right. The step files write their
 * middles in the house order — the escape and safety controls first, then
 * Message, then the ancillary read-only ones (Timeline & Evidence, Contact
 * Admin, Directions) — so collapsing from the right sends the least
 * consequential in first and keeps Message visible longest.
 *
 * WITH ROOM FOR ONLY ONE VISIBLE CHIP the LEAD pin wins. The leftmost chip is
 * the escape (Report a Problem, Cancel, Escalate) — the one whose absence is a
 * safety problem rather than an inconvenience — and the photo chip is still one
 * tap away inside `More`, which is not true of nothing at all.
 *
 * Pure, and exported, so the rule is testable without a layout.
 */
export function partitionJobStepRowChips<T>(
  chips: readonly T[],
  visible: number,
): { lead: T[]; overflow: T[]; trail: T[] } {
  if (visible >= chips.length) return { lead: [...chips], overflow: [], trail: [] };
  if (visible <= 0) return { lead: [], overflow: [...chips], trail: [] };
  if (visible === 1) return { lead: [chips[0]], overflow: chips.slice(1), trail: [] };
  const trail = [chips[chips.length - 1]];
  // `visible - 1` because the trail pin takes one of the visible slots.
  const lead = chips.slice(0, visible - 1);
  const overflow = chips.slice(visible - 1, chips.length - 1);
  return { lead, overflow, trail };
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

/** The BREAKING point, per control in the primary slot: the longest single
 *  word plus the control's padding. Below this a word paints outside its own
 *  box — which is the defect, not a squeeze. (`primaryNeedPx` above answers
 *  the softer "would this look squeezed?" for the compaction decision.) */
function primaryWordNeeds(primaryHost: Element): number[] {
  return [...primaryHost.children].map(
    (b) => longestWordPx(b, (b.textContent || "").trim(), undefined, "11px") + 12,
  );
}

export interface JobStepRowLayout {
  compact: boolean;
  hasPrimary: boolean;
  empty: boolean;
  /** How the row's width divides up — and, when it does not go round, how
   *  many chips move into the overflow control. */
  alloc: JobStepRowAllocation;
}

/**
 * Read the row as laid out and decide its mode. Called by JobStepCard on
 * mount, on resize, and whenever the row's contents change.
 *
 * `wantedChips` is how many chips the STEP asked for, which is not always how
 * many are in the DOM: once some have moved into the overflow control they are
 * no longer children of the row. Measuring the DOM count instead would make
 * the allocation oscillate (take chips out → more room → put them back).
 */
export function measureJobStepRow(row: HTMLElement, wantedChips: number): JobStepRowLayout {
  const primaryHost = row.querySelector<HTMLElement>(":scope > [data-job-step-primary]");
  const hasPrimary = !!primaryHost && primaryHost.childElementCount > 0;
  const chipEls = [...row.children].filter((c) => c !== primaryHost);
  const width = row.getBoundingClientRect().width;
  const empty = !hasPrimary && chipEls.length === 0;
  const idle: JobStepRowAllocation = {
    visibleChips: wantedChips,
    overflowChips: 0,
    chipSlots: wantedChips,
    primaryPx: 0,
    perPrimaryPx: 0,
    chipPx: 0,
  };
  if (!width) return { compact: false, hasPrimary, empty, alloc: idle };
  const chipNeed = chipEls.reduce((m, c) => Math.max(m, chipNeedPx(c)), 0) || LABELLED_CHIP_MIN_PX;
  const primaryNeed = hasPrimary && primaryHost ? primaryNeedPx(primaryHost) : 0;
  // Compaction is decided on what the step WANTS in the row, for the same
  // reason the allocation is: deciding it on the post-overflow count would let
  // the labels come back, which would re-crowd the row that just made space.
  const compact = shouldCompactJobStepRow({
    width,
    chips: wantedChips,
    hasPrimary,
    chipNeedPx: chipNeed,
    primaryNeedPx: primaryNeed,
  });
  const alloc = allocateJobStepRow({
    width,
    chips: wantedChips,
    compact,
    primaryNeeds: hasPrimary && primaryHost ? primaryWordNeeds(primaryHost) : [],
  });
  return { compact, hasPrimary, empty, alloc };
}
