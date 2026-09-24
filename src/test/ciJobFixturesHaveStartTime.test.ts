// @mutate scripts/ci/null-arg-validators.sql | customer_id, helper_id, status, payment_status, start_time)\n | customer_id, helper_id, status, payment_status)\n
// @mutate scripts/ci/race-runner.mjs | customer_id, helper_id, date_needed, start_time, created_at, payment_status, | customer_id, helper_id, date_needed, created_at, payment_status,
// @mutate .github/workflows/db-smoke.yml |             customer_id, date_needed, start_time\n |             customer_id, date_needed\n
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * jobs_start_time_required (ST-008) refuses a non-flexible job with no start
 * time unless it is a non-recurring seed. The first db-deploy after it landed
 * went red on 2026-09-24 because CI's own q140 fixture
 * (scripts/ci/null-arg-validators.sql) inserted exactly that row. Class: every
 * job INSERT that CI runs against a replayed schema names start_time,
 * is_flexible_schedule or is_seed in its column list.
 */
const ROOT = resolve(__dirname, "..", "..");
const sources = [
  ...readdirSync(join(ROOT, "scripts/ci")).map((f) => `scripts/ci/${f}`),
  ...readdirSync(join(ROOT, ".github/workflows")).filter((f) => f.endsWith(".yml")).map((f) => `.github/workflows/${f}`),
];

describe("CI job fixtures satisfy jobs_start_time_required", () => {
  const inserts: { file: string; cols: string }[] = [];
  for (const file of sources) {
    const src = readFileSync(join(ROOT, file), "utf8");
    for (const m of src.matchAll(/INSERT INTO (?:public\.)?jobs\s*\(([^)]*)\)/gi)) inserts.push({ file, cols: m[1] });
  }

  it("finds the CI job inserts it checks", () => {
    expect(inserts.length).toBeGreaterThanOrEqual(6);
  });

  it("each names start_time, is_flexible_schedule or is_seed", () => {
    const bad = inserts.filter((i) => !/\b(start_time|is_flexible_schedule|is_seed)\b/.test(i.cols)).map((i) => `${i.file}: (${i.cols.replace(/\s+/g, " ").trim()})`);
    expect(bad).toEqual([]);
  });
});
