/*
 * CLASS GUARD (Q253): every journey OUTCOME the scenario matrix declares is
 * either DRIVEN by a real journey test or listed in OUTCOME_UNDRIVEN with its
 * reason — in both directions.
 *
 * The instance: e2e/journeys/scenarios.ts declared "no-show" (and "cancelled",
 * "refunded", "disputed") while e2e/journeys/02-marketplace.spec.ts typed its
 * outcome as smooth / revision / disputed and only ever passed smooth and
 * revision. A declared scenario nobody drives reads as coverage.
 *
 * DRIVEN means an outcome is passed as a VALUE to a real test title in a spec
 * under e2e/journeys/: `scenarioTitle({ … outcome: "x" })` (a type annotation
 * `outcome: "x" | …` does not count) or a `title…("journey", "x")` helper call.
 * Spec code is read comment-blanked.
 */
// @mutate e2e/journeys/02-marketplace.spec.ts | const j5 = title("do-the-job", "revision"); | const j5 = title("do-the-job", "smooth");
// @mutate e2e/journeys/04-money-outcomes.spec.ts | const refundedTitle = titleFor("admin-quick-refund", "refunded"); | const refundedTitle = titleFor("admin-quick-refund", "smooth");
// @mutate e2e/journeys/scenarios.ts |   "no-show": { |   "no-shows": {
// @mutate e2e/journeys/04-money-outcomes.spec.ts | for (const [outcome, u] of Object.entries(OUTCOME_UNDRIVEN)) { | for (const [outcome, u] of Object.entries({})) {
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { OUTCOMES, OUTCOME_UNDRIVEN } from "../../e2e/journeys/scenarios";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const JOURNEYS = join(ROOT, "e2e", "journeys");

function specs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) out.push(...specs(f));
    else if (e.endsWith(".spec.ts")) out.push(f);
  }
  return out;
}

const code = (f: string) => blankComments(readFileSync(f, "utf8"));

/** outcome -> the specs that drive it. */
function drivenOutcomes(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (o: string, f: string) => out.set(o, [...(out.get(o) ?? []), relative(ROOT, f)]);
  for (const f of specs(JOURNEYS)) {
    const src = code(f);
    // An object-literal VALUE: followed by `,` or `}`, never by `|` (a type).
    for (const m of src.matchAll(/\boutcome\s*:\s*"([a-z][a-z-]*)"\s*[,}]/g)) add(m[1], f);
    // A title helper called with ("journey", "outcome", …).
    for (const m of src.matchAll(/\b\w*[tT]itle\w*\(\s*"[^"\n]*"\s*,\s*"([a-z][a-z-]*)"/g)) add(m[1], f);
  }
  return out;
}

describe("every declared journey outcome is driven or annotated uncovered (Q253)", () => {
  const driven = drivenOutcomes();
  const undriven = Object.keys(OUTCOME_UNDRIVEN);

  it("reads a real inventory (cannot pass vacuously)", () => {
    // 6 outcomes declared and 4 driven on 2026-09-26.
    expect(OUTCOMES.length).toBeGreaterThan(4);
    expect(specs(JOURNEYS).length).toBeGreaterThan(8);
    expect(driven.size).toBeGreaterThan(2);
  });

  it("every OUTCOMES entry is driven by a journey test or listed in OUTCOME_UNDRIVEN", () => {
    const orphan = OUTCOMES.filter((o) => !driven.has(o) && !undriven.includes(o));
    expect(
      orphan,
      "declared outcomes no journey drives and OUTCOME_UNDRIVEN (e2e/journeys/scenarios.ts) does not explain. " +
        "Drive each on the real backend, or add it there with the concrete reason it cannot run:\n  " + orphan.join("\n  "),
    ).toEqual([]);
  });

  it("nothing is both driven and listed undriven, and every driven outcome is declared (two-way)", () => {
    const both = undriven.filter((o) => driven.has(o)).map((o) => `${o} (driven by ${driven.get(o)!.join(", ")})`);
    expect(both, "OUTCOME_UNDRIVEN lists an outcome a journey now drives — remove the stale entry").toEqual([]);
    const undeclared = [...driven.keys()].filter((o) => !(OUTCOMES as readonly string[]).includes(o));
    expect(undeclared, "a journey titles an outcome scenarios.ts does not declare").toEqual([]);
    const unknown = undriven.filter((o) => !(OUTCOMES as readonly string[]).includes(o));
    expect(unknown, "OUTCOME_UNDRIVEN names an outcome scenarios.ts does not declare").toEqual([]);
  });

  it("each undriven outcome has a concrete reason, and any 'elsewhere' door is really called there", () => {
    for (const [o, u] of Object.entries(OUTCOME_UNDRIVEN)) {
      expect(u!.why.length, `${o}: give the concrete reason`).toBeGreaterThan(60);
      if (u!.elsewhere) {
        expect(code(join(ROOT, u!.elsewhere.file)), `${o}: ${u!.elsewhere.file} no longer calls ${u!.elsewhere.door}`).toContain(u!.elsewhere.door);
      }
    }
  });

  it("a journey announces every undriven outcome at run time", () => {
    const announcers = specs(JOURNEYS).filter((f) => {
      const src = code(f);
      return /for\s*\(\s*const\s*\[\s*outcome\s*,\s*\w+\s*\]\s*of\s*Object\.entries\(\s*OUTCOME_UNDRIVEN\s*\)\s*\)/.test(src) && src.includes("announceUncovered(");
    });
    expect(announcers.map((f) => relative(ROOT, f)), "no journey spec loops OUTCOME_UNDRIVEN into announceUncovered").not.toEqual([]);
  });
});
