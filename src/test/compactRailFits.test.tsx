/**
 * THE COLLAPSED RAIL FITS, AND IT READS WITHOUT COLOUR.
 *
 * Owner, 2026-09-19, choosing between options they had been given the
 * arithmetic for: 16px dots, no labels.
 *
 * ── THE NUMBERS THE DECISION WAS MADE ON ──────────────────────────────────
 * The card's inner width is its `px-4` box inside `JobCardShell` — the same
 * box `[data-job-step-row]` occupies, which was measured on prod on both
 * engines (src/test/jobStepRowWidthFloor.test.tsx):
 *
 *      viewport   card inner width
 *      320        212px
 *      375        262px
 *      1440       1035px
 *
 *      full rail, 8 steps:  8×28 + 7×6 = 266px   >  212   overflows, scrolls
 *      compact,   8 steps:  8×16 + 7×6 = 170px   ≤  212   fits, 42px spare
 *      compact,   7 steps:  7×16 + 6×6 = 148px   ≤  212   fits
 *
 * The full labelled rail could never have fitted a 320px card at any dot size
 * that also carried words, which is why it scrolls there today. The compact
 * one fits outright at every width, so a collapsed card contains no
 * horizontally scrolling region at all.
 *
 * This file recomputes that from the real constants rather than repeating the
 * sums in prose. A doc block claiming a width nobody measured is precisely how
 * the 12px action row shipped (see jobStepRowWidthFloor's own header), so the
 * arithmetic is a test.
 *
 * ── AND THE PART A WIDTH CHECK CANNOT SEE ─────────────────────────────────
 * With the labels gone, colour would have been the only channel left
 * separating done from current from not-reached — WCAG 1.4.1, and unusable to
 * a colourblind Helpr glancing at a list. So each state differs in SHAPE too:
 * solid 16px / solid 20px with a ring / hollow with a border. Asserted on the
 * rendered DOM, because "we varied the size" is the sort of claim that
 * survives a refactor in a comment and nowhere else.
 *
 * @mutate src/components/activity/jobRailTone.ts | export const COMPACT_DOT_PX = 16; | export const COMPACT_DOT_PX = 28;
 * @mutate src/components/activity/jobRailTone.ts | export const COMPACT_CURRENT_DOT_PX = 20; | export const COMPACT_CURRENT_DOT_PX = 16;
 * @mutate src/components/activity/JobStepRailCompact.tsx | const hollow = paint.tone === "grey"; | const hollow = false;
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  COMPACT_CURRENT_DOT_PX,
  COMPACT_DOT_PX,
  COMPACT_GAP_PX,
  compactRailWidthPx,
} from "@/components/activity/jobRailTone";
import { JobStepRailCompact } from "@/components/activity/JobStepRailCompact";
import { railStepLabels } from "@/components/JobTracking";

/**
 * The card's inner width per viewport — the SAME measured numbers
 * `jobStepRowWidthFloor` uses, because it is the same `px-4` box inside the
 * same `JobCardShell`: the action row and this rail are siblings in it.
 */
const CARD_INNER_PX: Record<string, number> = { "320": 212, "375": 262, "1440": 1035 };

/** The full labelled rail's dot and gap, for the comparison that motivated this. */
const FULL_DOT_PX = 28;

describe("the compact rail fits the card it sits in", () => {
  const posterSteps = railStepLabels(true).length;
  const helperSteps = railStepLabels(false).length;

  it("the rails have steps to measure — inventory floor", () => {
    // Without this, every width assertion below is trivially true of zero dots.
    expect(helperSteps, "the helper rail has no steps").toBeGreaterThanOrEqual(7);
    expect(posterSteps, "the poster rail has no steps").toBeGreaterThan(helperSteps);
  });

  it("fits at 320, 375 and 1440 — on BOTH cards, with no scrolling region", () => {
    for (const [viewport, inner] of Object.entries(CARD_INNER_PX)) {
      for (const [side, steps] of [["Posts", posterSteps], ["Jobs", helperSteps]] as const) {
        const need = compactRailWidthPx(steps);
        expect(
          need,
          `${side} @${viewport}: the compact rail needs ${need}px in a ${inner}px card. ` +
            `A collapsed card must not contain a horizontally scrolling region — that is ` +
            `the whole reason the labelled rail could not stay.`,
        ).toBeLessThanOrEqual(inner);
      }
    }
  });

  it("the FULL rail genuinely did not fit at 320 — this is why it changed", () => {
    // The comparison the owner's decision rested on. If a future change makes
    // the full rail fit, the compact one has stopped being necessary and
    // somebody should be told rather than left guessing.
    const fullNeed = posterSteps * FULL_DOT_PX + (posterSteps - 1) * COMPACT_GAP_PX;
    expect(
      fullNeed,
      `the full ${posterSteps}-step rail now needs only ${fullNeed}px against a 212px card ` +
        `at 320 — it fits, so the premise for a second denser rail is gone`,
    ).toBeGreaterThan(CARD_INNER_PX["320"]);
  });

  it("the dots are the size the owner chose", () => {
    expect(COMPACT_DOT_PX, "owner, 2026-09-19: 16px dots").toBe(16);
    expect(
      COMPACT_CURRENT_DOT_PX,
      "the current dot must be LARGER than the others — size is one of the two non-colour " +
        "channels that distinguish it once the labels are gone",
    ).toBeGreaterThan(COMPACT_DOT_PX);
  });
});

describe("three states, distinguishable without labels and without colour", () => {
  function renderRail(displayIdx: number, jobStatus = "in_progress") {
    document.body.innerHTML = "";
    render(
      <JobStepRailCompact steps={railStepLabels(false)} displayIdx={displayIdx} jobStatus={jobStatus} />,
    );
    return [...document.querySelectorAll<HTMLElement>("[data-rail-dot]")];
  }

  it("done is SOLID, current is BIGGER and RINGED, to-come is HOLLOW", () => {
    const dots = renderRail(3);
    const done = dots[0];
    const current = dots[3];
    const toCome = dots[5];

    // SHAPE 1 — size. Reading the inline style, not the class.
    expect(current.style.width, "the current dot is not larger than a completed one").toBe(
      `${COMPACT_CURRENT_DOT_PX}px`,
    );
    expect(done.style.width).toBe(`${COMPACT_DOT_PX}px`);

    // SHAPE 2 — the ring, on the current dot only.
    expect(current.style.boxShadow, "the current dot has no ring").not.toBe("");
    expect(done.style.boxShadow, "a completed dot has grown a ring — two 'you are here' markers").toBe("");

    // SHAPE 3 — fill vs outline. This is the one that carries "not reached"
    // with no colour at all: a hollow ring against solid dots.
    expect(toCome.style.background, "a not-reached dot is filled — it reads as done in greyscale").toBe(
      "transparent",
    );
    expect(toCome.style.border, "a not-reached dot has no border, so it is invisible").not.toBe("");
    expect(done.style.background).not.toBe("transparent");
  });

  it("every dot is one of exactly three FORMS — so no two states look alike", () => {
    const dots = renderRail(3);
    const form = (d: HTMLElement) =>
      `${d.style.width}|${d.style.background === "transparent" ? "hollow" : "solid"}|${d.style.boxShadow ? "ring" : "flat"}`;
    const forms = new Set(dots.map(form));
    expect(
      forms.size,
      `the rail draws ${forms.size} distinct forms: ${[...forms].join(" , ")}. Three is the ` +
        `contract — done / current / to-come — and each must be told apart with no colour.`,
    ).toBe(3);
    // Exactly one "you are here".
    expect(dots.filter((d) => d.dataset.railCurrent === "true")).toHaveLength(1);
  });

  it("the dispute red and the working amber survive the compaction", () => {
    // Scope: density changed, the colour vocabulary did not. Both rails paint
    // from `railStepPaint`, so these are the same tones the full rail uses —
    // governed by src/test/alarmColourInvariant.test.ts.
    const disputed = renderRail(5, "disputed");
    expect(disputed.filter((d) => d.dataset.railDot === "alarm"), "no alarm dot on a disputed rail").toHaveLength(1);
    const live = renderRail(3, "in_progress");
    expect(live.filter((d) => d.dataset.railDot === "amber"), "no amber cursor on a live rail").toHaveLength(1);
    expect(live.filter((d) => d.dataset.railDot === "alarm"), "an alarm dot on a healthy rail").toHaveLength(0);
  });

  it("a finished rail is green end to end, with nothing left shouting", () => {
    const dots = renderRail(railStepLabels(false).length - 1, "completed");
    expect(dots.every((d) => d.dataset.railDot === "green"), dots.map((d) => d.dataset.railDot).join(",")).toBe(true);
  });

  it("the dots are decoration, not controls — no 16px tap targets", () => {
    // The whole collapsed card is one expand target; tapping the rail opens it
    // and reveals the full labelled rail with its tooltips. Eight 16px buttons
    // in a 212px row could not carry a 44px target anyway (WCAG 2.5.5).
    renderRail(3);
    expect(document.querySelectorAll("[data-job-rail-compact] button")).toHaveLength(0);
    expect(document.querySelectorAll("[data-job-rail-compact] a")).toHaveLength(0);
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-rail-dot]")].every((d) => d.getAttribute("aria-hidden") === "true"),
      "a rail dot is exposed to assistive tech — the rail speaks in one sentence instead",
    ).toBe(true);
  });
});
