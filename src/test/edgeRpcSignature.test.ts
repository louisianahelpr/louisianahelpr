/**
 * Q1418 (b) (lh-money-escrow review, 2026-10-06): scripts/check-edge-rpcs-live.mjs
 * matched RPC NAMES only. PostgREST resolves an RPC by its parameter NAMES, so
 * a deploy where db-deploy failed while functions-deploy shipped a create-payment
 * that sends p_retired_session to the old 3-argument redeem_gift_card answered
 * PGRST202 on every gift tap, and the check said OK. It now also matches each
 * call's literal argument names against the live overloads
 * (scripts/lib/edgeRpcSignature.mjs; measured live 2026-10-07: 43 names, OK,
 * and --inject-arg-mismatch exits 1).
 *
 * @mutate scripts/lib/edgeRpcSignature.mjs |     return keys.every((k) => args.includes(k)) && required.every((a) => keys.includes(a)); |     return true;
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { callMatches, objectKeys, rpcCalls, signatureMismatches } from "../../scripts/lib/edgeRpcSignature.mjs";

const ROOT = resolve(__dirname, "../..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const callsByFile = new Map(
  walk(join(ROOT, "supabase/functions")).map((f) => [relative(ROOT, f), rpcCalls(readFileSync(f, "utf8"))] as const),
);
const all = [...callsByFile.values()].flat();

describe("Q1418 (b): edge RPC calls are matched by argument NAMES", () => {
  it("inventory: every .rpc call in supabase/functions is read, with literal keys (floor)", () => {
    expect(all.length).toBeGreaterThan(60);
    // A call whose arguments are not a literal object cannot be checked; none exist today.
    expect(all.filter((c) => c.keys === null).map((c) => c.name)).toEqual([]);
    const redeem = all.find((c) => c.name === "redeem_gift_card");
    expect(redeem?.keys).toEqual(["p_credit_id", "p_job_id", "p_user_id", "p_retired_session"]);
  });

  it("a call sending a parameter the live overload lacks is a mismatch (the gift-tap PGRST202)", () => {
    const old3 = new Map([["redeem_gift_card", [{ args: ["p_credit_id", "p_job_id", "p_user_id"], ndefaults: 0 }]]]);
    const new4 = new Map([["redeem_gift_card", [{ args: ["p_credit_id", "p_job_id", "p_user_id", "p_retired_session"], ndefaults: 1 }]]]);
    const only = new Map([...callsByFile].map(([f, cs]) => [f, cs.filter((c) => c.name === "redeem_gift_card")] as const));
    expect(signatureMismatches(only, old3).map((m) => m.name)).toEqual(["redeem_gift_card"]);
    expect(signatureMismatches(only, new4)).toEqual([]);
  });

  it("required parameters must be given; defaulted ones may be left out; an unknown key never matches", () => {
    const ov = [{ args: ["_job_id", "_action", "_admin_id"], ndefaults: 1 }];
    expect(callMatches(["_job_id", "_action"], ov)).toBe(true);
    expect(callMatches(["_job_id", "_action", "_admin_id"], ov)).toBe(true);
    expect(callMatches(["_job_id"], ov)).toBe(false);
    expect(callMatches(["_job_id", "_action", "zz"], ov)).toBe(false);
    expect(callMatches([], [{ args: [], ndefaults: 0 }])).toBe(true);
  });

  it("objectKeys reads shorthand, quoted and nested values, and gives up on a spread", () => {
    expect(objectKeys(` a: 1, b, "c": { d: [1, 2] }, e: f(g, h) `)).toEqual(["a", "b", "c", "e"]);
    expect(objectKeys(` ...rest, a: 1 `)).toBeNull();
  });
});
