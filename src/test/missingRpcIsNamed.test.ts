/**
 * "NOT DEPLOYED YET" IS ASKED ABOUT ONE NAMED RPC, NEVER ANY PGRST202
 * (lead review of wip/reds-1019-2, 2026-10-19).
 *
 * THE BUG CLASS: PostgREST answers PGRST202 both when a function is missing
 * and when it exists with other parameters; only the second carries a hint
 * naming the function itself. src/lib/missingRpc.ts's isMissingRpc read ANY
 * PGRST202 as "not deployed", so a changed signature on features_open_to_everyone
 * (landing), rpc_check_application_rate / rpc_record_application_attempt (apply
 * rate limit) or the four thread-mute RPCs fell back quietly instead of failing
 * (all seven are on prod, pg_proc 2026-10-19). Same class as Q2086.
 *
 * THE CHECK, over every tracked non-test file under src/ (comments blanked):
 *   1. src/lib/missingRpc.ts exports only isMissingRpcNamed (no lenient form);
 *   2. every isMissingRpcNamed(<err>, "<name>") names an RPC the same file
 *      calls with supabase.rpc("<name>" (so the name is the call it judges);
 *   3. the remaining hand-written PGRST202 comparisons are an EXACT ratchet
 *      (RAW_PGRST202_SITES): Q2190 moves them to isMissingRpcNamed one by one,
 *      lowering the number in the same commit; a new one fails.
 *
 * @mutate src/lib/threadMutes.ts |     if (isMissingRpcNamed(error, "toggle_thread_mute")) { |     if (isMissingRpcNamed(error, "set_thread_snooze")) {
 * @mutate src/components/landing/useSectionsOpen.ts |     if (isMissingRpcNamed(res.error, "features_open_to_everyone")) return null; |     if (res.error?.code === "PGRST202") return null;
 * @mutate src/lib/missingRpc.ts | export function isMissingRpcNamed( | export function isMissingRpc(error: unknown): boolean {\n  return (error as { code?: string } \| null)?.code === "PGRST202";\n}\nexport function isMissingRpcNamed(
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

/** Hand-written PGRST202 comparisons still in app code (Q2190 burns these down). EXACT, both ways. */
// 59 since boards 66/172 slice 2 (2026-10-21): CancellationDialog asks poster_cancel_job the old way when the
// deployed function predates p_expected_fee_cents. That PGRST202 names poster_cancel_job in its hint (it exists with
// other parameters), the one case isMissingRpcNamed rightly refuses, so it stays a raw comparison until 130723 is live.
// 60 since the pickup-place hours (2026-10-31, 20261031145652): porchPlaces.ts saves a place with p_windows and, while
// the deployed declutter_save_porch_place still has only 7 arguments, saves the days alone. Same case as above: that
// PGRST202 names declutter_save_porch_place in its hint (it exists with other parameters), so it stays a raw comparison
// until 145652 is live (then drop the fallback and this back to 59).
const RAW_PGRST202_SITES = 60;

const ROOT = process.cwd();
const isTest = (f: string) => /\.test\.tsx?$/.test(f) || f.startsWith("src/test/");
const app = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f));
const code = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));

describe("not-deployed checks name the RPC they judge", () => {
  it("reads the whole app (inventory floor)", () => {
    expect(app.length).toBeGreaterThan(1000);
  });

  it("src/lib/missingRpc.ts exports only isMissingRpcNamed", () => {
    const lib = code("src/lib/missingRpc.ts");
    expect([...lib.matchAll(/export\s+function\s+(\w+)/g)].map((m) => m[1])).toEqual(["isMissingRpcNamed"]);
  });

  it("every isMissingRpcNamed call names an RPC its own file calls", () => {
    const calls: string[] = [];
    const wrong: string[] = [];
    for (const f of app) {
      if (f === "src/lib/missingRpc.ts") continue;
      const src = code(f);
      const called = new Set([...src.matchAll(/\.rpc\(\s*["'`](\w+)["'`]/g)].map((m) => m[1]));
      for (const m of src.matchAll(/\bisMissingRpcNamed\(\s*[^,]+,\s*(?:["'`](\w+)["'`])?/g)) {
        calls.push(`${f}:${m[1]}`);
        if (!m[1] || !called.has(m[1])) wrong.push(`${f}: isMissingRpcNamed(…, ${m[1] ?? "<not a literal>"})`);
      }
    }
    // Floor: useFeature 1, landing 1, apply rate limit 2, thread mutes 4.
    expect(calls.length).toBeGreaterThan(7);
    expect(wrong).toEqual([]);
  });

  it(`hand-written PGRST202 comparisons are exactly ${RAW_PGRST202_SITES} (Q2190 ratchet)`, () => {
    let n = 0;
    for (const f of app) {
      if (f === "src/lib/missingRpc.ts") continue;
      n += (code(f).match(/["'`]PGRST202["'`]/g) ?? []).length;
    }
    expect(n).toBe(RAW_PGRST202_SITES);
  });
});
