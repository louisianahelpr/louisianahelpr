/**
 * Q2417 (Lander 9, live WebKit run 2026-10-27): e2e/journeys/post-job-day-tap.spec.ts passed every step and
 * then ended red on its own deliberate "ZIP 99999 resolved to no Louisiana parish" warning. The poster test
 * account posts at the parish-less ZIP 99999 every night (postJobForm fillLogistics, which allows that one
 * report), so its saved address on When and where is 99999 too, and a spec that reaches that screen without
 * fillLogistics never allowed it.
 *
 * Class: every journey spec that drives the post-job form (fillJobDetails) also allows that report, either
 * through fillLogistics or its own journey.allowReport.
 *
 * @mutate e2e/journeys/post-job-day-tap.spec.ts |   journey.allowReport(/ZIP 99999 resolved to no Louisiana parish/, | void (/ZIP 99999 resolved to no Louisiana parish/,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(import.meta.dirname, "..", "..");
const DIR = join(ROOT, "e2e", "journeys");

const specs = readdirSync(DIR)
  .filter((n) => n.endsWith(".spec.ts"))
  .map((n) => ({ rel: `e2e/journeys/${n}`, code: blankComments(readFileSync(join(DIR, n), "utf8")) }))
  .filter((f) => /\bfillJobDetails\(/.test(f.code));

describe("journeys that drive the post-job form allow the deliberate ZIP 99999 warning", () => {
  it("finds the specs that drive the post-job form", () => {
    expect(specs.length).toBeGreaterThan(1);
    expect(specs.map((s) => s.rel)).toEqual(expect.arrayContaining(["e2e/journeys/post-job-day-tap.spec.ts"]));
  });

  it("each one calls fillLogistics or allows the report itself", () => {
    const missing = specs.filter(
      (s) => !/\bfillLogistics\(/.test(s.code) && !/journey\.allowReport\(\s*\/ZIP 99999 resolved to no Louisiana parish\//.test(s.code),
    );
    expect(missing.map((s) => s.rel)).toEqual([]);
  });
});
