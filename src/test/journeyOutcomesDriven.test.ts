// @mutate e2e/journeys/04-admin-safety.spec.ts | title("no-show", "poster-only", "approved", "no-show") | title("no-show", "poster-only", "approved", "smooth")
// @mutate e2e/journeys/04-admin-safety.spec.ts | title("admin-refund", "admin", "approved", "refunded") | title("admin-refund", "admin", "approved", "smooth")
// @mutate e2e/journeys/04-admin-safety.spec.ts | title("ban-enforcement", "admin", "banned", "smooth") | title("ban-enforcement", "admin", "approved", "smooth")
/*
 * A DECLARED JOURNEY OUTCOME IS A DRIVEN ONE (docs/OPEN.md Q253, Q226).
 *
 * e2e/journeys/scenarios.ts declares the outcomes and account states the
 * journey suite covers. "no-show" sat in OUTCOMES for weeks while no spec ever
 * drove it — the matrix promised a journey that did not exist. This test reads
 * the declaration and every spec under e2e/journeys/ (comments blanked), and
 * fails when:
 *
 *   - an OUTCOME has no spec whose scenarioTitle(...)/title(...) call names it,
 *     unless it is in KNOWN_UNDRIVEN_OUTCOMES with the queue item that will
 *     drive it; that list is TWO-WAY: an entry that is now driven fails as stale;
 *   - an ACCOUNT_STATE is neither driven by a spec nor listed, with its reason,
 *     in REAL_BACKEND_UNREACHABLE.
 *
 * A call's literals count only in a CALL, never in a declaration: the helper
 * `function title(journey, outcome: "smooth" | "revision" | "disputed")` in
 * 02-marketplace names "disputed" in its type, and that drives nothing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const JOURNEYS = join(ROOT, "e2e", "journeys");
const scenarios = blankComments(readFileSync(join(JOURNEYS, "scenarios.ts"), "utf8"));

function constList(name: string): string[] {
  const m = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(scenarios);
  if (!m) throw new Error(`${name} not found in e2e/journeys/scenarios.ts`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const OUTCOMES = constList("OUTCOMES");
const ACCOUNT_STATES = constList("ACCOUNT_STATES");
const UNREACHABLE = (() => {
  const m = /REAL_BACKEND_UNREACHABLE[^=]*=\s*\{([\s\S]*?)\n\};/.exec(scenarios);
  if (!m) throw new Error("REAL_BACKEND_UNREACHABLE not found in e2e/journeys/scenarios.ts");
  return [...m[1].matchAll(/^\s*"?([a-z-]+)"?\s*:/gm)].map((x) => x[1]);
})();

// @two-way src/test/journeyOutcomesDriven.test.ts:is driven now: remove it from KNOWN_UNDRIVEN_OUTCOMES
const KNOWN_UNDRIVEN_OUTCOMES: Record<string, string> = {
  cancelled: "Q299: no journey cancels a funded job on the real backend",
  disputed: "Q299: J6 (dispute open -> withdraw) is gone from 02-marketplace; nothing drives a dispute",
};

function specFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...specFiles(p));
    else if (e.endsWith(".spec.ts")) out.push(p);
  }
  return out;
}

/** String literals inside every scenarioTitle(...) / title(...) CALL (not a `function title(` declaration). */
export function calledLiterals(src: string): Set<string> {
  const code = blankComments(src);
  const found = new Set<string>();
  const re = /(?<![\w.])(scenarioTitle|title)\(/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < code.length && depth; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
    }
    for (const lit of code.slice(start, i - 1).matchAll(/"([a-z-]+)"/g)) found.add(lit[1]);
  }
  return found;
}

const files = specFiles(JOURNEYS);
const driven = new Map<string, string[]>();
for (const f of files) {
  for (const lit of calledLiterals(readFileSync(f, "utf8"))) {
    driven.set(lit, [...(driven.get(lit) ?? []), f.slice(ROOT.length + 1)]);
  }
}

describe("every declared journey outcome and state is driven", () => {
  it("reads a real inventory", () => {
    expect(files.length).toBeGreaterThan(8);
    expect(OUTCOMES.length).toBeGreaterThan(4);
    expect(ACCOUNT_STATES.length).toBeGreaterThan(4);
  });

  it("the call parser ignores declarations and reads calls", () => {
    const lits = calledLiterals(`function title(j: string, o: "disputed") {}\nconst a = title("x", "no-show");\nscenarioTitle({ outcome: "refunded" });`);
    expect([...lits].sort()).toEqual(["no-show", "refunded", "x"]);
  });

  for (const outcome of OUTCOMES) {
    it(`outcome "${outcome}" has a spec that drives it`, () => {
      const by = driven.get(outcome) ?? [];
      if (outcome in KNOWN_UNDRIVEN_OUTCOMES) {
        expect(by, `"${outcome}" is driven now: remove it from KNOWN_UNDRIVEN_OUTCOMES`).toEqual([]);
      } else {
        expect(by.length, `"${outcome}" is declared in scenarios.ts OUTCOMES but no e2e/journeys spec drives it`).toBeGreaterThan(0);
      }
    });
  }

  it("KNOWN_UNDRIVEN_OUTCOMES names only declared outcomes", () => {
    for (const k of Object.keys(KNOWN_UNDRIVEN_OUTCOMES)) expect(OUTCOMES).toContain(k);
  });

  for (const state of ACCOUNT_STATES) {
    it(`account state "${state}" is driven or listed unreachable with a reason`, () => {
      const ok = (driven.get(state) ?? []).length > 0 || UNREACHABLE.includes(state);
      expect(ok, `"${state}" is neither driven by a journey spec nor in REAL_BACKEND_UNREACHABLE`).toBe(true);
    });
  }
});
