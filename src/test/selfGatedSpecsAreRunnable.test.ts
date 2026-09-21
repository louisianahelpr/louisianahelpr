/*
 * A spec that gates itself behind an env var must have that var in the vacuity
 * runner's map, or it can never be shown able to fail.
 *
 * FOUND 2026-09-21. Several Playwright suites keep themselves off every push:
 *
 *     const d = process.env.RUN_EMPTY_SWEEP ? test.describe : test.describe.skip;
 *
 * Without the variable they COLLECT their tests and skip all of them, and
 * Playwright exits 0. To the vacuity gate a spec that skipped everything is
 * indistinguishable from a spec that passed — so a mutation against it comes
 * back SURVIVED, and the guard reads as hollow when it is nothing of the kind.
 *
 * `empty-state-sweep` (138 tests) and `error-state-sweep` (272 tests) were both
 * in this state. Both ARE wired into CI (`ui-sweep.yml` sets the vars), so the
 * COVERAGE was fine and only the PROVABILITY was missing — which is the harder
 * kind of gap to notice, because everything about it looks healthy.
 *
 * `--list` cannot detect it: Playwright collects the same 138 tests with the
 * gate on or off.
 *
 * So the runner now sets these when it dispatches those specs
 * (`specGateEnv` in scripts/vacuity/run.mjs). This check derives the self-gated
 * set FROM SOURCE and fails if one is missing from that map — so the next spec
 * written this way cannot quietly become unprovable.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const RUNNER = "scripts/vacuity/run.mjs";

/**
 * Specs that choose `test.describe` vs `test.describe.skip` (or `test.skip`)
 * on an env var — i.e. whose tests do not run unless something sets it.
 */
function selfGated(): { spec: string; vars: string[] }[] {
  const specs = execFileSync("git", ["ls-files", "--", "e2e/*.spec.ts"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 1 << 24,
  })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);

  const out: { spec: string; vars: string[] }[] = [];
  for (const spec of specs) {
    const code = blankComments(readFileSync(resolve(REPO, spec), "utf8"));
    // `process.env.X ? test.describe : test.describe.skip` and the inverse,
    // plus `test.skip(!process.env.X, …)`.
    const vars = new Set<string>();
    for (const m of code.matchAll(
      /process\.env\.([A-Z_][A-Z0-9_]*)\s*\?\s*(?:test|describe)\.describe\b|\btest\.skip\(\s*!\s*process\.env\.([A-Z_][A-Z0-9_]*)/g,
    )) {
      vars.add(m[1] ?? m[2]);
    }
    /*
     * A file that declares itself a scratch probe is not a guard and must not
     * be held to one's standard. `zz-senior-probe.spec.ts` is 542 lines and 8
     * tests with exactly ONE `expect()` — and that one only checks it visited
     * every route; everything else writes measurements to disk.
     *
     * The marker is an explicit `@scratch-probe` directive, not the WORD
     * "scratch" anywhere in the file. A first cut used the word and instantly
     * excluded THIS file, whose only crime was explaining the exemption in a
     * comment — a rule prose can satisfy, which is the defect this whole
     * effort exists to kill. A marker has to be something you can only write
     * on purpose, and it evaporates the moment someone deletes it.
     */
    if (/^\s*(?:\/\/|\*)\s*@scratch-probe\b/m.test(readFileSync(resolve(REPO, spec), "utf8"))) continue;
    if (vars.size) out.push({ spec, vars: [...vars].sort() });
  }
  return out;
}

describe("a self-gated spec is runnable by the vacuity gate", () => {
  const gated = selfGated();

  /*
   * The runner's map, PARSED — not a substring search over the file.
   *
   * A first cut asserted `runner.includes(varName)`, and it was hollow on the
   * spot: removing the `empty-state-sweep` entry left the guard GREEN, because
   * the variable name still appeared in the explanatory comment above the map.
   * A check a comment can satisfy is not a check — the repo has been bitten by
   * that exact shape at least four times. Comments are blanked, and the entry
   * must actually pair THIS spec's path with the variable.
   */
  const runnerCode = blankComments(readFileSync(resolve(REPO, RUNNER), "utf8"));
  const runnerMap = new Map<string, string[]>();
  for (const m of runnerCode.matchAll(/"(e2e\/[^"]+\.spec\.ts)"\s*:\s*\{([^}]*)\}/g)) {
    runnerMap.set(m[1], [...m[2].matchAll(/([A-Z_][A-Z0-9_]*)\s*:/g)].map((v) => v[1]));
  }

  it("the detector finds the known self-gated specs (a check that finds nothing cannot fail)", () => {
    const names = gated.map((g) => g.spec);
    expect(names).toContain("e2e/happy-path/empty-state-sweep.spec.ts");
    expect(names).toContain("e2e/happy-path/error-state-sweep.spec.ts");
    // ...and the runner-map parse must find entries, or every assertion below
    // would fail for a parsing reason rather than a real one.
    expect(runnerMap.size, `parsed no specGateEnv entries out of ${RUNNER}`).toBeGreaterThan(1);
  });

  it.each(gated.map((g) => [g.spec, g.vars.join(", ")] as const))(
    "%s — its gate var(s) [%s] are set by the vacuity runner",
    (spec, varsCsv) => {
      const mapped = runnerMap.get(spec) ?? [];
      const missing = varsCsv.split(", ").filter((v) => !mapped.includes(v));
      expect(
        missing,
        `${spec} skips all of its tests unless ${missing.join(" / ")} is set, and Playwright exits 0 ` +
          `when everything skips — so the vacuity gate cannot tell "skipped" from "passed" and any ` +
          `mutation against it scores SURVIVED for an environment reason. Add it to specGateEnv in ` +
          `${RUNNER}.`,
      ).toEqual([]);
    },
  );
});

// PROVEN RED 2026-09-21: removing the RUN_EMPTY_SWEEP entry from specGateEnv in
// scripts/vacuity/run.mjs fails "e2e/happy-path/empty-state-sweep.spec.ts — its
// gate var(s) are set by the vacuity runner".
// SOURCE-TEXT PIN: it checks the var NAME appears in the runner, not that the
// runner maps it to the right spec or that the value is one the spec accepts.
// It also knows only the two spellings of self-gating above — a suite that
// skips itself some third way is outside its inventory.
// @mutate scripts/vacuity/run.mjs | "e2e/happy-path/empty-state-sweep.spec.ts": { RUN_EMPTY_SWEEP: "1" }, |
