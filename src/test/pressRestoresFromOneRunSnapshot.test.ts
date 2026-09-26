/**
 * press-every-control restores the shared accounts ONCE per run, from ONE
 * snapshot taken before any shard pressed anything, and that restore puts the
 * weekly availability grid back instead of deleting it.
 *
 * Q272 (docs/OPEN.md): each of four shards snapshotted the profiles at its own
 * start and PATCHed every differing column back at its own end. Shards ran
 * concurrently, so run 35837735324's shard 2 snapshotted after shard 4 had
 * flipped senior_mode and at 11:02Z "restored" senior_mode = TRUE: a value
 * neither account started from.
 *
 * Q325 (docs/OPEN.md): the clean-up deleted every helper_availability row
 * created since the run began. A weekly-hours save REPLACES the week
 * (save_weekly_availability: delete then insert, verified live with
 * pg_get_functiondef 2026-09-26), so a pressed Save turned the seed grid into
 * seven new rows and the clean-up then deleted all seven: the helper was left
 * with no weekly hours at all (DELETEs at 21:07Z, run 35905268411).
 *
 * Behaviour is proven against an in-memory PostgREST (the same fetch calls
 * the script makes on prod), not by reading the source.
 */
// @mutate scripts/audit/pressProdSafety.mjs | if (sharded) return { source: "run", restoreAtEnd: false }; | if (sharded) return { source: "self", restoreAtEnd: true };
// @mutate scripts/audit/pressProdSafety.mjs |   if (sharded && !snapshotIn) { |   if (false) {
// @mutate scripts/audit/pressProdSafety.mjs |   return plan.source === "run" ? runSnapshot ?? null : selfSnapshot ?? null; |   return selfSnapshot ?? runSnapshot ?? null;
// @mutate scripts/audit/pressProdSafety.mjs |     const week = weeklyAvailabilityBefore?.[persona]; |     const week = undefined;
// @mutate scripts/audit/pressProdSafety.mjs |     const rows = before.map((r) => ({ ...r, helper_id: s.userId, specific_date: null })); |     const rows = before.map(({ id: _id, ...r }) => ({ ...r, helper_id: s.userId, specific_date: null }));
// @mutate scripts/audit/pressProdSafety.mjs |   ["helper_availability", "helper_id", "specific_date=not.is.null"], |   ["helper_availability", "helper_id", "specific_date=is.null"],
// @mutate scripts/audit/press-every-control.mjs |   const restoreFrom = restoreSource(plan, runSnapshot, selfSnapshot); |   const restoreFrom = selfSnapshot ?? runSnapshot;
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error -- plain Node ESM with no .d.mts
import * as safety from "../../scripts/audit/pressProdSafety.mjs";

const ROOT = resolve(__dirname, "..", "..");
const HELPER = "11111111-1111-4111-8111-111111111111";
const v5 = (n: number) => `${String(n).padStart(8, "0")}-0000-5000-8000-000000000000`;

type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;

/** Enough of PostgREST's filter grammar for the clean-up's own queries. */
function matches(row: Row, params: URLSearchParams): boolean {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "or"].includes(k)) continue;
    const val = row[k];
    if (v === "is.null") { if (val !== null && val !== undefined) return false; }
    else if (v === "not.is.null") { if (val === null || val === undefined) return false; }
    else if (v.startsWith("eq.")) { if (String(val) !== v.slice(3)) return false; }
    else if (v.startsWith("gte.")) { if (!(String(val) >= v.slice(4))) return false; }
    else if (v.startsWith("in.(")) { if (!v.slice(4, -1).split(",").includes(String(val))) return false; }
    else if (v.startsWith("not.in.(")) { if (v.slice(8, -1).split(",").includes(String(val))) return false; }
    else throw new Error(`fake PostgREST: unsupported filter ${k}=${v}`);
  }
  return true;
}

function fakePostgrest(store: Store) {
  const writes: string[] = [];
  const fn = async (url: unknown, init?: { method?: string; body?: string }) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    const m = /\/rest\/v1\/([a-z_]+)$/.exec(u.pathname);
    if (!m) return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
    const table = m[1];
    const rows = (store[table] ??= []);
    // A copy, as the wire gives: a caller must never hold a live reference into the store.
    const reply = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => JSON.parse(JSON.stringify(body)), text: async () => JSON.stringify(body) });
    if (method === "GET") return reply(rows.filter((r) => matches(r, u.searchParams)));
    if (method === "DELETE") {
      const gone = rows.filter((r) => matches(r, u.searchParams));
      store[table] = rows.filter((r) => !gone.includes(r));
      writes.push(`DELETE ${table} ${gone.length}`);
      return reply(gone.map((r) => ({ id: r.id })));
    }
    if (method === "POST") {
      const add = (JSON.parse(init?.body ?? "[]") as Row[]).map((r) => ({ id: r.id ?? randomUUID(), created_at: new Date().toISOString(), ...r }));
      rows.push(...add);
      writes.push(`POST ${table} ${add.length}`);
      return reply(add.map((r) => ({ id: r.id })), 201);
    }
    if (method === "PATCH") {
      const patch = JSON.parse(init?.body ?? "{}") as Row;
      const hit = rows.filter((r) => matches(r, u.searchParams));
      for (const r of hit) Object.assign(r, patch);
      writes.push(`PATCH ${table} ${Object.keys(patch).join(",")}`);
      return reply(hit);
    }
    throw new Error(`fake PostgREST: ${method}`);
  };
  return { fn: fn as unknown as typeof fetch, writes };
}

const seedWeek = (): Row[] =>
  Array.from({ length: 7 }, (_, d) => ({
    id: v5(d), helper_id: HELPER, day_of_week: d, specific_date: null,
    start_time: "09:00:00", end_time: "17:00:00", is_available: true, created_at: "2026-09-26T02:28:19Z",
  }));
const weekOf = (store: Store) =>
  (store.helper_availability ?? []).filter((r) => r.specific_date === null)
    .map((r) => `${r.id}|${r.day_of_week}|${r.is_available}|${r.start_time}|${r.end_time}`).sort();
const session = { userId: HELPER, accessToken: "t" };

let realFetch: typeof fetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

describe("Q272: one run-level snapshot, one restore", () => {
  it("a shard of a sharded run restores nothing; it may not even start without the run snapshot", () => {
    expect(safety.restorePlan({ shard: "2/4", snapshotIn: undefined }).error).toMatch(/Q272/);
    const shard = safety.restorePlan({ shard: "2/4", snapshotIn: "snap.json" });
    expect(shard.restoreAtEnd).toBe(false);
    expect(safety.restoreSource(shard, { profiles: {} }, { profiles: {} })).toBeNull();
  });

  it("an unsharded run restores itself; the final clean-up restores from the run snapshot", () => {
    const run = { tag: "run" };
    const self = { tag: "self" };
    expect(safety.restoreSource(safety.restorePlan({ shard: undefined, snapshotIn: undefined }), null, self)).toBe(self);
    expect(safety.restoreSource(safety.restorePlan({ shard: "1/1", snapshotIn: undefined }), null, self)).toBe(self);
    expect(safety.restoreSource(safety.restorePlan({ shard: undefined, snapshotIn: "snap.json" }), run, self)).toBe(run);
  });

  it("two interleaved shards cannot restore a value neither account started from", async () => {
    // The run starts with senior_mode = false (the run-level snapshot).
    const store: Store = { profiles: [{ id: "p1", user_id: HELPER, senior_mode: false, available_until: null }] };
    const f = fakePostgrest(store);
    globalThis.fetch = f.fn;
    const runSnapshot = await safety.snapshotAccounts({ helper: session });
    // Shard 4 presses Senior Mode; shard 2 then ends, while it is still flipped.
    store.profiles[0].senior_mode = true;
    const shard2 = safety.restoreSource(safety.restorePlan({ shard: "2/4", snapshotIn: "snap.json" }), runSnapshot, null);
    await safety.cleanup({ sessions: { helper: session }, since: Date.now(), profilesBefore: shard2?.profiles ?? {}, weeklyAvailabilityBefore: shard2?.weeklyAvailability });
    expect(f.writes.filter((w) => w.startsWith("PATCH profiles")), "a shard wrote the profile back").toEqual([]);
    // The run's final restore puts back what the run started from.
    const final = safety.restoreSource(safety.restorePlan({ shard: undefined, snapshotIn: "snap.json" }), runSnapshot, null);
    await safety.cleanup({ sessions: { helper: session }, since: Date.now(), profilesBefore: final.profiles, weeklyAvailabilityBefore: final.weeklyAvailability });
    expect(store.profiles[0].senior_mode).toBe(false);
  });

  it("the script decides who restores through restorePlan/restoreSource, and snapshots only through snapshotAccounts", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    expect(src).toMatch(/restorePlan\(\{ shard: process\.env\.SHARD, snapshotIn: process\.env\.SNAPSHOT_IN \}\)/);
    expect(src).toMatch(/const restoreFrom = restoreSource\(plan, runSnapshot, selfSnapshot\);/);
    expect(src, "a per-shard profile snapshot is back").not.toMatch(/snapshotProfile\(/);
  });
});

describe("Q325: the clean-up restores the weekly availability grid to its pre-run rows", () => {
  it("a pressed Save (the week replaced) ends with the seed week back, ids included; a dated row the run added is removed", async () => {
    const since = Date.now() - 60_000;
    const store: Store = { helper_availability: seedWeek(), profiles: [{ id: "p1", user_id: HELPER, senior_mode: false }] };
    const f = fakePostgrest(store);
    globalThis.fetch = f.fn;
    const before = await safety.snapshotAccounts({ helper: session });
    expect(before.weeklyAvailability.helper).toHaveLength(7);
    const pre = weekOf(store);
    // The press saves the week: save_weekly_availability deletes it and inserts seven new rows.
    const now = new Date().toISOString();
    store.helper_availability = [
      ...Array.from({ length: 7 }, (_, d) => ({ id: randomUUID(), helper_id: HELPER, day_of_week: d, specific_date: null, start_time: "08:00:00", end_time: "12:00:00", is_available: d < 5, created_at: now })),
      { id: randomUUID(), helper_id: HELPER, day_of_week: null, specific_date: "2026-10-01", start_time: null, end_time: null, is_available: false, created_at: now },
    ];
    const r = await safety.cleanup({ sessions: { helper: session }, since, profilesBefore: before.profiles, weeklyAvailabilityBefore: before.weeklyAvailability });
    expect(r.residue).toEqual([]);
    expect(weekOf(store), "the weekly grid is not the pre-run grid").toEqual(pre);
    expect(store.helper_availability.filter((x) => x.specific_date !== null), "the run's dated row survived").toEqual([]);
  });

  it("an untouched week is not rewritten", async () => {
    const store: Store = { helper_availability: seedWeek(), profiles: [{ id: "p1", user_id: HELPER }] };
    const f = fakePostgrest(store);
    globalThis.fetch = f.fn;
    const before = await safety.snapshotAccounts({ helper: session });
    await safety.cleanup({ sessions: { helper: session }, since: Date.now(), profilesBefore: before.profiles, weeklyAvailabilityBefore: before.weeklyAvailability });
    expect(f.writes).toEqual([]);
  });

  it("the old failure: deleting the week's new rows without a restore leaves no week at all", async () => {
    // The pre-fix shape, reproduced with the same store: no snapshot handed to
    // the clean-up, and the table's weekly rows treated as "rows the run made".
    const store: Store = { helper_availability: seedWeek().map((r) => ({ ...r, id: randomUUID(), created_at: new Date().toISOString() })) };
    globalThis.fetch = fakePostgrest(store).fn;
    const since = new Date(Date.now() - 60_000).toISOString();
    const ids = store.helper_availability.map((r) => r.id).join(",");
    await globalThis.fetch(`https://x.supabase.co/rest/v1/helper_availability?id=in.(${ids})&helper_id=eq.${HELPER}&created_at=gte.${since}`, { method: "DELETE" });
    expect(weekOf(store)).toEqual([]);
  });
});
