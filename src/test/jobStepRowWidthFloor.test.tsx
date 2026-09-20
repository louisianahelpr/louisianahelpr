import { describe, it, expect, vi, beforeAll } from "vitest";
import { act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * NO CONTROL IN A JOB STEP ROW IS NARROWER THAN ITS OWN LABEL — AT 320.
 *
 * ── WHAT SHIPPED, AND WHY EVERY GREEN GUARD MISSED IT ──────────────────────
 * Measured on PROD on 2026-09-19 at 320px, in Chromium and WebKit identically
 * (so it is layout arithmetic, not an engine bug):
 *
 *   helper `disputed`  "Withdraw Dispute"  w=12px, 43px of label on the card
 *   poster `disputed`  "Resolve & Pay"     w=12px, 31px of label on the card
 *
 * The second one releases escrow.
 *
 * Every existing guard on this row measures something other than WIDTH:
 * `jobRowControlSameness` compares the controls' type/stack/radius tokens to
 * each other (they were identically wrong), `jobStepOneRow` asserts nothing
 * lands outside the row (nothing did — the LABEL left, not the control),
 * `index.css` floors `min-height: 44px` and floors nothing on width, and the
 * one arithmetic test that existed asserted `primaryRoomAfterTightening` from
 * a row width of 256px that was stated in a comment and never measured. The
 * row is 212px. That is the whole bug: a wrong number in a doc block, checked
 * against itself.
 *
 * ── THIS IS A MATHS CHECK, AND HERE IS WHAT IT THEREFORE CANNOT CATCH ──────
 * jsdom lays nothing out: `getBoundingClientRect()` is 0 for every element and
 * `getComputedStyle` resolves no font, so the shell's real measurement path
 * (`longestWordPx`, an off-screen probe span) returns 0 here and a rendered
 * width cannot be read at all. So this guard asserts the ALLOCATION — the
 * exported `allocateJobStepRow` / `primaryRoomAfterTightening` arithmetic the
 * shell and `index.css` between them carry out — against:
 *
 *   • the real control INVENTORY of every row state, taken from an actual
 *     render of both cards (how many chips, how many controls in the primary
 *     slot, and each one's visible label);
 *   • the three row widths MEASURED on prod (see ROW_PX);
 *   • a stated character model for 11px label type (see glyphPx).
 *
 * It therefore CANNOT catch: a font change that makes the real words wider
 * than the model; a CSS change that stops `index.css` implementing this
 * arithmetic (the flex bases, the gap, the compact rung); a control whose
 * label is set from data rather than a literal; or anything about how the row
 * LOOKS. Those need the browser. What it does catch is the class that shipped:
 * a row asked to hold more controls than its width can hold, resolving that by
 * making one of them too small to read.
 *
 * Both sides are exercised, deliberately. A sibling defect shipped the same
 * week because a guard drove the helper's card and not the poster's, and the
 * poster's is where the money control lives.
 */

// PROOF THIS GUARD CAN FAIL (npm run vacuity). Both mutations restore a state
// this app has actually been in, and neither is satisfiable by a comment:
//   1. `if (false)` is EXACTLY the shipped behaviour — the row renders every
//      chip the step asked for, whatever the width, which is what put a 12px
//      primary on prod. The guard must go red on the disputed rows at 320.
//   2. 12px is the width that shipped; dropping the tap floor to it makes the
//      allocator hand out slivers again.
// @mutate src/components/activity/jobStepRow.tsx | if (chips > capacity) { | if (false) {
// @mutate src/components/activity/jobStepRow.tsx | export const ROW_CONTROL_MIN_PX = 44; | export const ROW_CONTROL_MIN_PX = 12;
//   3. Sizing the tight rung's chips to the bare tap floor instead of to their
//      own labels IS the shipped icon-only row — 44px chips whose labels were
//      then clipped away. The guard must go red on the disputed rows at 414
//      and below.
// @mutate src/components/activity/jobStepRow.tsx | const chipPx = chipControlFloorPx(chipNeed); | const chipPx = ROW_CONTROL_MIN_PX;

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
vi.mock("@/components/PhotoProof", async (orig) => {
  const actual = await orig<typeof import("@/components/PhotoProof")>();
  return {
    ...actual,
    PhotoProofGroup: () => <div data-testid="photo-proof" />,
    PhotoProofStep: ({ title }: { title: string }) => <div data-testid="photo-proof-step">{title}</div>,
    PhotoProofDialog: () => null,
    PhotoProofRequirementNote: () => null,
  };
});

function makeSupabase() {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  const methods = [
    "from", "select", "eq", "neq", "in", "order", "limit", "insert", "update",
    "upsert", "delete", "gte", "lte", "is", "not", "filter",
  ];
  for (const m of methods) chain[m] = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (res: (v: typeof result) => unknown) => Promise.resolve(result).then(res);
  return {
    supabase: {
      ...chain,
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(result)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
      storage: { from: vi.fn(() => ({ upload: vi.fn(), getPublicUrl: vi.fn(() => ({ data: { publicUrl: "" } })) })) },
    },
  };
}
vi.mock("@/integrations/supabase/client", () => makeSupabase());

import {
  CASES,
  DERIVED_WIDTHS,
  ROW_PX,
  TAP_TARGET_PX,
  controlNeedPx,
  glyphPx,
  prepareStepCardDom,
  readRow,
  stepFilesFromSource,
  type RowInventory,
} from "./jobStepRowCases";
import {
  allocateJobStepRow,
  shouldTightenJobStepRow,
  primaryControlFloorPx,
  ROW_CONTROL_MIN_PX,
  JOB_STEP_ROW_GAP_PX,
  LABELLED_CHIP_MIN_PX,
} from "@/components/activity/jobStepRow";

const ROOT = resolve(__dirname, "../..");

beforeAll(prepareStepCardDom);

// ── THE GUARD ───────────────────────────────────────────────────────────────

describe("every control in a job step row is at least as wide as its own label", () => {
  it("the inventory is not empty, and it has BOTH sides", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(13);
    expect(CASES.filter((c) => c.side === "helper").length).toBeGreaterThanOrEqual(5);
    expect(CASES.filter((c) => c.side === "poster").length).toBeGreaterThanOrEqual(5);
    // …and the widest rows, which are where a shape that works at 3-up falls
    // over. One on each side: the helper's disputed row with the evidence
    // capture, and the poster's disputed row whose primary releases escrow.
    expect(CASES.filter((c) => c.minControls >= 5).length).toBeGreaterThanOrEqual(2);

    const steps = stepFilesFromSource();
    expect(steps.helper.length, "no helper step files found — the source scan has drifted").toBeGreaterThan(1);
    expect(steps.poster.length, "no poster step files found — the source scan has drifted").toBeGreaterThan(2);
    expect(Object.keys(ROW_PX).length).toBe(4);
    expect([...DERIVED_WIDTHS].every((w) => w in ROW_PX), "a derived width is not in ROW_PX").toBe(true);
  });

  it("the 44px floor is the app's own, and the row module has not quietly lowered it", () => {
    // THE EXTERNAL WITNESS. `index.css` floors every button's HEIGHT at 44px
    // (Apple HIG 44pt) and floors nothing on the width — the hole this guard
    // exists for. Read off disk rather than imported, so the row module cannot
    // move the number and take this file's assertions with it.
    const css = readFileSync(join(ROOT, "src/index.css"), "utf8");
    const heightFloors = [...css.matchAll(/min-height:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(heightFloors.length, "index.css declares no min-height floor at all").toBeGreaterThan(0);
    expect(heightFloors, "index.css no longer floors a control at 44px").toContain(TAP_TARGET_PX);
    // …and the same 44 is now floored on WIDTH, which is what shipped missing.
    const widthFloors = [...css.matchAll(/min-width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(widthFloors, "index.css floors no control WIDTH — the 12px hole is open again").toContain(TAP_TARGET_PX);
    // The row's own constant must BE that number, not merely be consulted.
    expect(ROW_CONTROL_MIN_PX, "the row module lowered the tap target").toBe(TAP_TARGET_PX);
  });

  /** Everything this guard asserts about one state at one width. */
  function check(where: string, inv: RowInventory, width: number) {
    const chips = inv.chipLabels.length;
    const primaryNeeds = inv.primaryLabels.map(controlNeedPx);
    const chipNeed = chips
      ? Math.max(...inv.chipLabels.map(controlNeedPx))
      : LABELLED_CHIP_MIN_PX;
    const tight = shouldTightenJobStepRow({
      width,
      chips,
      hasPrimary: primaryNeeds.length > 0,
      chipNeedPx: chipNeed,
      // The compaction decision uses the SOFTER two-line need; approximate it
      // the way the shell does — the whole label over two lines, never below
      // its longest word.
      primaryNeedPx: inv.primaryLabels.reduce(
        (sum, l, i) =>
          sum +
          Math.max(controlNeedPx(l), [...l].reduce((a, ch) => a + glyphPx(ch), 0) / 2 + 24) +
          (i ? JOB_STEP_ROW_GAP_PX : 0),
        0,
      ),
    });
    const alloc = allocateJobStepRow({ width, chips, tight, primaryNeeds, chipNeed });

    // 1. NOTHING IS LOST. Every chip the step asked for is either in the row
    //    or in the overflow control.
    expect(
      alloc.visibleChips + alloc.overflowChips,
      `${where}: chips went missing (${alloc.visibleChips} shown + ${alloc.overflowChips} overflowed ≠ ${chips} asked for)`,
    ).toBe(chips);

    // 2. THE ROW IS NEVER DEGENERATE. If the step wants chips, at least one
    //    chip slot is drawn — an overflow control with nowhere to live would
    //    make its contents unreachable.
    if (chips > 0) {
      expect(alloc.chipSlots, `${where}: the row has no room for even one chip slot`).toBeGreaterThanOrEqual(1);
    }

    // 3. EVERY CHIP CLEARS THE TAP TARGET **AND ITS OWN LABEL**, IN WIDTH.
    //    The second half is the 2026-09-19 rule change: a chip that cannot
    //    show its label leaves the row (it used to stay and go icon-only), so
    //    every chip slot the row DRAWS is at least as wide as the widest label
    //    word among the chips that could be in it.
    if (alloc.chipSlots > 0) {
      expect(
        Math.round(alloc.chipPx * 10) / 10,
        `${where}: chips get ${alloc.chipPx.toFixed(1)}px, under the ${TAP_TARGET_PX}px tap target`,
      ).toBeGreaterThanOrEqual(TAP_TARGET_PX);
      const labelFloor = Math.max(TAP_TARGET_PX, chipNeed);
      expect(
        Math.round(alloc.chipPx * 10) / 10,
        `${where}: chips get ${alloc.chipPx.toFixed(1)}px but the widest chip label word needs ` +
          `${labelFloor.toFixed(1)}px — a chip in this row cannot show its label ` +
          `(${alloc.chipSlots} slots drawn, tight=${tight})`,
      ).toBeGreaterThanOrEqual(labelFloor);
    }

    // 4. EVERY CONTROL IN THE PRIMARY SLOT CLEARS THE TAP TARGET **AND** ITS
    //    OWN LONGEST WORD. This is the assertion that shipped 12px.
    for (const label of inv.primaryLabels) {
      // `Math.max` with the LOCAL 44, not just whatever `primaryControlFloorPx`
      // decides — see TAP_TARGET_PX for why the oracle is not imported.
      const floor = Math.max(TAP_TARGET_PX, primaryControlFloorPx(controlNeedPx(label)));
      expect(
        Math.round(alloc.perPrimaryPx * 10) / 10,
        `${where}: "${label}" gets ${alloc.perPrimaryPx.toFixed(1)}px but needs ${floor.toFixed(1)}px ` +
          `(row ${width}px, ${chips} chips asked for, ${alloc.chipSlots} chip slots drawn, tight=${tight})`,
      ).toBeGreaterThanOrEqual(floor);
    }

    // 5. AND IT ALL FITS — the row never wraps, so anything over the row's
    //    width is a control painting outside the card.
    const used =
      alloc.chipSlots * alloc.chipPx +
      alloc.primaryPx +
      JOB_STEP_ROW_GAP_PX * Math.max(0, alloc.chipSlots + (primaryNeeds.length ? 1 : 0) - 1);
    expect(
      Math.round(used * 10) / 10,
      `${where}: the row lays out ${used.toFixed(1)}px of controls in ${width}px`,
    ).toBeLessThanOrEqual(width + 0.5);
  }

  for (const c of CASES) {
    it(`${c.side} · ${c.name}`, async () => {
      const { container } = c.render();
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      const row = container.querySelector("[data-job-step-row]");
      expect(row, "this state renders no job step row").not.toBeNull();
      // The card says whose it is, so a case cannot quietly drift to the other
      // side of the marketplace and still look covered.
      expect(
        container.querySelector("[data-job-step]")?.getAttribute("data-job-step") ?? "",
        "this row is not on the side the case claims",
      ).toMatch(new RegExp(`^${c.side}:`));

      const inv = readRow(container);
      const controls = inv.chipLabels.length + inv.primaryLabels.length;
      expect(
        controls,
        `expected at least ${c.minControls} controls, got [${[...inv.chipLabels, ...inv.primaryLabels].join(" | ")}]`,
      ).toBeGreaterThanOrEqual(c.minControls);
      // Every control has a readable label, or "its longest word" is vacuous.
      for (const l of [...inv.chipLabels, ...inv.primaryLabels]) {
        expect(l.length, `a control in this row has no visible label`).toBeGreaterThan(0);
      }

      for (const [w, rowPx] of Object.entries(ROW_PX)) {
        check(`${c.side}:${c.name} @${w}`, inv, rowPx);
      }
    });
  }
});
