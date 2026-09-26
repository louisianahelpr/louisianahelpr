/**
 * #1582 / Q389(a): press-every-control's clean-up runs
 * scripts/proof-photo-reference-check.mjs, which fails while any jobs row names
 * a proof-photo object storage does not have. The seed rows that do are the
 * residue of prod-lifecycle's teardown deleting objects under rows it kept,
 * fixed in a8d75d3b3 (2026-09-25T05:42:00Z). The check now repairs exactly
 * that residue: is_seed rows created before the fix. A real job, or a seed job
 * created after it, stays red, so a NEW source is never repaired away.
 *
 * @mutate scripts/proof-photo-reference-check.mjs |     if (!row \|\| row.is_seed !== true) continue; |     if (!row) continue;
 * @mutate scripts/proof-photo-reference-check.mjs |     if (!Number.isFinite(created) \|\| !(created < before)) continue; |
 * @mutate .github/workflows/press-every-control.yml | node scripts/proof-photo-reference-check.mjs --repair-seed-before 2026-09-25T05:42:00Z | node scripts/proof-photo-reference-check.mjs
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error - plain .mjs tool script, no types
import { seedRepairPlan } from "../../scripts/proof-photo-reference-check.mjs";

const ROOT = resolve(__dirname, "..", "..");
const FIX = Date.parse("2026-09-25T05:42:00Z");
const d = (jobId: string, col: string, value: string) => ({ jobId, col, value });

describe("proof-photo check repairs only the pre-fix seed residue (#1582)", () => {
  const rows = new Map([
    ["seed-old", { is_seed: true, created_at: "2026-09-24T10:00:00Z", proof_before_urls: ["seed-old/a.png", "seed-old/ok.png"], proof_after_urls: ["seed-old/b.png"] }],
    ["seed-new", { is_seed: true, created_at: "2026-09-25T06:00:00Z", proof_before_urls: ["seed-new/a.png"], proof_after_urls: [] }],
    ["real-old", { is_seed: false, created_at: "2026-09-01T00:00:00Z", proof_before_urls: ["real-old/a.png"], proof_after_urls: [] }],
  ]);
  const dangling = [
    d("seed-old", "proof_before_urls", "seed-old/a.png"),
    d("seed-old", "proof_after_urls", "seed-old/b.png"),
    d("seed-new", "proof_before_urls", "seed-new/a.png"),
    d("real-old", "proof_before_urls", "real-old/a.png"),
  ];

  it("drops the dangling values of a pre-fix seed row and keeps its live ones", () => {
    const plan = seedRepairPlan(dangling, rows, FIX);
    expect(plan.get("seed-old")).toEqual({ proof_before_urls: ["seed-old/ok.png"], proof_after_urls: [] });
  });

  it("never touches a real job or a seed job made after the fix", () => {
    const plan = seedRepairPlan(dangling, rows, FIX);
    expect([...plan.keys()]).toEqual(["seed-old"]);
  });

  it("the clean-up job passes the fix's own timestamp, not a moving one", () => {
    const wf = readFileSync(resolve(ROOT, ".github/workflows/press-every-control.yml"), "utf8");
    expect(wf).toMatch(/node scripts\/proof-photo-reference-check\.mjs --repair-seed-before 2026-09-25T05:42:00Z/);
  });
});
