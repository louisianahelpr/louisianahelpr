// @mutate .github/workflows/ui-sweep.yml |   workflow_dispatch:\n    inputs:\n      batch: |   push:\n    branches: [main]\n  workflow_dispatch:\n    inputs:\n      batch:
// @mutate scripts/ci/main-batch.mjs |   { file: "ui-sweep.yml", paths: UI_PATHS },\n |\n
// @mutate .github/workflows/main-batch.yml |     - cron: "*/20 * * * *" |     - cron: "0 5 * * *"
/**
 * GitHub runs ~20 jobs at once for this account. On 2026-10-01 the queue held
 * 147 runs, 111 of them for 10 open land PRs firing ~13 workflows each. These
 * heavy, non-required workflows therefore run on push to main, not per PR.
 *
 * 2026-10-02 (owner: stay on GitHub Free, 44 runs queued, ~15 workflows per
 * push): the two heaviest no longer run per PUSH either. main-batch.yml runs on
 * push + every 20 min (the prod-deploy.yml pattern) and dispatches each with
 * `batch: true` for main HEAD (scripts/ci/main-batch.mjs), so HEAD is still
 * checked within ~20 min. These tests pin both halves: no per-push trigger,
 * and a dispatcher that still reaches each one.
 */
// @mutate .github/workflows/secret-scan.yml | branches-ignore: ["land/**"] | branches-ignore: []
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TARGETS, DEBOUNCE_MS } from "../../scripts/ci/main-batch.mjs";

const read = (f: string) => readFileSync(path.resolve(__dirname, "../..", ".github/workflows", f), "utf8");
const onBlock = (src: string) => src.match(/^on:\n(?:(?:\s.*)?\n)*/m)?.[0] ?? "";

describe("PR run budget", () => {
  for (const f of ["nightly-red-age.yml"]) {
    it(`${f} does not run per PR, and still runs on push to main`, () => {
      const on = onBlock(read(f));
      expect(on).not.toMatch(/^\s{2}pull_request(?:_target)?:/m);
      expect(on).toMatch(/^\s{2}push:\s*\n\s+branches: \[main\]/m);
    });
  }

  const BATCHED = ["e2e-real-backend.yml", "ui-sweep.yml"];
  it("BATCHED names more than one workflow (both heavy, non-required checks)", () => {
    expect(BATCHED.length).toBeGreaterThan(1);
  });
  for (const f of BATCHED) {
    it(`${f} runs neither per PR nor per push, only as a main batch`, () => {
      const src = read(f);
      const on = onBlock(src);
      expect(on).not.toMatch(/^\s{2}pull_request(?:_target)?:/m);
      expect(on).not.toMatch(/^\s{2}push:/m);
      // The dispatcher passes batch=true, and the run is titled so that
      // main-red-watch reports it and the shared-accounts lock ignores it.
      expect(on).toMatch(/^\s{2}workflow_dispatch:\n\s{4}inputs:\n(?:\s{6}.*\n|\s*#.*\n)*?\s{6}batch:\n\s{8}description: .*\n\s{8}type: boolean/m);
      expect(src).toMatch(/^run-name: \$\{\{ inputs\.batch && format\('\{0\} \(main batch \{1\}\)', github\.workflow, github\.sha\) \|\| github\.workflow \}\}$/m);
      expect(TARGETS.map((t) => t.file)).toContain(f);
    });
  }

  it("the dispatcher reaches main HEAD within ~20 min: push + every-20-min cron, one batch per <= 20 min", () => {
    const on = onBlock(read("main-batch.yml"));
    expect(on).toMatch(/^\s{2}push:\s*\n\s+branches: \[main\]/m);
    expect(on).toMatch(/^\s{4}- cron: "\*\/20 \* \* \* \*"$/m);
    expect(DEBOUNCE_MS).toBeLessThanOrEqual(20 * 60 * 1000);
    expect(read("main-batch.yml")).toMatch(/^\s+run: node scripts\/ci\/main-batch\.mjs$/m);
    expect(TARGETS.map((t) => t.file).sort()).toEqual([...BATCHED].sort());
  });

  it("main-red-watch reports a main batch like the push run it replaced", () => {
    const src = read("main-red-watch.yml");
    expect(src).toMatch(/github\.event\.workflow_run\.event == 'workflow_dispatch' &&\s+contains\(github\.event\.workflow_run\.display_title, '\(main batch '\)/);
    expect(onBlock(src)).toMatch(/^\s{6}- Main batch dispatch$/m);
  });

  it("main-red-watch only starts for main runs, not for every PR run it would skip", () => {
    expect(onBlock(read("main-red-watch.yml"))).toMatch(/^\s{2}workflow_run:\n(?:\s{4}.*\n|\s*#.*\n)*\s{4}branches: \[main\]$/m);
  });

  it("secret-scan does not scan a land/** push twice", () => {
    expect(onBlock(read("secret-scan.yml"))).toMatch(/^\s{2}push:\s*\n\s+branches-ignore: \["land\/\*\*"\]/m);
  });
});
