/**
 * EVERY WAY OUT OF A SURFACE LOOKS THE SAME.
 *
 * Owner, 2026-09-19, twice — and the second time is the one that matters:
 *   "you need to thoroughly check back buttons bc some have a square
 *    background on hover, some circle on hover and some move on hover, this
 *    needs to be consistent. fix it or i wont say it again."
 *
 * Three behaviours named, for one gesture. All three were real, and all three
 * were reproducible from source on the day this guard was written:
 *
 *   SQUARE   `<Button variant="ghost">` inherits `rounded-ds-md` from
 *            `buttonVariants`, and `ghost` IS `.ctl-tint` — so ChatHeader's
 *            back chevron, DialogContent's ×, SheetContent's × and five others
 *            paint a rounded SQUARE of olivewood wash on hover.
 *   CIRCLE   `BackButton` and 14 others are `rounded-full`, so the same wash
 *            lands as a disc.
 *   MOVE     DialogContent's × carries `group-hover:-translate-y-0.5` (added
 *            2026-08-30 to "make x do the same globally" — it made it the same
 *            as three other chrome icons and different from every other way
 *            out) and PhotoLightbox's close carries `hover:scale-105`.
 *
 * ─── WHAT THIS GUARD OWNS, AND WHAT IT DELIBERATELY DOES NOT ───────────────
 *
 * `src/test/controlInteractionSameness.test.ts` already polices the hover
 * TREATMENT of all ~308 controls: which tone, no shadow, no ad-hoc tint, one
 * press, one ring. It cannot see the two properties the owner actually named,
 * because they are not what it matches on:
 *
 *   SHAPE   the radius of the box the tint is painted into.
 *   MOTION  a transform on the GLYPH. That guard explicitly ALLOWS a glyph to
 *           slide inside a still control (the `group-hover:translate-x-*`
 *           arrows) — correctly, for a row whose arrow is a flourish beside a
 *           label. On a bare-glyph exit control the glyph IS the control's
 *           entire visible body, so the same rule reads as the target moving.
 *           That exemption is exactly the hole the dialog × fell through.
 *
 * So this guard owns SHAPE, MOTION, and "a hover treatment exists at all".
 * WHICH tone stays with the other guard; there is no overlap and this file
 * keeps no ledger of its own.
 *
 * ─── SHAPE: WHY THE CIRCLE, ON EVIDENCE ────────────────────────────────────
 *
 * Counted from the inventory below, not chosen by taste: 18 of 29 bare-glyph
 * exits were already round (15 written `rounded-full`, 3 more delegating to
 * `BackButton`, which is), against 9 square-ish and 2 that painted no box at
 * all. Majority rules, and the exception to majority rule does not apply —
 * the shape the owner named as wrong is the square, which is the minority.
 * So: circle, and the 11 that are not become one.
 *
 * ─── THE INVENTORY IS DERIVED FROM THE WORLD ───────────────────────────────
 *
 * `scripts/back-control-inventory.mjs` finds these controls by what they ARE
 * — a control that leaves the surface — never by a list of files. This file
 * imports that scanner and does not restate its output, so the guard cannot
 * end up comparing a list to itself. Comments are stripped before scanning,
 * in both directions: a guard satisfiable OR breakable by the prose explaining
 * it is not checking anything.
 *
 * @mutate src/components/BackButton.tsx | BACK_BUTTON_BOX_CLASS} ctl-exit flex | BACK_BUTTON_BOX_CLASS} rounded-md flex
 * @mutate src/components/ui/dialog.tsx | flex items-center justify-center text-muted-foreground | flex items-center justify-center text-muted-foreground hover:-translate-y-px
 */
import { describe, expect, it } from "vitest";
import { inventory } from "../../scripts/back-control-inventory.mjs";

const { controls } = inventory("src");

/** Bare-glyph chrome — the controls the shape rule is about. */
const icons = controls.filter((c) => c.kind === "icon");
/** A `<BackButton>` call site paints nothing itself; the primitive does. */
const own = icons.filter((c) => c.what !== "<BackButton>");
const delegates = icons.filter((c) => c.what === "<BackButton>");
/**
 * Word-bearing exits — a footer "Cancel", "Go Back" on /404. Inventoried for
 * completeness and deliberately NOT subject to the shape rule: a rounded-full
 * text button is a pill, which is a different component. Their look belongs to
 * `buttonVariants` and to the popup-footer contract.
 */
const labelled = controls.filter((c) => c.kind === "labelled");

/** The ONE shape token. Defined once, in src/index.css. */
const SHAPE = "ctl-exit";
/**
 * Any radius utility beside it — INCLUDING `rounded-full`, which resolves to
 * the same 9999px. That is not pedantry: `rounded-full` repeated at 26 sites
 * is 26 independent decisions that happen to agree, which is exactly the
 * state this report came out of. One spelling, one place.
 */
const COMPETING_RADIUS = /^rounded(?:-.+)?$/;

const at = (c: { file: string; line: number; label: string }) =>
  `${c.file}:${c.line}${c.label ? ` (${c.label})` : ""}`;

describe("every way out of a surface looks the same", () => {
  it("has a real inventory to check", () => {
    // FLOORS, not decoration. Every assertion below is per-member, so a
    // scanner that silently stopped matching would make all of them pass
    // vacuously — the exact failure mode CLAUDE.md calls out. Measured
    // 2026-09-19: 99 exit controls across 84 files — 29 bare-glyph (26 that
    // paint their own box + 3 delegating to BackButton) and 70 labelled.
    expect(controls.length).toBeGreaterThanOrEqual(95);
    expect(icons.length).toBeGreaterThanOrEqual(28);
    expect(own.length).toBeGreaterThanOrEqual(25);
    expect(labelled.length).toBeGreaterThanOrEqual(65);
    expect(new Set(controls.map((c) => c.file)).size).toBeGreaterThanOrEqual(80);
    // Both arms of the scan really reach the surfaces that matter: the page
    // back button, the two popup primitives, and the one non-PageHeader
    // header that draws its own back chevron. If a regex drifts, this is
    // what says so instead of the suite going quietly green.
    const files = new Set(controls.map((c) => c.file));
    for (const f of [
      "src/components/BackButton.tsx",
      "src/components/ui/dialog.tsx",
      "src/components/ui/sheet.tsx",
      "src/components/messages/ChatHeader.tsx",
      "src/components/PageHeader.tsx",
    ])
      expect(files, `${f} dropped out of the back-control inventory`).toContain(f);
    // And the `<BackButton>` delegate arm is alive — those are the call sites
    // that inherit the shape rather than restating it.
    expect(delegates.length).toBeGreaterThanOrEqual(3);
  });

  it("wears the one exit shape", () => {
    const bad = own.filter((c) => !c.radii.includes(SHAPE)).map(at);
    expect(
      bad,
      `a control that leaves a surface is a circle: add .${SHAPE} (src/index.css), which is the one place that shape is declared`,
    ).toEqual([]);
  });

  it("states no second, competing radius", () => {
    const bad = own
      .filter((c) => c.radii.some((r: string) => COMPETING_RADIUS.test(r)))
      .map((c) => `${at(c)} ${c.radii.join(" ")}`);
    expect(
      bad,
      "a square radius beside .ctl-exit is the drift itself — remove it, do not layer over it",
    ).toEqual([]);
  });

  it("never moves out from under the cursor on hover", () => {
    // Deliberately includes `group-hover:` on the GLYPH. On a bare-glyph exit
    // the glyph is the whole visible control, so the distinction the general
    // interaction guard draws does not exist here.
    const bad = icons
      .filter((c) => c.hoverMove.length)
      .map((c) => `${at(c)} ${c.hoverMove.join(" ")}`);
    expect(
      bad,
      "the way out of a surface holds still; it tints and nothing else",
    ).toEqual([]);
  });

  it("gives the pointer a hover treatment at all", () => {
    // The fourth behaviour, unnamed by the owner only because it is the
    // absence of one: a back control whose hit area paints nothing on hover
    // sits beside one that paints a disc, and reads as a different kind of
    // control. WHICH tone is controlInteractionSameness's business; that
    // there IS one is this guard's.
    const bad = own.filter((c) => !c.tones.length && !c.hoverBg.length).map(at);
    expect(
      bad,
      "no hover feedback is its own inconsistency — carry a .ctl-tint* tone",
    ).toEqual([]);
  });
});
