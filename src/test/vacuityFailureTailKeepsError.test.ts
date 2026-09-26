/*
 * A RED BASELINE'S "WHY" MUST CONTAIN THE FAILURE (Q432).
 *
 * The gate reports "guard is RED before any mutation" with the tail of the
 * guard's output. For a Playwright spec that tail was the webServer's
 * `[WebServer]` build warnings, so the failing assertion never reached the
 * log (run 36215687625, #1819's privacy-requests.spec.ts). This pins that a
 * spec output ending in 30 lines of [WebServer] noise still yields its
 * `Error:` line, and that run.mjs takes every tail through failureTail.
 */
// @mutate scripts/vacuity/run.mjs | .filter((l) => !/^\s*\[WebServer\]/.test(l)) | .filter(Boolean)

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs script, no types
import { failureTail } from "../../scripts/vacuity/run.mjs";

const RUN_MJS = readFileSync(resolve(__dirname, "..", "..", "scripts", "vacuity", "run.mjs"), "utf8");

describe("vacuity failureTail", () => {
  it("keeps the spec's Error: line when the output ends in [WebServer] noise", () => {
    const out = [
      "Running 1 test using 1 worker",
      "  1) e2e/prod-audit/privacy-requests.spec.ts:12:3 › export request",
      "    Error: expect(locator).toBeVisible() failed",
      "    Locator: getByRole('button', { name: 'Request export' })",
      "  1 failed",
      ...Array.from({ length: 30 }, (_, i) => `[WebServer] warn - tailwind class ${i} not found`),
    ].join("\n");
    const tail = failureTail(out);
    expect(tail).toContain("Error: expect(locator).toBeVisible() failed");
    expect(tail).not.toContain("[WebServer]");
  });

  it("every red-run tail in run.mjs goes through failureTail", () => {
    const uses = RUN_MJS.match(/failureTail\((r|again)\.out\)/g) ?? [];
    expect(uses.length).toBe(3);
    expect(RUN_MJS).not.toMatch(/\.out\.trim\(\)\.split\("\\n"\)\.slice\(-25\)/);
  });
});
