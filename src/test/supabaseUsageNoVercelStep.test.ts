// @mutate .github/workflows/supabase-usage.yml | cat supabase-usage-report.md >> "$GITHUB_STEP_SUMMARY" \|\| true | node scripts/check-vercel-usage.mjs \|\| true
// @mutate .github/workflows/supabase-usage.yml | SWEEP_SUMMARY: ${{ steps.sweep.outputs.summary }} | SWEEP_SUMMARY: ${{ steps.vercel-usage.outputs.summary }}
/**
 * Q720 (owner decision 2026-09-27): Vercel usage cannot be measured on the
 * Hobby plan. GET /v1/billing/charges answers 404 "Plan not found." for this
 * team (CI runs 35425157146, 36222936567) and the REST API has no other usage
 * endpoint. The owner accepted never measuring it, so the weekly usage check
 * no longer runs a Vercel step. A step that can only ever say UNMEASURED is
 * noise that teaches people to skip the report; this keeps it from coming back
 * unless the plan changes (then delete this test in the same commit).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WF = ".github/workflows/supabase-usage.yml";

describe("supabase-usage.yml has no Vercel usage step (Q720)", () => {
  const src = readFileSync(WF, "utf8");
  const code = src
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

  it("never runs the Vercel usage check or reads its outputs", () => {
    expect(code).not.toMatch(/check-vercel-usage/);
    expect(code).not.toMatch(/vercel-usage/);
    expect(code).not.toMatch(/VERCEL_TOKEN/);
  });

  it("still runs the Supabase headroom check it exists for", () => {
    expect(code).toMatch(/scripts\/supabase-usage-check\.mjs/);
  });
});
