import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { JobStepRowContext, hasRenderable, measureJobStepRow, type JobStepRowLayout } from "./jobStepRow";

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
 *   - The primary leads and flexes wider (PRIMARY_FLEX shares) with its label.
 *   - Every other action is an equal-width chip beside it (icon over label, as
 *     JobActionChip draws it).
 *   - When the labelled layout would squeeze a chip under LABELLED_CHIP_MIN_PX
 *     (3–4 buttons at 375), the chips drop to icon-only — the label stays as
 *     their accessible name — and the primary keeps its label. Measured, not
 *     guessed: see `shouldCompactJobStepRow`.
 *   - Where the tracker (or the day-of confirmation, or the revision) draws a
 *     next-step CTA, that CTA IS the primary: it portals into the row through
 *     `JobStepRowSlot` and the step's own `primary` is not rendered. Never two.
 *   - The ask and the notice stay ABOVE the row; a control's one-line reason
 *     ("Before & after photos are required…") sits directly above it.
 *
 * `src/components/activity/jobStepOneRow.test.tsx` renders every step of both
 * cards and fails if any control lands outside the single row;
 * `singlePrimaryCta.test.tsx` still holds the one-primary rule.
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
 *   4. the row's note — one line explaining the primary, portalled in by the
 *      control that owns the reason.
 *   5. THE ROW — `primary` (at most ONE, leading) then `actions` (chips).
 *      Callers pass `actions` as an array and may include `false`/`null` for
 *      an absent chip; `primary` may be null. A portalled CTA replaces
 *      `primary`.
 *   6. `footnote` — one quiet sentence explaining the row.
 *   7. `escape`  — quiet text below the row (e.g. the helper's after-cancel
 *      notice). Report a Problem is NOT here any more: owner, 2026-09-14
 *      (VN-19) moved it into `actions` as a danger chip beside Message.
 *   8. `dialogs` — portalled confirms. Rendered last, occupies no layout.
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
  /** One quiet sentence UNDER the row, explaining it — "Approve to release
   *  payment — then you can review and tip." Never a control. */
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
    compact: false,
    tight: false,
    empty: chips.length === 0 && !hasRenderable(primary),
    hasPrimary: hasRenderable(primary),
  });
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      const next = measureJobStepRow(row);
      setLayout((prev) =>
        prev.compact === next.compact &&
        prev.tight === next.tight &&
        prev.empty === next.empty &&
        prev.hasPrimary === next.hasPrimary
          ? prev
          : next,
      );
    };
    measure();
    // WIDTH changes only. The modes change the row's HEIGHT (labels hide,
    // the primary's type steps down), and re-measuring on that would feed the
    // decision back into itself.
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
        <div ref={setNoteHost} data-job-step-note="" className="space-y-1.5 empty:hidden" />
        <div
          ref={rowRef}
          data-job-step-row=""
          data-compact={layout.compact ? "true" : "false"}
          data-tight={layout.tight ? "true" : "false"}
          data-has-primary={layout.hasPrimary ? "true" : "false"}
          data-empty={layout.empty ? "true" : "false"}
          className="flex flex-nowrap items-stretch gap-1.5"
        >
          <div ref={setPrimaryHost} data-job-step-primary="" />
          {chips}
        </div>
        {primaryHost && ownPrimary ? createPortal(ownPrimary, primaryHost) : null}
        {footnote}
        {escape}
        {dialogs}
      </JobStepRowContext.Provider>
    </div>
  );
}
