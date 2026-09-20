import { describe, it, expect, vi, beforeAll } from "vitest";
import { act } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * EVERY CONTROL THE JOB STEP ROW DRAWS SHOWS ITS LABEL — AT 320, 375 AND 414.
 *
 * ── WHAT SHIPPED, MEASURED ON PROD 2026-09-19 ──────────────────────────────
 * The helper's `disputed` card, both engines:
 *
 *   width   non-primary labels          primary label
 *   1440    visible, 11px               visible
 *    414    SR-ONLY, clip:rect(0,0,0,0), 1×1   visible
 *    390 / 375 / 360 / 320   ditto      visible
 *
 * So on a phone that row was FOUR ANONYMOUS ICON SQUARES plus one two-line
 * green button — three visual treatments in the row the owner had twice asked
 * to have one. And the icons named nothing: a clock-with-arrow and a lifebuoy
 * are not words. The one-shape fix had landed at desktop widths only, and the
 * phone is the product.
 *
 * The allocator was making the wrong trade. It preferred MORE CHIPS, NO LABELS
 * over FEWER CHIPS, LABELS KEPT — while the `More` popover it already draws
 * rendered the very same "Message" chip with a readable 11px label at 320, in
 * 124px, next to a row that had given it 44px.
 *
 * ── WHY A GUARD ASSERTING "THE CHIP EXISTS" WOULD HAVE PASSED ──────────────
 * Every chip existed. Every chip had an accessible name. Nothing overflowed
 * the row. `jobRowControlSameness` compared the controls to each other and
 * they were identically stripped; `jobStepOneRow` asserted nothing landed
 * outside the row and nothing did. The thing that left was the PAINT of the
 * label, and no guard was looking at that. Three guards were bitten by this
 * exact class in one day.
 *
 * So this file asks the two questions that together mean "the label is on the
 * screen", and neither of them is "does the element exist":
 *
 *   1. CAN the stylesheet hide it? `src/index.css` is read off disk and every
 *      rule that reaches inside `[data-job-step-row]` is checked for the
 *      sr-only recipe (`clip: rect(0,0,0,0)` / a 1px box / `position:
 *      absolute` on a label). This is the literal rule that shipped.
 *   2. Is the chip WIDE ENOUGH for it? The allocation is computed for the real
 *      control inventory of every row state of BOTH cards, at every width, and
 *      every chip slot the row draws must be at least as wide as the widest
 *      label word among the chips that can be in it — with the ones that do
 *      not fit accounted for inside `More`, where they are labelled too.
 *
 * ── WHAT IT CANNOT CATCH ───────────────────────────────────────────────────
 * jsdom lays nothing out and resolves no font, so a rendered 1×1 box cannot be
 * read here and the label widths come from a stated character model
 * (`glyphPx`, in `./jobStepRowCases`). A font change that makes the real words
 * wider than the model, or a third file that hides the label with something
 * other than the sr-only recipe, needs the browser. That pass is what turns
 * ROW_PX's derived 414 into a measured number.
 */

// PROOF THIS GUARD CAN FAIL (npm run vacuity). All three mutations restore a
// state this app was actually in on prod this morning:
//   1. The sr-only rule itself, put back on the row's chips verbatim. Part 1
//      must go red — this is the declaration that shipped.
//   2. Sizing the tight rung's chips to the bare 44px tap floor instead of to
//      their own labels. That IS the icon-only row: 44px is under the 58px
//      "Evidence" needs, so part 2 must go red at 414 and below.
//   3. The shell marking the row with the old `data-compact` attribute, which
//      is what the deleted stylesheet rule hung off. Part 3 must go red.
// @mutate src/index.css |   flex: 0 1 var(--job-row-chip, 44px);\n} |   flex: 0 1 var(--job-row-chip, 44px);\n}\n[data-job-step-row][data-tight="true"] > :not([data-job-step-primary]) span {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  clip: rect(0, 0, 0, 0);\n}
// @mutate src/components/activity/jobStepRow.tsx | const chipPx = chipControlFloorPx(chipNeed); | const chipPx = ROW_CONTROL_MIN_PX;
// @mutate src/components/activity/JobStepCard.tsx | data-tight={layout.tight ? "true" : "false"} | data-compact={layout.tight ? "true" : "false"}
//   4. Severing the note portal — the question the visual pass asked when it
//      found `[data-job-step-note]` 0×0 on every card it opened. Part 4 must
//      go red: four states fill it today, and the guard must notice if none do.
// @mutate src/components/activity/jobStepRow.tsx | const host = slot === "primary" ? ctx.primaryHost : ctx.noteHost; | const host = slot === "primary" ? ctx.primaryHost : null;

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
  ROW_PX,
  TAP_TARGET_PX,
  controlNeedPx,
  prepareStepCardDom,
  readRow,
  stepFilesFromSource,
} from "./jobStepRowCases";
import {
  allocateJobStepRow,
  shouldTightenJobStepRow,
  partitionJobStepRowChips,
  chipControlFloorPx,
  JOB_STEP_ROW_GAP_PX,
  LABELLED_CHIP_MIN_PX,
} from "@/components/activity/jobStepRow";

const ROOT = resolve(__dirname, "../..");

beforeAll(prepareStepCardDom);

/** The phone widths the owner's report names, plus the desktop one that was
 *  already correct — so a "fix" that breaks 1440 to rescue 320 fails here. */
const PHONE_WIDTHS = ["320", "375", "414"] as const;

// ── PART 1: CAN THE STYLESHEET HIDE A LABEL AT ALL? ─────────────────────────

/** COMMENTS OUT FIRST. This file's own prose says the words "data-compact"
 *  and "clip: rect(0,0,0,0)" while explaining that neither ships any more, and
 *  a guard that reads a comment as a declaration is the exact inversion of the
 *  rule this repo keeps ("trust the CSS declaration, never the comment beside
 *  it"). A comment can also carry an unbalanced brace. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Split a CSS file into `{ selector, body }` at the top level. Crude, and
 *  deliberately so: it must see every rule, including inside `@media`, and
 *  the only thing it is asked is "what does this selector match and what does
 *  it declare". */
function cssRules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

/** The sr-only recipe, in any of the forms that hide a painted label. */
function hidesItsContent(body: string): string | null {
  const b = body.replace(/\s+/g, " ");
  if (/clip\s*:\s*rect\(\s*0[ ,]/.test(b)) return "clip: rect(0, 0, 0, …)";
  if (/clip-path\s*:\s*inset\(\s*(100%|50%)/.test(b)) return "clip-path: inset(100%)";
  if (/\bwidth\s*:\s*1px/.test(b) && /\bheight\s*:\s*1px/.test(b)) return "a 1×1 box";
  if (/\bdisplay\s*:\s*none/.test(b)) return "display: none";
  if (/\bvisibility\s*:\s*hidden/.test(b)) return "visibility: hidden";
  if (/\bfont-size\s*:\s*0\b/.test(b)) return "font-size: 0";
  if (/\bcolor\s*:\s*transparent/.test(b)) return "color: transparent";
  return null;
}

describe("no stylesheet rule can hide a job step row control's label", () => {
  const css = stripCssComments(readFileSync(join(ROOT, "src/index.css"), "utf8"));
  const rules = cssRules(css);

  it("the stylesheet was actually parsed, and the row's own rules are in it", () => {
    // The floor. A parser that found nothing would make the assertion below
    // vacuously true, which is precisely the class of mistake this row has
    // already shipped past.
    expect(rules.length, "src/index.css parsed to no rules at all").toBeGreaterThan(200);
    const rowRules = rules.filter((r) => r.selector.includes("data-job-step-row"));
    expect(
      rowRules.length,
      "no [data-job-step-row] rules found — the selector this guard hunts has been renamed",
    ).toBeGreaterThanOrEqual(4);
    // …and the tight rung is one of them, sized from the MEASURED label width
    // rather than a constant. A stylesheet cannot know how wide "Evidence" is.
    expect(
      rowRules.some((r) => /--job-row-chip/.test(r.body)),
      "the tight rung no longer sizes its chips from the measured --job-row-chip",
    ).toBe(true);
  });

  it("nothing under [data-job-step-row] makes a label invisible", () => {
    const offenders: string[] = [];
    for (const { selector, body } of rules) {
      if (!selector.includes("data-job-step-row")) continue;
      // A slot with NOTHING IN IT is allowed to disappear: there is no label
      // to hide. `[data-empty="true"]` is the whole row when the step drew no
      // controls; `:empty` is the primary host when nothing portalled into it.
      // Both are "there is no control here", never "the control is here and
      // you cannot read it".
      if (/\[data-empty="true"\]/.test(selector) || /:empty\b/.test(selector)) continue;
      const how = hidesItsContent(body);
      if (how) {
        offenders.push(
          `${selector} { … } hides its content with ${how}.\n` +
            `      Owner, 2026-09-19, second phone report: every control in this row keeps its ` +
            `VISIBLE label at every width. A chip that cannot show its label leaves the row ` +
            `(allocateJobStepRow) — it does not stay and go anonymous.`,
        );
      }
    }
    expect(offenders, `\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("the shell marks the row TIGHT, and the icon-only attribute is gone from the tree", () => {
    // `data-compact` is the attribute the deleted rule hung off. If it comes
    // back in the shell, the rule has somewhere to land again.
    const shell = readFileSync(join(ROOT, "src/components/activity/JobStepCard.tsx"), "utf8");
    expect(shell, "the shell no longer marks its row tight").toMatch(/data-tight=\{/);
    expect(
      /data-compact/.test(shell),
      "`data-compact` is back on the job step row — that is the hook the sr-only label rule used",
    ).toBe(false);
    expect(
      /data-compact/.test(css),
      "`data-compact` is back in index.css — the icon-only rung has a selector again",
    ).toBe(false);
  });
});

// ── PART 2: IS EVERY CHIP THE ROW DRAWS WIDE ENOUGH FOR ITS OWN LABEL? ──────

describe("every chip the row draws is wide enough to show its label", () => {
  it("the inventory covers both cards, and every step file is represented", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(13);
    expect(CASES.filter((c) => c.side === "helper").length).toBeGreaterThanOrEqual(5);
    expect(CASES.filter((c) => c.side === "poster").length).toBeGreaterThanOrEqual(5);
    // COMPLETENESS, from the world rather than from this file: every step file
    // that draws a JobStepCard is scanned out of the tree, and both sides must
    // be present in it. A new step whose row nothing here exercises shows up
    // as a side with no cases rather than as silence.
    const steps = stepFilesFromSource();
    expect(steps.helper.length, "no helper step files found — the source scan has drifted").toBeGreaterThan(1);
    expect(steps.poster.length, "no poster step files found — the source scan has drifted").toBeGreaterThan(2);
    // The widths the owner's report names, all present.
    for (const w of PHONE_WIDTHS) expect(ROW_PX[w], `${w} is not in ROW_PX`).toBeGreaterThan(0);
  });

  for (const c of CASES) {
    it(`${c.side} · ${c.name}`, async () => {
      const { container } = c.render();
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      const inv = readRow(container);
      expect(
        container.querySelector("[data-job-step-row]"),
        "this state renders no job step row",
      ).not.toBeNull();

      // EVERY CONTROL HAS A VISIBLE LABEL IN THE DOM. Not an aria-label — the
      // painted text. Without this the width assertions below are about
      // nothing: a chip with no visible label needs no width to show one.
      for (const l of [...inv.chipLabels, ...inv.primaryLabels]) {
        expect(l.length, "a control in this row has no VISIBLE label, only a spoken name").toBeGreaterThan(0);
      }

      const chips = inv.chipLabels.length;
      const primaryNeeds = inv.primaryLabels.map(controlNeedPx);
      // The widest label WORD across the step's chips — the number the tight
      // rung sizes every chip to, because the chips are equal flex children.
      const chipNeed = chips ? Math.max(...inv.chipLabels.map(controlNeedPx)) : LABELLED_CHIP_MIN_PX;
      // `More` is a chip like any other and its own label has to fit too.
      const moreNeed = controlNeedPx("More");

      for (const w of [...PHONE_WIDTHS, "1440"]) {
        const width = ROW_PX[w];
        const where = `${c.side}:${c.name} @${w} (row ${width}px)`;
        const tight = shouldTightenJobStepRow({
          width,
          chips,
          hasPrimary: primaryNeeds.length > 0,
          chipNeedPx: chipNeed,
          primaryNeedPx: inv.primaryLabels.reduce(
            (sum, l, i) => sum + controlNeedPx(l) + (i ? JOB_STEP_ROW_GAP_PX : 0),
            0,
          ),
        });
        const alloc = allocateJobStepRow({ width, chips, tight, primaryNeeds, chipNeed });

        if (chips === 0) continue;

        // 1. THE ASSERTION THAT SHIPPED BROKEN. Every chip slot the row draws
        //    is at least as wide as the widest label word it may hold. At
        //    44px — the old icon-only chip — this fails on "Evidence" (58px),
        //    "Message" (57px), "Escalate" (55px) and "Directions" (62px).
        const floor = Math.max(TAP_TARGET_PX, chipNeed, moreNeed);
        expect(
          Math.round(alloc.chipPx * 10) / 10,
          `${where}: a chip gets ${alloc.chipPx.toFixed(1)}px and its widest label word needs ` +
            `${floor.toFixed(1)}px. A chip that cannot show its label must LEAVE THE ROW ` +
            `(into More), not stay and go anonymous. ` +
            `[${inv.chipLabels.join(" | ")}] tight=${tight}, ${alloc.chipSlots} slots drawn`,
        ).toBeGreaterThanOrEqual(floor);

        // 2. …and the module agrees with the arithmetic written here.
        expect(chipControlFloorPx(chipNeed)).toBe(Math.max(TAP_TARGET_PX, chipNeed));

        // 3. NOTHING IS LOST. Every chip is either in the row or in `More`,
        //    and `More` is only drawn when it holds something.
        const { lead, overflow, trail } = partitionJobStepRowChips(
          inv.chipLabels,
          alloc.overflowChips > 0 ? alloc.visibleChips : chips,
        );
        expect(
          [...lead, ...overflow, ...trail].length,
          `${where}: chips went missing between the allocation and the partition`,
        ).toBe(chips);
        expect(overflow.length, `${where}: More holds a different number than allocated`).toBe(
          alloc.overflowChips,
        );
        expect(
          lead.length + trail.length + (overflow.length ? 1 : 0),
          `${where}: the drawn slots disagree with the allocation`,
        ).toBe(alloc.chipSlots);

        // 4. …and there is somewhere for them to go. A row with chips but no
        //    chip slot would make the overflowed controls unreachable.
        expect(alloc.chipSlots, `${where}: the row draws no chip slot at all`).toBeGreaterThanOrEqual(1);

        // 5. IT ALL FITS. The row never wraps, so anything over its width is a
        //    control painting outside the card.
        const used =
          alloc.chipSlots * alloc.chipPx +
          alloc.primaryPx +
          JOB_STEP_ROW_GAP_PX * Math.max(0, alloc.chipSlots + (primaryNeeds.length ? 1 : 0) - 1);
        expect(
          Math.round(used * 10) / 10,
          `${where}: the row lays out ${used.toFixed(1)}px of controls in ${width}px`,
        ).toBeLessThanOrEqual(width + 0.5);
      }
    });
  }
});

// ── PART 3: THE PHONE IS THE PRODUCT ───────────────────────────────────────

describe("the phone widths get the same treatment as 1440, not a lesser one", () => {
  /** The two rows the owner photographed, as the allocator sees them. */
  const DISPUTED = {
    poster: { chips: ["Escalate", "Photos", "Timeline & Evidence", "Message", "Contact Admin"], primary: "Resolve & Pay" },
    helper: { chips: ["Contact Admin", "Message", "Timeline & Evidence", "Before Photo"], primary: "Respond to Dispute" },
  };

  for (const [side, row] of Object.entries(DISPUTED)) {
    it(`${side} disputed: every chip drawn at 320/375/414 shows its label`, () => {
      const chipNeed = Math.max(...row.chips.map(controlNeedPx));
      const primaryNeeds = [controlNeedPx(row.primary)];
      for (const w of PHONE_WIDTHS) {
        const width = ROW_PX[w];
        const alloc = allocateJobStepRow({
          width,
          chips: row.chips.length,
          tight: true,
          primaryNeeds,
          chipNeed,
        });
        expect(
          alloc.chipPx,
          `${side} @${w}: chips get ${alloc.chipPx}px, under the ${chipNeed.toFixed(1)}px ` +
            `"${row.chips.reduce((a, b) => (controlNeedPx(b) > controlNeedPx(a) ? b : a))}" needs`,
        ).toBeGreaterThanOrEqual(chipNeed);
        // …and the primary is not paid for out of the chips' labels: it clears
        // its own longest word too.
        expect(alloc.perPrimaryPx, `${side} @${w}: the primary is under its own word`).toBeGreaterThanOrEqual(
          primaryNeeds[0],
        );
        // …and at least one chip is still ON the row beside More: a row that
        // collapsed to nothing but `More` would pass every width assertion
        // above while showing the reader no action at all.
        expect(alloc.chipSlots, `${side} @${w}: the row drew no chip slot`).toBeGreaterThanOrEqual(1);
      }
    });
  }

  it("1440 stays roomy: all five poster chips in the row, none in More", () => {
    const row = DISPUTED.poster;
    const chipNeed = Math.max(...row.chips.map(controlNeedPx));
    const tight = shouldTightenJobStepRow({
      width: ROW_PX["1440"],
      chips: row.chips.length,
      hasPrimary: true,
      chipNeedPx: chipNeed,
      primaryNeedPx: controlNeedPx(row.primary),
    });
    expect(tight, "1440 should not need the tight rung at all").toBe(false);
    const alloc = allocateJobStepRow({
      width: ROW_PX["1440"],
      chips: row.chips.length,
      tight,
      primaryNeeds: [controlNeedPx(row.primary)],
      chipNeed,
    });
    expect(alloc.overflowChips).toBe(0);
    expect(alloc.chipPx).toBeGreaterThanOrEqual(chipNeed);
  });
});

// ── PART 4: THE CENTRED REASON LINE UNDER THE ROW ──────────────────────────

/**
 * A visual pass on prod found `[data-job-step-note]` EMPTY — 0×0 — on every
 * card it opened, and asked whether the 2026-09-19 move (the line went from
 * above the row to centred below it) had broken the wiring.
 *
 * It had not, and this is the record of that rather than an assertion in a
 * report. The host carries `empty:hidden`, so a state with no gate and no
 * consequence collapses it to nothing — which is what a reader should see —
 * and the pass had opened `disputed`, `completed` and `open`, three states
 * that have neither. Four states DO fill it, and this drives all sixteen so
 * the number cannot quietly fall to zero.
 *
 * `src/test/jobStepReasonBelowRow.test.tsx` owns the placement rule (below the
 * row, centred by the host, at most one line). This owns the REACHABILITY: is
 * there any state left that can put a line in it at all.
 */
describe("the centred explanation line under the row is wired, and reachable", () => {
  it("every producer in the source is a `slot=\"note\"` portal, and there are several", () => {
    // INVENTORY FROM THE WORLD: every file that portals into the note host,
    // scanned out of the tree rather than listed here. A producer that is
    // deleted or renamed changes this number.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(full) && !full.includes(".test.")) files.push(full);
      }
    };
    walk(join(ROOT, "src"));
    const producers = files.filter((f) => /<JobStepRowSlot\s+slot="note"/.test(readFileSync(f, "utf8")));
    expect(
      producers.length,
      "nothing portals into [data-job-step-note] any more — the reason line has no source",
    ).toBeGreaterThanOrEqual(4);
  });

  it("the host is on every card, and at least four states actually fill it", async () => {
    let hosts = 0;
    let filled = 0;
    const filledNames: string[] = [];
    for (const c of CASES) {
      const { container } = c.render();
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });
      const host = container.querySelector("[data-job-step-note]");
      if (host) hosts++;
      const text = (host?.textContent ?? "").trim();
      if (text) {
        filled++;
        filledNames.push(`${c.side}:${c.name}`);
        // …and it is centred BY THE HOST, not by whoever portalled into it —
        // one alignment for the set (JobStepCard).
        expect(host!.className, "the note host stopped centring its line").toContain("text-center");
      }
    }
    expect(hosts, "some step card renders no note host at all").toBe(CASES.length);
    expect(
      filled,
      `only ${filled} of ${CASES.length} states put a line under the row — the portals have come ` +
        `unwired. Filled: [${filledNames.join(" | ")}]`,
    ).toBeGreaterThanOrEqual(4);
  }, 30_000);
});
