import { isValidElement, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  JobStepRowContext,
  hasRenderable,
  measureJobStepRow,
  partitionJobStepRowChips,
  type JobStepRowLayout,
} from "./jobStepRow";
import { useClaimedPersonTile } from "./jobCardPerson";
import { JobStepOverflowChip } from "./JobActionRow";

/**
 * JobStepCard — the ONE structure every state of BOTH activity job cards is
 * drawn in: the helper's applied card and the poster's posted card.
 *
 * Owner, 2026-09-11: "there should not be so many different variations, each
 * step should be its own component." Six screenshots of the same card had six
 * layouts: the tracker present or absent, the primary action full-width or
 * missing or replaced by a disabled twin, the secondary row 1-up / 2-up / 3-up
 * with no rule, the photo ask sometimes beside a payout request, and the escape
 * sometimes a chip inside the row and sometimes an underline below it.
 *
 * Owner again, an hour later, on the poster's card: "same goes for post step
 * components" — and asked whether the two sides should share this shell or only
 * its primitives, they chose ONE shell. The two cards drift apart precisely
 * because nothing holds them to a shape; this is that thing. A step declares
 * WHAT it needs, never how it is drawn, so the sides differ in CONTENT and in
 * nothing else.
 *
 * The fix is not more conditionals in one component — it is a fixed SHELL plus
 * one component per step. Each step declares what goes in the slots; it never
 * decides the order, the spacing, or how the action row is laid out.
 *
 * ── ONE ROW OF BUTTONS (owner, 2026-09-14, VN-21) ─────────────────────────
 * "i don't think i like the multiple rows of buttons for jobs and posts. can
 * all the buttons be on 1 row", then "all buttons should be with the live
 * tracker box", and on Posts "confirm they're working, no show, message etc —
 * all of these buttons need to be on 1 line not multiple". Asked, the owner
 * ruled: ONE row, the primary action in the dark green (`btn-grad-primary`),
 * the other buttons beside it. This reverses the stacked contract below it —
 * a full-width primary, then a chip grid, with the tracker's own CTA a third
 * row inside the header. The rule, owned HERE and never per step:
 *
 *   - ONE horizontal row (`flex-nowrap`), inside this card — the same box the
 *     tracker lives in. It never wraps to a second row.
 *   - The primary TRAILS on the right (owner V2/V3) and flexes wider
 *     (PRIMARY_FLEX shares) with its label.
 *   - Every other action is an equal-width chip beside it (icon over label, as
 *     JobActionChip draws it).
 *   - EVERY CONTROL KEEPS ITS VISIBLE LABEL, at every width (owner,
 *     2026-09-19, second phone report). When the roomy 2:1 share would squeeze
 *     a chip under the width its longest label word needs, the row goes TIGHT:
 *     each chip is pinned to exactly that width and the ones that no longer
 *     fit move into `More` — labelled, two up. A chip NEVER becomes an
 *     anonymous icon square. Measured, not guessed: see
 *     `shouldTightenJobStepRow` and `allocateJobStepRow`.
 *   - Where the tracker (or the day-of confirmation, or the revision) draws a
 *     next-step CTA, that CTA IS the primary: it portals into the row through
 *     `JobStepRowSlot` and the step's own `primary` is not rendered. Never two.
 *   - The ask and the notice stay ABOVE the row. THE ROW'S ONE EXPLANATION
 *     LINE SITS BELOW IT, CENTRED — see the next block; this sentence used to
 *     say "directly above it" and was the contract that moved.
 *
 * `src/components/job-card/jobStepOneRow.test.tsx` renders every step of both
 * cards and fails if any control lands outside the single row;
 * `singlePrimaryCta.test.tsx` still holds the one-primary rule.
 *
 * ── ONE EXPLANATION LINE, BELOW THE ROW, CENTRED (owner, 2026-09-19) ───────
 * "You'll be able to confirm this once your Helpr is at the job. should be
 * under the buttons", and then "Approve to release payment — then you can
 * review and tip. center under buttons".
 *
 * Those two strings are not the same KIND of sentence, and that is the point:
 *
 *   GATE REASON    — a control is disabled and this says why (the arrival
 *                    ladder, the GPS/arrival block, the before-photo gate,
 *                    the day-of confirmation deadline, the 30-minute payout
 *                    floor). AMBER, because something is stopping you.
 *   CONSEQUENCE    — the control is ENABLED and this says what happens when
 *                    you press it ("Approve to release payment — then you can
 *                    review and tip"). MUTED, because nothing is stopping you.
 *
 * The owner asked for both to sit under the buttons, so the rule is not
 * "disabled reasons move"; it is EVERY one-line explanation attached to the
 * row sits below it, centred, in the card's quiet type. The amber/muted split
 * stays — it is the only thing distinguishing "you can't" from "you can, and
 * here is what happens" once both live in the same place.
 *
 * AND THERE IS ONLY EVER ONE OF THEM. A gate reason and a consequence line can
 * both apply at once (in-progress, poster: the Helpr has marked the job done
 * so Approve is live and its footnote applies, while the arrival confirmation
 * the poster never took is still sitting there disabled with its own reason).
 * Two centred sentences under one row is worse than either alone, so THE GATE
 * WINS: the `note` host is the reason the reader is reaching for right now,
 * and the consequence of a DIFFERENT button can wait until the gate clears.
 * `footnote` therefore renders only while the note host is empty — the same
 * shape as the one-primary rule above, and for the same reason.
 *
 * THE SLOTS, in the order they always render:
 *
 *   1. `header`  — where this job IS. The step rail on every state that has
 *      one, disputed included (owner, 2026-09-14, VN-23: "disputes should still
 *      show the tracker" — the dispute banner sits directly BELOW the rail in
 *      the same slot, it no longer replaces it). One slot, so the answer to
 *      "where am I" is always the first thing in the card.
 *   2. `ask`     — the ONE thing this step wants from the helper right now
 *      (a photo, a revision decision, a dispute response). Never two at once —
 *      that is the whole point. Its CONTENT stays here; a button that acts on
 *      it goes in the row.
 *   3. `notice`  — passive status ABOUT that ask or about the wait: countdowns,
 *      "Marked Complete", deadlines. Never a control. It sits under the ask
 *      because on every state that has both (revision) the deadline is a
 *      property of the ask, not a preface to it.
 *   4. THE PERSON TILE — who is on the other end of this job (the Helpr on
 *      My Posts, "Posted by" on My Jobs). Not a prop: it arrives through
 *      `JobCardPersonContext` (jobCardPerson.tsx), which also tells the card
 *      whether a step card took it, so a state with no row still prints the
 *      profile. Owner, 2026-09-19: "the helpr or posted by should be right
 *      above the buttons."
 *   5. THE ROW — `actions` (chips) then `primary` (at most ONE, TRAILING on
 *      the right per owner V2/V3; its `flex:2` still makes it the widest slot).
 *      Callers pass `actions` as an array and may include `false`/`null` for
 *      an absent chip; `primary` may be null. A portalled CTA replaces
 *      `primary`.
 *   6. the row's note — ONE centred line BELOW the row, portalled in by the
 *      control that owns the reason (owner, 2026-09-19 — it was above until
 *      today). Amber for a gate, muted for a wait.
 *   7. `footnote` — one quiet centred sentence saying what the row's enabled
 *      primary will DO. Stands down while the note host has something in it,
 *      so the card never stacks two explanations under one row.
 *   8. `escape`  — quiet text below the row (e.g. the helper's after-cancel
 *      notice). Report a Problem is NOT here any more: owner, 2026-09-14
 *      (VN-19) moved it into `actions` as a danger chip beside Message.
 *   9. `dialogs` — portalled confirms. Rendered last, occupies no layout.
 */
export function JobStepCard({
  side,
  step,
  tone = "neutral",
  header,
  notice,
  ask,
  primary,
  actions,
  soloChipKey,
  footnote,
  escape,
  dialogs,
}: {
  /** Whose card this is. Rendered as `data-job-step` so a screenshot spec — and
   *  a reader of the DOM — can say which side and which step they are looking
   *  at without inferring it from the copy. */
  side: "helper" | "poster";
  /** The step id within that side, e.g. "working", "disputed". */
  step: string;
  /** `alert` is the sienna wash a disputed job wears. Neutral is every live step. */
  tone?: "neutral" | "alert";
  header?: ReactNode;
  notice?: ReactNode;
  ask?: ReactNode;
  /** The step's own primary, used only when no nested control (the tracker's
   *  CTA, the day-of confirmation, the revision's accept) has claimed the slot. */
  primary?: ReactNode;
  /** Chips for the row, beside the primary. Falsy entries are dropped. */
  actions?: ReactNode[];
  /** The React key of the chip that stays when only ONE fits (phone width);
   *  the rest go into `More`, drawn to its left. Unset: the leftmost chip stays.
   *  See partitionJobStepRowChips. */
  soloChipKey?: string;
  /** One quiet CENTRED sentence under the row saying what its enabled primary
   *  will do — "Approve to release payment — then you can review and tip."
   *  Never a control, never amber (amber means a gate is stopping you), and
   *  suppressed while the row's `note` host carries a gate reason. */
  footnote?: ReactNode;
  escape?: ReactNode;
  dialogs?: ReactNode;
}) {
  const chips = (actions ?? []).filter(Boolean);

  // Portal hosts. Callback refs into state, so the context re-renders the
  // slots once the hosts exist (before paint — ref attachment is a layout-phase
  // update).
  const [primaryHost, setPrimaryHost] = useState<HTMLDivElement | null>(null);
  const [noteHost, setNoteHost] = useState<HTMLDivElement | null>(null);
  // Does the note host currently hold a line? The footnote stands down when it
  // does — see "ONE EXPLANATION LINE" above. Read from the DOM rather than from
  // props because every note arrives by PORTAL, from a component that is not
  // this one's child in the React tree that owns the prop.
  const [noteFilled, setNoteFilled] = useState(false);
  const [claims, setClaims] = useState(0);
  const claimPrimary = useCallback(() => {
    setClaims((c) => c + 1);
    return () => setClaims((c) => c - 1);
  }, []);
  const hosts = useMemo(() => ({ primaryHost, noteHost, claimPrimary }), [primaryHost, noteHost, claimPrimary]);

  const ownPrimary = claims === 0 && hasRenderable(primary) ? primary : null;

  // ── Label or icon-only, and whether the row has anything in it at all ──
  // Read from the DOM, not from props: a chip or primary element can render
  // nothing (Directions with no address, PayoutPrimary before the photos), and
  // a portalled CTA never passes through this component's props.
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<JobStepRowLayout>({
    tight: false,
    empty: chips.length === 0 && !hasRenderable(primary),
    hasPrimary: hasRenderable(primary),
    rowPx: 0,
    chipNeedPx: 0,
    alloc: {
      visibleChips: chips.length,
      overflowChips: 0,
      chipSlots: chips.length,
      primaryPx: 0,
      perPrimaryPx: 0,
      chipPx: 0,
    },
  });
  // How many chips the STEP wants in the row, read from the DOM but corrected
  // for the ones currently parked in the overflow control — measuring the raw
  // DOM count would oscillate (take chips out, find room, put them back).
  const overflowCountRef = useRef(0);
  overflowCountRef.current = layout.alloc.overflowChips;
  // THE CHIPS' WIDEST LABEL WORD, AS A HIGH-WATER MARK. Same problem as the
  // count above and the same shape of answer: a chip parked in `More` is not a
  // child of the row, so re-reading the DOM would forget it needed 58px, find
  // room, put it back, and take it out again next frame. The mark is reset
  // when the wanted-chip COUNT changes, so a genuinely different set of chips
  // is measured fresh rather than inheriting the old set's widest word.
  const chipNeedRef = useRef(0);
  const wantedRef = useRef(-1);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      const inRow = [...row.children].filter(
        (c) => !c.hasAttribute("data-job-step-primary") && !c.hasAttribute("data-job-step-overflow"),
      ).length;
      const wanted = inRow + overflowCountRef.current;
      if (wanted !== wantedRef.current) {
        wantedRef.current = wanted;
        chipNeedRef.current = 0;
      }
      const next = measureJobStepRow(row, wanted, chipNeedRef.current);
      chipNeedRef.current = next.chipNeedPx;
      setLayout((prev) =>
        prev.tight === next.tight &&
        prev.empty === next.empty &&
        prev.hasPrimary === next.hasPrimary &&
        prev.rowPx === next.rowPx &&
        prev.alloc.chipPx === next.alloc.chipPx &&
        prev.alloc.visibleChips === next.alloc.visibleChips &&
        prev.alloc.overflowChips === next.alloc.overflowChips
          ? prev
          : next,
      );
    };
    measure();
    // WIDTH changes only. Tightening changes the row's HEIGHT (a primary
    // wraps onto fewer lines once it is given the room), and re-measuring on
    // that would feed the decision back into itself.
    let lastWidth = row.getBoundingClientRect().width;
    const onResize = () => {
      const w = row.getBoundingClientRect().width;
      if (w === lastWidth) return;
      lastWidth = w;
      measure();
    };
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    resize?.observe(row);
    const mutations = typeof MutationObserver !== "undefined" ? new MutationObserver(measure) : null;
    mutations?.observe(row, { childList: true, subtree: true });
    return () => {
      resize?.disconnect();
      mutations?.disconnect();
    };
  }, []);

  // THE ONE-EXPLANATION RULE, measured rather than declared. A portalled note
  // is not visible to this component's props, and `createPortal` commits its
  // children in the same pass, so the host's child count after layout is the
  // only honest answer to "is there already a line under this row".
  useLayoutEffect(() => {
    if (!noteHost) return;
    const read = () => setNoteFilled(noteHost.childElementCount > 0);
    read();
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(read) : null;
    mo?.observe(noteHost, { childList: true });
    return () => mo?.disconnect();
  }, [noteHost]);

  // The other party's profile, handed in by the card through context. Claiming
  // it here is what stands the card's own fallback copy down — see
  // jobCardPerson.tsx for why it is a claim and not a boolean.
  const personTile = useClaimedPersonTile();

  /* Which chips stay in the row, and which go into `More`. `overflowChips` 0
     means everything fits, and the partition then returns every chip as `lead`
     — including in a test DOM or a hidden card, where nothing is measured. */
  const rowChips = partitionJobStepRowChips(
    chips,
    layout.alloc.overflowChips > 0 ? layout.alloc.visibleChips : chips.length,
    soloChipKey === undefined
      ? -1
      : chips.findIndex((c) => isValidElement(c) && c.key === soloChipKey),
  );

  return (
    <div
      className={
        tone === "alert"
          ? "px-4 py-3 space-y-2.5"
          : "px-4 py-3 border-t border-[hsl(var(--olivewood)/0.1)] bg-card space-y-2.5"
      }
      data-job-step={`${side}:${step}`}
      data-job-step-tone={tone}
      onClick={(e) => e.stopPropagation()}
      style={
        tone === "alert"
          ? {
              borderTop: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
              background: "hsl(var(--burnt-sienna) / 0.06)",
            }
          : undefined
      }
    >
      <JobStepRowContext.Provider value={hosts}>
        {header}
        {ask}
        {notice}
        {/* WHO, directly above WHAT YOU CAN DO (owner, 2026-09-19). Last thing
            before the controls on both cards; `empty:hidden` is unnecessary
            because `useClaimedPersonTile` returns null rather than an empty
            node when there is nobody to show (collapsed card, ownerless job). */}
        {personTile}
        <div
          ref={rowRef}
          data-job-step-row=""
          data-tight={layout.tight ? "true" : "false"}
          data-has-primary={layout.hasPrimary ? "true" : "false"}
          data-empty={layout.empty ? "true" : "false"}
          className="job-step-row flex flex-nowrap items-stretch gap-1.5"
          /* THE CHIPS' OWN LABELLED WIDTH, handed to CSS rather than declared
             in it. The tight rung pins every chip to the width its longest
             label word needs, and that number is MEASURED (the font decides
             it) — a stylesheet cannot know it. `index.css` reads this var and
             falls back to the 44px tap floor if it is ever absent. */
          style={
            layout.tight && layout.alloc.chipPx
              ? ({ "--job-row-chip": `${layout.alloc.chipPx}px` } as CSSProperties)
              : undefined
          }
        >
          {/* Chips lead, the primary TRAILS on the right (owner, 2026-09-15,
              V2/V3: "primary buttons should be RIGHT"). DOM order = visual
              order = focus order, so the primary is last to Tab to as well as
              rightmost. Its `flex: 2` (index.css) still makes it the widest
              slot — now on the right — so the hierarchy VN-21 set is kept,
              only the side changes. */}
          {/* WHAT THE ROW CAN HOLD, not what the step asked for. At 320 the
              row is 212px and five controls at the 44px tap floor need 244px;
              the last chips move into the overflow control, which takes one
              chip slot and is the same object as the chips it holds. See
              `allocateJobStepRow`. With no measurement (a test DOM, a hidden
              card) `overflowChips` is 0 and every chip renders in place. */}
          {/* THE ENDS ARE PINNED AND THE MIDDLE COLLAPSES (owner, 2026-09-19:
              "report a problem always all the way on the left"; "before and
              after photos should be to the left of the primary buttons"). The
              allocator says how many chips fit;
              `partitionJobStepRowChips` says which ones, and it never sends a
              pinned end into the popover — the `More` control lands where the
              chips it holds came from. */}
          {rowChips.lead}
          {rowChips.overflow.length > 0 ? (
            <JobStepOverflowChip
              count={rowChips.overflow.length}
              /* THE PANEL IS THE ROW'S BOX, not the viewport's. Anchored to
                 the trigger and sized by `w-[min(17rem,calc(100vw-1.5rem))]`
                 it was 272px wide inside a 244px card at 320, so Radix's
                 collision detection shoved it to x=12 — off the card, over the
                 page, pointing at nothing. Anchored to the ROW and given the
                 ROW's width it lands exactly over the controls it came from,
                 inside the card, at every width, and collision detection has
                 nothing left to correct. */
              anchorRef={rowRef}
              width={layout.rowPx}
            >
              {rowChips.overflow}
            </JobStepOverflowChip>
          ) : null}
          {rowChips.trail}
          <div ref={setPrimaryHost} data-job-step-primary="" className="job-step-primary" />
        </div>
        {primaryHost && ownPrimary ? createPortal(ownPrimary, primaryHost) : null}
        {/* THE ROW'S ONE EXPLANATION, BELOW IT AND CENTRED (owner, 2026-09-19:
            "should be under the buttons", "center under buttons"). It was
            directly ABOVE the row until today, and the doc block at the top of
            this file said so — the contract and the code moved together on
            purpose, because a slot comment that contradicts its own render is
            how the 320px row shipped as a 12px sliver.

            `text-center` lives HERE, on the host, not on each of the four
            components that portal into it: one alignment for the set is the
            whole of the owner's second note, and a per-caller class is four
            chances to drift. The callers keep their own COLOUR (amber for a
            gate, muted for a wait or a consequence) because that distinction
            is load-bearing and was tuned today. */}
        <div ref={setNoteHost} data-job-step-note="" className="space-y-1.5 text-center empty:hidden" />
        {/* …and never two. See "ONE EXPLANATION LINE" at the top of the file:
            a gate reason and a consequence line can both apply on the poster's
            in-progress card, and the gate is the one the reader is standing in
            front of. */}
        {noteFilled ? null : footnote}
        {escape}
        {dialogs}
      </JobStepRowContext.Provider>
    </div>
  );
}
