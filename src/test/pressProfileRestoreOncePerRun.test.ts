// @mutate scripts/audit/pressProdSafety.mjs |   return !(total > 1); |   return true;
// @mutate scripts/audit/press-every-control.mjs |   const profilesBefore = await shardProfileBaseline(sessions, process.env.SHARD); |   const profilesBefore = await snapshotProfiles(sessions);
// @mutate .github/workflows/press-every-control.yml |     needs: [snapshot]\n |     needs: []\n
// @mutate .github/workflows/press-every-control.yml |           PROFILE_SNAPSHOT: ${{ needs.snapshot.result == 'success' && 'profile-baseline/profile-snapshot.json' \|\| '' }} |           PROFILE_SNAPSHOT_X: ''
// @mutate scripts/audit/pressProdSafety.mjs |     if (profilesBefore && !before) residue.push | if (false) residue.push
// @mutate scripts/audit/pressProdSafety.mjs | "is_seed", "approval_status", "terms_version_accepted", | "is_seed",
// @mutate scripts/audit/pressProdSafety.mjs |         for (const [k, v] of Object.entries(patch)) { |         for (const [k, v] of [[Object.keys(patch).join(), patch]]) {
/*
 * CLASS GUARD (docs/OPEN.md Q272): the press sweep's profile restore can never
 * write back a value the run did not start from.
 *
 * press-every-control runs four shards at once on the SAME shared accounts.
 * Each shard used to snapshot every profile at its start and PATCH every
 * differing column back at its end, so a shard that snapshotted after another
 * shard's press restored THAT press: run 35837735324 shard 2 at 11:02Z
 * "restored senior_mode, available_until" to the flipped value (edge_logs,
 * Q200). The fix: a shard of a sharded run takes no baseline and restores
 * nothing; the workflow's `snapshot` job records ONE baseline before any shard
 * starts and its `cleanup` job restores from it after every shard.
 *
 * The first test replays that interleave against a fake PostgREST, with the
 * real shardProfileBaseline / cleanup / snapshotProfiles. The second pins the
 * workflow wiring that makes "once per run" true on CI.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";

type Row = Record<string, unknown>;
type Session = { userId: string; accessToken: string };
const ROOT = resolve(__dirname, "../..");
const shardProfileBaseline = safety.shardProfileBaseline as (s: Record<string, Session>, shard?: string) => Promise<Record<string, Row | null> | null>;
const snapshotProfiles = safety.snapshotProfiles as (s: Record<string, Session>) => Promise<Record<string, Row | null>>;
const shardOwnsProfileRestore = safety.shardOwnsProfileRestore as (shard?: string) => boolean;
const cleanup = safety.cleanup as (a: { sessions: Record<string, Session>; since: number; profilesBefore: Record<string, Row | null> | null }) => Promise<{ log: string[]; residue: string[] }>;

/** A one-table PostgREST: profiles rows by user_id; every other table is empty. Records every profile PATCH. */
function fakeProd(rows: Record<string, Row>, refuse: string[] = []) {
  const patches: Row[] = [];
  const fetchStub = vi.fn(async (url: string, init: { method?: string; body?: string } = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const table = u.pathname.replace(/^\/rest\/v1\//, "");
    const uid = (u.searchParams.get("user_id") ?? "").replace(/^eq\./, "");
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (table === "profiles" && method === "GET") return json(rows[uid] ? [{ ...rows[uid] }] : []);
    if (table === "profiles" && method === "PATCH") {
      const patch = JSON.parse(init.body ?? "{}") as Row;
      patches.push(patch);
      if (Object.keys(patch).some((k) => refuse.includes(k))) return new Response('{"code":"42501"}', { status: 400 });
      rows[uid] = { ...rows[uid], ...patch };
      return json([{ ...rows[uid] }]);
    }
    return json([]);
  });
  vi.stubGlobal("fetch", fetchStub);
  return { rows, patches };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("Q272: the press sweep restores profiles from ONE baseline per run", () => {
  it("replays run 35837735324's interleave: no restore writes the flipped value, and the run ends where it started", async () => {
    const U = "71c56dfb-0000-4000-8000-000000000001";
    const start: Row = { user_id: U, senior_mode: false, available_until: null, full_name: "Poster E2E" };
    const prod = fakeProd({ [U]: { ...start } });
    const sessions = { customer: { userId: U, accessToken: "t" } };

    // The workflow's snapshot job, before any shard.
    const runBaseline = await snapshotProfiles(sessions);
    // Shard 2 starts; then shard 4 presses Senior Mode (09:06:10Z); then shard 3 starts.
    const shard2 = await shardProfileBaseline(sessions, "2/4");
    prod.rows[U] = { ...prod.rows[U], senior_mode: true, available_until: "2026-09-30" };
    const shard3 = await shardProfileBaseline(sessions, "3/4");
    // Shard 4 is done pressing but the value stays flipped until someone restores it.
    // Shards finish in the order that bit: 2, then 3 (11:02Z).
    await cleanup({ sessions, since: Date.now(), profilesBefore: shard2 });
    await cleanup({ sessions, since: Date.now(), profilesBefore: shard3 });
    // The cleanup job, after every shard.
    const final = await cleanup({ sessions, since: Date.now(), profilesBefore: runBaseline });

    const wroteFlipped = prod.patches.filter((p) => p.senior_mode === true || p.available_until === "2026-09-30");
    expect(wroteFlipped, "a restore wrote back a value the run did not start from (the 11:02Z bug)").toEqual([]);
    expect(prod.rows[U].senior_mode).toBe(false);
    expect(prod.rows[U].available_until).toBe(null);
    expect(final.residue).toEqual([]);
    expect(final.log.some((l) => l.includes("restored senior_mode, available_until"))).toBe(true);
  });

  it("a shard of a sharded run owns no restore; only an unsharded run does", () => {
    for (const s of ["1/4", "2/4", "3/4", "4/4", "1/2"]) expect(shardOwnsProfileRestore(s), s).toBe(false);
    for (const s of [undefined, "", "1/1"]) expect(shardOwnsProfileRestore(s), String(s)).toBe(true);
  });

  it("the sweep's shards take their baseline through shardProfileBaseline; the only other snapshot is the run-level one", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    expect(src).toMatch(/profilesBefore = await shardProfileBaseline\(sessions, process\.env\.SHARD\)/);
    // Exactly one direct snapshotProfiles call: the PROFILE_SNAPSHOT_OUT branch.
    expect(src.match(/snapshotProfiles\(/g)?.length ?? 0).toBe(1);
    expect(src).toMatch(/if \(process\.env\.PROFILE_SNAPSHOT_OUT\) \{\s*const snap = await snapshotProfiles\(sessions\)/);
  });

  it("never rolls back server-owned records, and one refused column cannot sink the rest (run 35905268411)", async () => {
    const U = "u3";
    // The server refuses approval_status from a member, as prod did (HTTP 400 on all four shards).
    const prod = fakeProd({ [U]: { user_id: U, senior_mode: true, approval_status: "approved", terms_version_accepted: "2026-09-23", bio: "changed" } }, ["approval_status", "bio"]);
    const baseline = { customer: { user_id: U, senior_mode: false, approval_status: "pending", terms_version_accepted: "2026-09-01", bio: "seed" } };
    const r = await cleanup({ sessions: { customer: { userId: U, accessToken: "t" } }, since: Date.now(), profilesBefore: baseline });
    const written = prod.patches.flatMap((p) => Object.keys(p));
    expect(written).not.toContain("approval_status");
    expect(written).not.toContain("terms_version_accepted");
    expect(prod.rows[U].senior_mode).toBe(false);
    expect(r.log.join("\n")).toMatch(/customer profile: restored senior_mode/);
    // A column the server refuses is residue by NAME, and did not stop senior_mode.
    expect(r.residue.join("\n")).toMatch(/could NOT restore bio \(HTTP 400/);
  });

  it("a baseline that lacks a reachable persona is residue, never a silent skip", async () => {
    fakeProd({ u2: { user_id: "u2", senior_mode: false } });
    const r = await cleanup({ sessions: { helper: { userId: "u2", accessToken: "t" } }, since: Date.now(), profilesBefore: {} });
    expect(r.residue.join("\n")).toMatch(/helper profile: NOT restored/);
  });

  it("the workflow snapshots once before every shard and restores once after all of them", () => {
    const wf = parse(readFileSync(resolve(ROOT, ".github/workflows/press-every-control.yml"), "utf8")) as {
      jobs: Record<string, { needs?: string[]; strategy?: { matrix?: { shard?: number[] } }; steps: { env?: Record<string, string>; run?: string; uses?: string }[] }>;
    };
    const { snapshot, press, cleanup: clean } = wf.jobs;
    expect(snapshot, "no snapshot job").toBeTruthy();
    const snapStep = snapshot.steps.find((s) => s.env?.PROFILE_SNAPSHOT_OUT);
    expect(snapStep?.run ?? "").toContain("press-every-control.mjs");
    // Every shard waits for the baseline, and is a shard of >1 (so it restores nothing).
    expect(press.needs).toContain("snapshot");
    expect(press.strategy?.matrix?.shard?.length ?? 0).toBeGreaterThan(1);
    const pressEnv = press.steps.find((s) => s.env?.SHARD)?.env ?? {};
    expect(pressEnv.SHARD).toMatch(/\/4$/);
    // The cleanup runs after every shard and restores from that one file.
    expect(clean.needs).toEqual(expect.arrayContaining(["snapshot", "press"]));
    const sweep = clean.steps.find((s) => s.env?.PROFILE_SNAPSHOT !== undefined);
    expect(sweep?.env?.PROFILE_SNAPSHOT ?? "").toContain("profile-snapshot.json");
    expect(sweep?.run ?? "").toContain("CLEANUP_SINCE");
    expect(clean.steps.some((s) => s.uses === "actions/download-artifact@v7")).toBe(true);
  });
});
