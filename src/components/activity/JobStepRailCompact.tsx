import {
  COMPACT_CURRENT_DOT_PX,
  COMPACT_DOT_PX,
  COMPACT_GAP_PX,
  railStepPaint,
} from "./jobRailTone";

/**
 * THE COLLAPSED CARD'S PROGRESS RAIL — 16px dots, no labels.
 *
 * Owner, 2026-09-19: "should we [move] posted, offered accepted confirmed etc
 * ones like this to the bottom of the collapsed card and when they want to see
 * more info then they click in to expand". "Posted / Offered / Accepted /
 * Confirmed" are the rail's own step names, so the ask is the RAIL, at the
 * bottom of the collapsed card, with everything else behind the tap.
 *
 * ── WHY IT IS 16px, WHICH WAS MEASURED BEFORE IT WAS CHOSEN ───────────────
 * The card's inner width is its `px-4` box, the same box `[data-job-step-row]`
 * occupies — measured on prod, both engines: 212px at a 320 viewport, 262px at
 * 375, 1035px at 1440 (src/test/jobStepRowWidthFloor.test.tsx).
 *
 *   full rail, 8 steps:  8×28 + 7×6 = 266px  >  212  — overflows and scrolls
 *   compact,   8 steps:  8×16 + 7×6 = 170px  ≤  212  — fits, 42px spare
 *
 * The full labelled rail could not fit a 320px card at any dot size that also
 * carried words, which is why it scrolls there today. This one fits outright
 * at every width, so a collapsed card never has a horizontally scrolling
 * region in it.
 *
 * ── THREE STATES, WITHOUT LABELS AND WITHOUT COLOUR ALONE ─────────────────
 * Colour is never the only channel (WCAG 1.4.1), and with the labels gone it
 * would have been. Each state differs in SHAPE as well as tone:
 *
 *   done      16px, SOLID fill.
 *   current   20px, solid fill PLUS a ring — larger and haloed, so it is the
 *             one dot that stands out in a row even in greyscale.
 *   to come   16px, HOLLOW: transparent centre, 1.5px border.
 *
 * Greyscale-safe by construction: solid / solid+ring+bigger / hollow are three
 * distinct forms before any colour is applied. The dispute red and the working
 * amber still come through `railStepPaint`, so
 * `src/test/alarmColourInvariant.test.ts` governs this rail exactly as it
 * governs the full one — they call the same function.
 *
 * ── NOT A CONTROL ─────────────────────────────────────────────────────────
 * The full rail's dots are buttons that open a timestamp tooltip, and they
 * carry an invisible 44px tap overlay to clear WCAG 2.5.5. These are not
 * controls: the whole collapsed card is one expand target, so tapping anywhere
 * on this rail opens the card and reveals the full labelled rail with its
 * tooltips. Eight 16px buttons in a 212px row could not carry a 44px target
 * anyway, and inventing one would be a tap that competes with the card's own.
 *
 * So the dots are `aria-hidden` decoration and the rail's meaning is carried
 * by ONE sentence for assistive tech — which is better than eight unlabelled
 * dots were ever going to be.
 */
export function JobStepRailCompact({
  steps,
  displayIdx,
  jobStatus,
  className = "",
}: {
  /** The step labels, in order — used for the accessible sentence only. */
  steps: readonly string[];
  /** Index of the current step, from `deriveCurrentStatusIdx`. */
  displayIdx: number;
  jobStatus?: string;
  className?: string;
}) {
  if (steps.length === 0) return null;
  const idx = Math.max(0, Math.min(displayIdx, steps.length - 1));

  return (
    <div
      className={`flex items-center ${className}`.trim()}
      style={{ gap: COMPACT_GAP_PX }}
      data-job-rail-compact=""
      data-step-count={steps.length}
    >
      {/* THE ONE THING A SCREEN READER GETS, and it says more than the dots
          do: which step, of how many, by name. The full rail announces as
          "Job progress, group" and then eight icon buttons; this is the same
          fact in one sentence, and it is why the dots below can be dropped
          from the tree entirely. */}
      <span className="sr-only">
        {`Job progress: step ${idx + 1} of ${steps.length}, ${steps[idx]}` +
          (jobStatus === "disputed" ? " — dispute open" : "")}
      </span>
      {steps.map((label, i) => {
        const paint = railStepPaint({
          idx: i,
          displayIdx: idx,
          stepCount: steps.length,
          jobStatus,
        });
        const isCurrent = i === idx;
        // HOLLOW for a step not yet reached — the shape channel, so the rail
        // reads correctly with no colour at all. `grey` is the only tone a
        // not-reached dot can have (railStepTone), so this cannot accidentally
        // hollow out a step that happened.
        const hollow = paint.tone === "grey";
        const size = isCurrent ? COMPACT_CURRENT_DOT_PX : COMPACT_DOT_PX;
        return (
          <span
            key={label}
            aria-hidden
            data-rail-dot={paint.tone}
            data-rail-current={isCurrent ? "true" : "false"}
            className="shrink-0 rounded-full"
            style={{
              width: size,
              height: size,
              background: hollow ? "transparent" : paint.fill,
              border: hollow ? `1.5px solid ${paint.ink}` : undefined,
              // The ring is the current dot's second non-colour channel. Same
              // two-stop shadow the full rail draws, at the smaller radius.
              boxShadow:
                isCurrent && paint.ring
                  ? `0 0 0 2px ${paint.ring}, 0 0 0 3.5px hsl(var(--parchment))`
                  : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
