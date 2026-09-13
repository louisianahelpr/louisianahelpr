// The e2e seed sets are the data every visual sweep photographs. This guard
// holds them to what their headers promise, so "the heavy seed has 40+
// applicants" is a checked fact rather than a comment that rots:
//
//   * every table the normal seed answers is still answered by HEAVY, with
//     every normal id still present (heavy is additive — specs index normal
//     ids and must keep resolving under it);
//   * the heavy stress minimums the owner asked for (2026-09-12) are met;
//   * the normal seed covers every job_status and every payment_status the
//     database admits;
//   * each seeded RPC answers from the table set it is handed.
//
// Imported by computed path on purpose: a static `import "../../e2e/…"` would
// pull an e2e file into the `src` composite project and break `tsc -b` (the
// same reason fixtureSchemaContract.test.ts reads seedData.ts as text).
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Constants } from "@/integrations/supabase/types";
import { extractConstraints } from "./helpers/schemaConstraints";

const E2E = resolve(__dirname, "../../e2e/happy-path");
type Rows = Record<string, unknown[]>;
type SeedModule = {
  SEED_TABLES: Rows;
  SEED_RPCS: Record<string, (args: Record<string, unknown>, ctx: { tables: Rows; userId: string | null }) => unknown>;
  CUSTOMER_ID: string;
  HELPER_ID: string;
};
type HeavyModule = {
  HEAVY_TABLES: Rows;
  HEAVY_BIG_JOB_ID: string;
  HEAVY_THREAD_JOB_ID: string;
  HEAVY_COUNTS: Record<string, number>;
};

const seedPath = pathToFileURL(`${E2E}/seedData.ts`).href;
const heavyPath = pathToFileURL(`${E2E}/seedDataHeavy.ts`).href;
const seed = (await import(/* @vite-ignore */ seedPath)) as SeedModule;
const heavy = (await import(/* @vite-ignore */ heavyPath)) as HeavyModule;

type R = Record<string, unknown>;
const ids = (rows: unknown[]) => (rows as R[]).map((r) => r.id ?? `${r.message_id ?? r.job_id}:${r.user_id}`);

describe("normal seed", () => {
  const jobs = seed.SEED_TABLES.jobs as R[];

  it("covers every job_status", () => {
    const want = [...Constants.public.Enums.job_status];
    expect([...new Set(jobs.map((j) => j.status))].sort()).toEqual([...want].sort());
  });

  it("covers every payment_status jobs_payment_status_check admits", () => {
    const check = extractConstraints().get("jobs")?.get("jobs_payment_status_check") as { values: string[] } | undefined;
    const want = check?.values ?? [];
    expect(want.length).toBeGreaterThan(5);
    const have = new Set(jobs.map((j) => j.payment_status).filter(Boolean));
    expect(want.filter((s) => !have.has(s))).toEqual([]);
  });

  it("has a 30+ message thread with reactions and pins on it", () => {
    const byJob = new Map<unknown, number>();
    for (const m of seed.SEED_TABLES.messages as R[]) byJob.set(m.job_id, (byJob.get(m.job_id) ?? 0) + 1);
    const [threadJob, count] = [...byJob.entries()].sort((a, b) => b[1] - a[1])[0];
    expect(count).toBeGreaterThanOrEqual(30);
    expect((seed.SEED_TABLES.message_reactions as R[]).some((r) => r.job_id === threadJob)).toBe(true);
    expect((seed.SEED_TABLES.thread_pins as R[]).some((r) => r.job_id === threadJob)).toBe(true);
  });

  it("has reviews in both directions and payouts across several months", () => {
    const reviews = seed.SEED_TABLES.reviews as R[];
    expect(reviews.some((r) => r.reviewer_id === seed.CUSTOMER_ID && r.reviewee_id === seed.HELPER_ID)).toBe(true);
    expect(reviews.some((r) => r.reviewer_id === seed.HELPER_ID && r.reviewee_id === seed.CUSTOMER_ID)).toBe(true);
    const months = new Set((seed.SEED_TABLES.payout_transfers as R[]).map((p) => String(p.created_at).slice(0, 7)));
    expect(months.size).toBeGreaterThanOrEqual(3);
  });

  it("has accounts pending, denied and banned, with and without Stripe, and IDV unverified", () => {
    const p = seed.SEED_TABLES.profiles as R[];
    expect(p.some((x) => x.approval_status === "pending")).toBe(true);
    expect(p.some((x) => x.approval_status === "denied")).toBe(true);
    expect(p.some((x) => String(x.ban_status).includes("banned"))).toBe(true);
    expect(p.some((x) => x.stripe_account_id)).toBe(true);
    expect(p.some((x) => x.stripe_account_id === null)).toBe(true);
    expect(p.some((x) => x.id_verification_status === "unverified")).toBe(true);
  });

  it("every foreign job_id in a seeded table names a seeded job", () => {
    const jobIds = new Set(jobs.map((j) => j.id));
    const orphans: string[] = [];
    for (const [table, rows] of Object.entries(seed.SEED_TABLES)) {
      if (table === "jobs" || table === "open_jobs_browse") continue;
      for (const r of rows as R[]) {
        if (typeof r.job_id === "string" && !jobIds.has(r.job_id)) orphans.push(`${table}:${r.job_id}`);
      }
    }
    expect(orphans).toEqual([]);
  });

  it("RPC answers are derived from the rows they are given", () => {
    const ctx = { tables: seed.SEED_TABLES, userId: seed.CUSTOMER_ID };
    const saved = seed.SEED_RPCS.get_my_saved_helpers({}, ctx) as R[];
    expect(saved.length).toBe((seed.SEED_TABLES.favorite_helpers as R[]).filter((f) => f.customer_id === seed.CUSTOMER_ID).length);
    expect(saved.length).toBeGreaterThan(0);
    const exp = seed.SEED_RPCS.get_helper_earnings_export({ _helper_id: seed.HELPER_ID }, ctx) as R[];
    expect(exp.length).toBe(jobs.filter((j) => j.helper_id === seed.HELPER_ID && j.status === "completed").length);
    // …and change when the rows change, so they are not constants in disguise.
    const none = seed.SEED_RPCS.get_my_saved_helpers({}, { tables: { ...seed.SEED_TABLES, favorite_helpers: [] }, userId: seed.CUSTOMER_ID });
    expect(none).toEqual([]);
  });
});

describe("heavy seed", () => {
  it("is additive: every normal table and every normal id is still present", () => {
    const missing: string[] = [];
    for (const [table, rows] of Object.entries(seed.SEED_TABLES)) {
      const have = new Set(ids(heavy.HEAVY_TABLES[table] ?? []));
      for (const id of ids(rows)) if (!have.has(id)) missing.push(`${table}:${String(id)}`);
    }
    expect(missing).toEqual([]);
  });

  it("meets the stress minimums", () => {
    const t = heavy.HEAVY_TABLES;
    const apps = (t.applications as R[]).filter((a) => a.job_id === heavy.HEAVY_BIG_JOB_ID);
    expect(apps.length).toBeGreaterThanOrEqual(40);
    expect((t.open_jobs_browse as R[]).length).toBeGreaterThanOrEqual(100);
    expect((t.messages as R[]).filter((m) => m.job_id === heavy.HEAVY_THREAD_JOB_ID).length).toBeGreaterThanOrEqual(200);
    expect(heavy.HEAVY_COUNTS.bioLength).toBe(1000);
    expect(heavy.HEAVY_COUNTS.titleLength).toBeGreaterThanOrEqual(140);
    expect(heavy.HEAVY_COUNTS.longestMessage).toBe(4000);
    const names = (t.profiles as R[]).map((p) => String(p.full_name));
    expect(names.some((n) => /\p{Extended_Pictographic}/u.test(n))).toBe(true);
    expect(names.some((n) => /[一-鿿]/.test(n))).toBe(true);
    expect(Math.max(...(t.payout_transfers as R[]).map((p) => Number(p.amount_cents)))).toBeGreaterThanOrEqual(10_000_000);
  });

  it("stays inside the constraints the database enforces", () => {
    const t = heavy.HEAVY_TABLES;
    for (const j of t.jobs as R[]) {
      expect(Number(j.budget), String(j.id)).toBeGreaterThanOrEqual(10);
      expect(Number(j.budget), String(j.id)).toBeLessThanOrEqual(5000);
      if (j.urgent_fee != null) expect(Number(j.urgent_fee)).toBeLessThanOrEqual(5000);
      expect(j.pricing_mode).toBe("set_price");
    }
    for (const tip of t.tips as R[]) expect(Number(tip.amount)).toBeLessThanOrEqual(1000);
    for (const m of t.messages as R[]) expect(Array.from(String(m.content)).length).toBeLessThanOrEqual(4000);
    const allIds = Object.entries(t).flatMap(([table, rows]) => (table === "open_jobs_browse" ? [] : ids(rows).map((id) => `${table}:${String(id)}`)));
    expect(allIds.length - new Set(allIds).size, "duplicate ids").toBe(0);
  });
});
