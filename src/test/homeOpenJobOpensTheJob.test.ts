/**
 * Audit #12 (2026-10-21): Home's "Open job" opened a filtered Posted/Working
 * list, not the job. It now opens /jobs/<id>; "See applicants" still lands on
 * the Posted list, where applicants are reviewed.
 *
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |         to: `/jobs/${a.job!.id}`, |         to: `/jobs?tab=working&filter=needs_you`,
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | : `/jobs/${j.id}`, | : `/jobs?tab=posted&filter=needs_you`,
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(join(resolve(__dirname, "..", ".."), "src/pages/home/homeDashboard/needsYouTodos.ts"), "utf8"));

describe("Home's Open job opens the job", () => {
  it("every 'Open job' item targets /jobs/<id>", () => {
    expect(src).toContain('to: n > 0 ? `/jobs?tab=posted&filter=needs_you` : `/jobs/${j.id}`,');
    expect(src).toContain("to: `/jobs/${a.job!.id}`,");
    expect(src).not.toContain("tab=working&filter=needs_you");
  });
});
