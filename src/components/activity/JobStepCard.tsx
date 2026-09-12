import type { ReactNode } from "react";
import { JobActionRow } from "./JobActionRow";

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
 * decides the order, the spacing, or how many columns the action row has.
 *
 * THE SLOTS, in the order they always render:
 *
 *   1. `header`  — where this job IS. The step rail on every live state; on a
 *      disputed job, which has left the rail entirely, the dispute banner takes
 *      the same slot. One slot, so the answer to "where am I" is always the
 *      first thing in the card.
 *   2. `ask`     — the ONE thing this step wants from the helper right now
 *      (a photo, a revision decision, a dispute response). Never two at once —
 *      that is the whole point.
 *   3. `notice`  — passive status ABOUT that ask or about the wait: countdowns,
 *      "Marked Complete", deadlines. Never a control. It sits under the ask
 *      because on every state that has both (revision) the deadline is a
 *      property of the ask, not a preface to it.
 *   4. `primary` — at most ONE full-width action. `singlePrimaryCta.test.tsx`
 *      is the standing guard; the shell's shape is what makes it easy to keep.
 *   5. `actions` — peer controls as chips. The shell derives `columns` from
 *      how many were actually passed, so a state that drops Directions gets a
 *      deliberate 2-up instead of a chip stranded in a 3-column grid. Callers
 *      pass an array and may include `false`/`null` for an absent chip.
 *   6. `footnote` — one quiet sentence explaining the row.
 *   7. `escape`  — the quiet last resort (Report a Problem). Deliberately
 *      BELOW the row rather than in it: a dispute freezes escrow and is not a
 *      peer of Message.
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
  primary?: ReactNode;
  /** Chips for the secondary row. Falsy entries are dropped before counting. */
  actions?: ReactNode[];
  /** One quiet sentence UNDER the row, explaining it — "Approve to release
   *  payment — then you can review and tip." Never a control. */
  footnote?: ReactNode;
  escape?: ReactNode;
  dialogs?: ReactNode;
}) {
  const chips = (actions ?? []).filter(Boolean);
  const columns = Math.min(Math.max(chips.length, 1), 5) as 1 | 2 | 3 | 4 | 5;

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
      {header}
      {ask}
      {notice}
      {primary}
      {chips.length > 0 && <JobActionRow columns={columns}>{chips}</JobActionRow>}
      {footnote}
      {escape}
      {dialogs}
    </div>
  );
}
