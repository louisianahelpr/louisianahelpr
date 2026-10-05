import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { clientRpcCalls, latestFunctionDefs } from "./helpers/rpcErrorInventory";
import { walkSource, readSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

/**
 * EVERY CREW LIFECYCLE RPC HAS A CLIENT CALLER (Q1382).
 *
 * The defect: 20260919192559 moved a crew member's lifecycle onto their own
 * roster row and shipped five definer RPCs for it (confirm, on the way,
 * arrival, done, and the poster's per-member arrival confirm), and no client
 * called any of them. A crew could be hired and then never worked or
 * completed: the job-level roll-up that pays a crew was unreachable from the
 * app. Only rpc_group_member_set_proof had a caller (PhotoProof).
 *
 * THE CHECK, inventory from the world: every function the migrations define
 * (newest event wins, a DROP removes it) named rpc_group_member_* or
 * rpc_poster_confirm_member_*, minus every one a non-test src/ file calls with
 * `.rpc("<name>")` (TypeScript AST, comments are not calls), must be empty.
 * And the wrapper module that calls them must itself be used: each exported
 * async wrapper in src/lib/crewLifecycle.ts is referenced from a non-test
 * file outside it, so the caller is not a dead export.
 *
 * Red on the original bug: drop any one caller and its RPC is listed.
 */
// @mutate src/lib/crewLifecycle.ts | supabase.rpc("rpc_group_member_confirm", | supabase.rpc("rpc_group_member_confirm_retired",
// @mutate src/lib/crewLifecycle.ts | supabase.rpc("rpc_poster_confirm_member_arrival", | supabase.rpc("rpc_poster_confirm_member_arrival_retired",
// @mutate src/lib/crewLifecycle.ts | supabase.rpc("rpc_group_member_mark_done", | supabase.rpc("rpc_group_member_mark_done_retired",
// @mutate src/pages/jobs/appliedJobCard/CrewMemberSection.tsx | await crewMemberOnTheWay(app.job_id, await readFix()); | await Promise.resolve(app.job_id);
// @mutate src/components/GroupJobHelpers.tsx | const stamp = await posterConfirmMemberArrival(jobId, h.helper_id); | const stamp = new Date().toISOString();

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const CREW_RPC = /^(rpc_group_member_\w+|rpc_poster_confirm_member_\w+)$/;

const defs = latestFunctionDefs(MIGRATIONS);
const crewRpcs = [...defs.keys()].filter((n) => CREW_RPC.test(n)).sort();
const { calls } = clientRpcCalls(ROOT);

describe("crew lifecycle RPCs have client callers (Q1382)", () => {
  it("the inventory sees the crew RPCs the migrations define", () => {
    // A floor, not a snapshot: if the migration reader goes blind, the
    // "every one is called" check below passes on nothing.
    expect(crewRpcs.length).toBeGreaterThan(5);
    expect(crewRpcs).toContain("rpc_group_member_confirm");
    expect(crewRpcs).toContain("rpc_poster_confirm_member_arrival");
    expect(calls.size).toBeGreaterThan(50);
  });

  it("every rpc_group_member_* / rpc_poster_confirm_member_* is called by non-test client code", () => {
    const uncalled = crewRpcs.filter((rpc) => !calls.has(rpc));
    expect(
      uncalled,
      "A crew lifecycle RPC with no client caller is a step no crew member (or poster) can take in the app. " +
        "Call it from src/lib/crewLifecycle.ts and wire it into the crew UI (CrewMemberSection / GroupJobHelpers).",
    ).toEqual([]);
  });

  it("every crew lifecycle wrapper is used outside its own module", () => {
    const libPath = resolve(ROOT, "src/lib/crewLifecycle.ts");
    const lib = blankComments(readFileSync(libPath, "utf8"));
    const wrappers = [...lib.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]);
    expect(wrappers.length).toBeGreaterThan(4);
    const users = walkSource([resolve(ROOT, "src")])
      .filter((abs) => {
        const rel = relative(ROOT, abs);
        return rel !== "src/lib/crewLifecycle.ts" && !/\.test\.tsx?$|\/test\//.test(rel);
      })
      .map((abs) => blankComments(readSource(abs) ?? ""));
    const unused = wrappers.filter((w) => !users.some((text) => new RegExp(`\\b${w}\\s*\\(`).test(text)));
    expect(unused, "an exported crew wrapper nothing calls leaves its RPC reachable only on paper").toEqual([]);
  });
});
