// @mutate scripts/audit/press-every-control.mjs |   ...GATE_SKIPS, |
/**
 * CLASS GUARD: every reason press-every-control can give for NOT pressing a
 * control is in its documented-skip vocabulary.
 *
 * The coverage gate fails on any skip whose reason is not in DOCUMENTED_SKIPS.
 * Run 36069319716 (2026-09-24) failed with 14 + 90 + 19 + 10 = 133 controls
 * "unpressed without a documented reason". Every skip reason the harness emits
 * is either a literal `skip("…")`, a `*_SKIP` constant, or a string returned by
 * `mutationGate` (the `SKIP_*` exports of pressProdSafety.mjs). All of them
 * were in the vocabulary except `SKIP_ACCOUNT_SETTING` ("flips a setting on a
 * SHARED test account"), so every one of those 133 carried that reason: the
 * switches on /profile?tab=notifications, availability, accessibility and the
 * rest, correctly left alone and then counted as undocumented.
 *
 * The vocabulary now reads the gate's reasons from the module, and this test
 * inventories every reason source so the next new reason cannot miss it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";
import * as failureClass from "../../scripts/audit/pressFailureClass.mjs";

const ROOT = resolve(__dirname, "..", "..");
const documented = harness.DOCUMENTED_SKIPS as Set<string>;

describe("press-every-control skip vocabulary", () => {
  it("every reason mutationGate can return (each SKIP_* export) is documented", () => {
    const gate = Object.entries(safety as Record<string, unknown>).filter(([k]) => k.startsWith("SKIP_"));
    expect(gate.length).toBeGreaterThanOrEqual(8);
    const missing = gate.filter(([, v]) => !documented.has(v as string)).map(([k]) => k);
    expect(missing).toEqual([]);
  });

  it("the shared-account-setting reason in particular (run 36069319716's 133)", () => {
    expect(documented.has(safety.SKIP_ACCOUNT_SETTING as string)).toBe(true);
  });

  it("every *_SKIP constant of the harness modules is documented", () => {
    const consts = [harness, failureClass].flatMap((m) =>
      Object.entries(m as Record<string, unknown>).filter(([k, v]) => /_SKIP$/.test(k) && typeof v === "string"),
    );
    expect(consts.length).toBeGreaterThanOrEqual(5);
    expect(consts.filter(([, v]) => !documented.has(v as string)).map(([k]) => k)).toEqual([]);
  });

  it("every literal skip(\"…\") reason in the harness is documented", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    const literals = [...src.matchAll(/\bskip\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(literals.length).toBeGreaterThanOrEqual(8);
    expect([...new Set(literals)].filter((l) => !documented.has(l))).toEqual([]);
  });
});
