/**
 * Q407 (7) + money audit LOW-14: an account on a RUNNING recurring series
 * cannot be deleted: the poster until the series is ended, a Helpr until they
 * hold no date on a running series (they leave it first). Inventory: every
 * edge function that purges an account checks findActiveWork first
 * (src/test/disputeOpenerCannotDelete.test.ts), so the gate lives there.
 *
 * Runs the REAL findActiveWork against a fake PostgREST that applies the
 * filters it is given (eq / is / neq / gte / in), so a dropped filter changes
 * the answer.
 *
 * @mutate supabase/functions/_shared/accountPurge.ts |   const series = await findRunningSeries(admin, userId);\n  if (!series.ok \|\| series.active) return series; |   const series = { ok: true, active: false };\n  void findRunningSeries;
 * @mutate supabase/functions/_shared/accountPurge.ts |     if (dates.some((d) => d >= today)) { |     if (false) {
 * @mutate supabase/functions/_shared/accountPurge.ts |       .is("series_ended_on", null)\n      .neq("status", "cancelled")\n      .gte("date_needed", since) |       .neq("status", "cancelled")\n      .gte("date_needed", since)
 * @mutate supabase/functions/_shared/accountPurge.ts |   if (live.data && live.data.length > 0) { |   if (false) {
 * @mutate supabase/functions/delete-own-account/index.ts |           error: active.reason === "series" |           error: false
 */
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
// Loaded by path, not by a static import: accountPurge.ts is Deno source
// (Deno globals, esm.sh URLs) and must stay out of the app tsconfig's graph.
const PURGE = new URL("../../supabase/functions/_shared/accountPurge.ts", import.meta.url).pathname;
type ActiveWork = { ok: boolean; active: boolean; reason?: string; detail?: string };
const purge = (await import(/* @vite-ignore */ PURGE)) as {
  findActiveWork: (admin: unknown, userId: string) => Promise<ActiveWork>;
  SERIES_BLOCKS_DELETION_MESSAGE: string;
};
const { findActiveWork, SERIES_BLOCKS_DELETION_MESSAGE } = purge;

type Row = Record<string, unknown>;
type Tables = Record<string, Row[] | { error: { code: string; message: string } }>;

function fakeAdmin(tables: Tables) {
  return {
    from(table: string) {
      const preds: Array<(r: Row) => boolean> = [];
      let limitN = Infinity;
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
        neq: (c: string, v: unknown) => (preds.push((r) => r[c] !== v), q),
        is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), q),
        not: (c: string, _op: string, v: unknown) => (preds.push((r) => (r[c] ?? null) !== v), q),
        gte: (c: string, v: string) => (preds.push((r) => String(r[c]) >= v), q),
        in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), q),
        // findActiveWork's first read: (customer OR helper) AND live. Nothing
        // in these fixtures is a live one-off job, so it matches nothing.
        or: () => (preds.push(() => false), q),
        limit: (n: number) => ((limitN = n), q),
        then: (res: (v: unknown) => unknown) => {
          const t = tables[table] ?? [];
          if (!Array.isArray(t)) return Promise.resolve({ data: null, error: t.error }).then(res);
          return Promise.resolve({ data: t.filter((r) => preds.every((p) => p(r))).slice(0, limitN), error: null }).then(res);
        },
      };
      return q;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: { from: () => ({}), listBuckets: () => Promise.resolve({ data: [], error: null }) },
  };
}

const POSTER = "11111111-1111-4111-8111-111111111111";
const HELPR = "22222222-2222-4222-8222-222222222222";
const series = (over: Row = {}): Row => ({
  id: "s1", customer_id: POSTER, parent_job_id: null, recurrence_days: [3], recurrence_weeks: 6,
  date_needed: "2026-09-02", series_ended_on: null, status: "completed", ...over,
});

describe("a running recurring series blocks deleting either party's account (Q407 7)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-20T17:00:00Z")); // Sun Sep 20 in Chicago
  });
  afterEach(() => vi.useRealTimers());

  it("the poster of a running series (visit one done, later visits ahead) is refused, with the series copy", async () => {
    const r = await findActiveWork(fakeAdmin({ jobs: [series()] }), POSTER);
    expect(r).toMatchObject({ ok: true, active: true, reason: "series" });
    expect(SERIES_BLOCKS_DELETION_MESSAGE).toMatch(/End it from your posts/);
  });

  it("an ENDED series, a cancelled one, and one whose last visit has passed do not block", async () => {
    for (const s of [series({ series_ended_on: "2026-09-16" }), series({ status: "cancelled" }), series({ recurrence_weeks: 2 })]) {
      const r = await findActiveWork(fakeAdmin({ jobs: [s], series_visit_holds: [] }), POSTER);
      expect(r, JSON.stringify(s)).toMatchObject({ ok: true, active: false });
    }
  });

  it("a Helpr holding a date on a running series is refused; on an ended one, not", async () => {
    const hold = { parent_job_id: "s1", helper_id: HELPR, visit_date: "2026-09-23" };
    let r = await findActiveWork(fakeAdmin({ jobs: [series()], series_visit_holds: [hold] }), HELPR);
    expect(r).toMatchObject({ ok: true, active: true, reason: "series" });
    r = await findActiveWork(fakeAdmin({ jobs: [series({ series_ended_on: "2026-09-20" })], series_visit_holds: [hold] }), HELPR);
    expect(r).toMatchObject({ ok: true, active: false });
  });

  it("fails CLOSED when the series read fails; a holds table not deployed yet is 'none'", async () => {
    let r = await findActiveWork(fakeAdmin({ jobs: { error: { code: "08006", message: "reset" } } }), POSTER);
    expect(r.ok).toBe(false);
    r = await findActiveWork(fakeAdmin({ jobs: [], series_visit_holds: { error: { code: "42P01", message: "relation does not exist" } } }), HELPR);
    expect(r).toMatchObject({ ok: true, active: false });
  });

  it("both deletion paths show the series copy", () => {
    const own = readFileSync("supabase/functions/delete-own-account/index.ts", "utf8");
    expect(own).toMatch(/active\.reason === "series"\s+\?\s+SERIES_BLOCKS_DELETION_MESSAGE/);
    const admin = readFileSync("supabase/functions/admin-delete-user/index.ts", "utf8");
    expect(admin).toMatch(/active\.reason === "series"/);
  });
});
