// @mutate .github/workflows/secret-scan.yml | branches-ignore: ["land/**"] | branches-ignore: ["bot/**"]
/**
 * GitHub runs ~20 jobs at once for this account. On 2026-10-01 the queue held
 * 147 runs, 111 of them for 10 open land PRs firing ~13 workflows each. These
 * heavy, non-required workflows therefore run on push to main, not per PR.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (f: string) => readFileSync(path.resolve(__dirname, "../..", ".github/workflows", f), "utf8");
const onBlock = (src: string) => src.match(/^on:\n(?:(?:\s.*)?\n)*/m)?.[0] ?? "";

describe("PR run budget", () => {
  for (const f of ["e2e-real-backend.yml", "ui-sweep.yml", "nightly-red-age.yml"]) {
    it(`${f} does not run per PR, and still runs on push to main`, () => {
      const on = onBlock(read(f));
      expect(on).not.toMatch(/^\s{2}pull_request(?:_target)?:/m);
      expect(on).toMatch(/^\s{2}push:\s*\n\s+branches: \[main\]/m);
    });
  }

  it("main-red-watch only starts for main runs, not for every PR run it would skip", () => {
    expect(onBlock(read("main-red-watch.yml"))).toMatch(/^\s{2}workflow_run:\n(?:\s{4}.*\n|\s*#.*\n)*\s{4}branches: \[main\]$/m);
  });

  it("secret-scan does not scan a land/** push twice", () => {
    expect(onBlock(read("secret-scan.yml"))).toMatch(/^\s{2}push:\s*\n\s+branches-ignore: \["land\/\*\*"\]/m);
  });
});
