// @mutate scripts/supabase-usage-check.mjs | const DB_LIMIT = PLAN_LIMITS.supabase_db_bytes.value; | const DB_LIMIT = 500 * 1024 * 1024;
// @mutate scripts/supabase-usage-check.mjs | const STORAGE_LIMIT = PLAN_LIMITS.supabase_storage_bytes.value; | const STORAGE_LIMIT = PLAN_LIMITS.supabase_db_bytes.value;
// @mutate scripts/lib/vercelUsage.mjs |     limit: PLAN_LIMITS.vercel_fast_data_transfer_gb_month.value, |     limit: 1000,
// @mutate scripts/lib/quotaMonitor.mjs |     limit: PLAN_LIMITS.sentry_errors_month.value, |     limit: 5_000,
// @mutate scripts/lib/quotaMonitor.mjs | export const PLANS = { supabase: "Pro", | export const PLANS = { supabase: "Free",
// @mutate scripts/supabase-usage-check.mjs |   `## Supabase ${PLAN} headroom`, |   "## Supabase free-tier headroom",
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { PLANS, PLAN_LIMITS, QUOTAS } from "../../scripts/lib/quotaMonitor.mjs";
import { METRICS } from "../../scripts/lib/vercelUsage.mjs";

/**
 * docs/OPEN.md Q221: supabase-usage.yml graded Supabase against the FREE tier
 * (500 MB / 1 GB) though the plan is PRO, and scripts/lib/vercelUsage.mjs
 * graded Vercel against PRO though the team is on HOBBY: two copies of the
 * limits, each stale in its own direction. Now there is ONE definition,
 * PLAN_LIMITS in scripts/lib/quotaMonitor.mjs, and this holds every consumer
 * to it both ways: every limit a consumer grades against is read from
 * PLAN_LIMITS (no number typed in a consumer), and every PLAN_LIMITS entry is
 * read by at least one consumer (no dead entry drifting unnoticed).
 */

const ROOT = join(__dirname, "..", "..");
const CONSUMERS = [
  "scripts/lib/quotaMonitor.mjs",
  "scripts/lib/vercelUsage.mjs",
  "scripts/supabase-usage-check.mjs",
] as const;
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));
const KEYS = Object.keys(PLAN_LIMITS);
const LIMITS = PLAN_LIMITS as Record<string, { value: number | null; unit: string; source: string }>;

describe("plan limits: one definition, every consumer reads it (Q221)", () => {
  it("the plans are the ones measured 2026-09-23: Supabase PRO, Vercel HOBBY", () => {
    expect(PLANS.supabase).toBe("Pro");
    expect(PLANS.vercel).toBe("Hobby");
    expect(KEYS.length).toBeGreaterThan(10);
    for (const k of KEYS) expect(LIMITS[k].source.length, k).toBeGreaterThan(30);
  });

  it("every PLAN_LIMITS entry is read by a consumer, and every read names a real entry", () => {
    const reads = new Set<string>();
    for (const rel of CONSUMERS) {
      for (const m of code(rel).matchAll(/PLAN_LIMITS\.(\w+)/g)) {
        expect(KEYS, `${rel} reads PLAN_LIMITS.${m[1]}, which does not exist`).toContain(m[1]);
        reads.add(m[1]);
      }
    }
    const unread = KEYS.filter((k) => !reads.has(k));
    expect(unread, `PLAN_LIMITS entries no consumer reads: ${unread.join(", ")}`).toEqual([]);
  });

  it("no consumer types a limit of its own (a numeric literal where PLAN_LIMITS belongs)", () => {
    for (const rel of ["scripts/lib/quotaMonitor.mjs", "scripts/lib/vercelUsage.mjs"]) {
      const typed = [...code(rel).matchAll(/^[ \t]*limit:[ \t]*[\d(].*$/gm)].map((m) => m[0].trim());
      expect(typed, `${rel}: limits must come from PLAN_LIMITS`).toEqual([]);
    }
    const usage = code("scripts/supabase-usage-check.mjs");
    // Array.from, not `[...spread]`: a spread's array-literal AST shape reads
    // to the vacuity scanner as "a registry declared in this file", and the
    // for-of loop below then looks self-referential (input and oracle the
    // same list) even though `consts` is parsed out of the real target file
    // and checked against the hardcoded name list and regex two lines down.
    const consts = Array.from(usage.matchAll(/const (\w+_LIMIT)\s*=\s*(.+);/g));
    expect(consts.map((m) => m[1]).sort()).toEqual(["DB_LIMIT", "STORAGE_LIMIT"]);
    for (const m of consts) expect(m[2], m[1]).toMatch(/^PLAN_LIMITS\.\w+\.value$/);
    expect(usage).toContain("PLAN_LIMITS.supabase_db_bytes.value");
    expect(usage).toContain("PLAN_LIMITS.supabase_storage_bytes.value");
  });

  it("the graded numbers equal the definition at runtime", () => {
    const q = Object.fromEntries(QUOTAS.map((x) => [x.id, x.limit]));
    expect(q["supabase.db_size"]).toBe(LIMITS.supabase_db_bytes.value);
    expect(q["supabase.storage"]).toBe(LIMITS.supabase_storage_bytes.value);
    expect(q["vercel.deploys_per_day"]).toBe(LIMITS.vercel_deploys_per_day.value);
    const v = Object.fromEntries(METRICS.map((m) => [m.name, m.limit]));
    expect(v["Edge Requests"]).toBe(LIMITS.vercel_edge_requests_month.value);
    expect(v["Fast Data Transfer"]).toBe(LIMITS.vercel_fast_data_transfer_gb_month.value);
    // Pro's 8 GB, not the free tier's 500 MB.
    expect(LIMITS.supabase_db_bytes.value).toBe(8 * 1024 ** 3);
  });

  it("the Supabase report names the plan, not the free tier", () => {
    const usage = code("scripts/supabase-usage-check.mjs");
    expect(usage).toContain("## Supabase ${PLAN} headroom");
    expect(usage).not.toMatch(/free[- ]tier/i);
  });
});
