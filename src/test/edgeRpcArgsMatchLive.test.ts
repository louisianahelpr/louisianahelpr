/*
 * Q1418 (b): scripts/check-edge-rpcs-live.mjs matches the ARGUMENT names of
 * every edge-function `.rpc("<name>", {...})` call, not only the name.
 *
 * PostgREST resolves an RPC by name and by the named arguments in the body. If
 * db-deploy failed while functions-deploy shipped, create-payment would send
 * p_retired_session to the old 3-argument redeem_gift_card and every gift tap
 * would answer PGRST202, while a names-only check stayed green. Measured
 * 2026-10-12 against prod's catalog: 94 calls, 0 rejected; against the same
 * catalog with redeem_gift_card's old (p_credit_id, p_job_id, p_user_id)
 * signature, exactly create-payment's call is rejected.
 */

// @mutate scripts/lib/rpcCallArgs.mjs |     if (!keys.every((k) => names.has(k))) return false; |
// @mutate scripts/lib/rpcCallArgs.mjs |     return o.args.slice(0, o.required).every((a) => given.has(a)); |     return true;
// @mutate scripts/lib/rpcCallArgs.mjs |       if (!km \|\| entry.startsWith("...")) { keys = null; break; } |       if (!km) continue;
// @mutate scripts/check-edge-rpcs-live.mjs | if (badArgs.length && !missing.length) process.exit(1); |

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readdirSync, statSync } from "node:fs";
import { extractRpcCalls, overloadAccepts } from "../../scripts/lib/rpcCallArgs.mjs";

const ROOT = resolve(__dirname, "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("edge RPC calls are checked by argument name (Q1418 b)", () => {
  it("reads the keys of a call, and says null when the source does not", () => {
    const src = `
      await db.rpc("a", { p_x: 1, p_y: f({ z: 2 }, [3, 4]), // note, with a comma
        "p_q": \`t\${ {k: 1}.k }\`, p_short });
      await db.rpc("b");
      await db.rpc("c", args);
      await db.rpc("d", { ...rest, p_x: 1 });
      await db.rpc("e", /* none */ {});`;
    expect(extractRpcCalls(src)).toEqual([
      { name: "a", keys: ["p_x", "p_y", "p_q", "p_short"] },
      { name: "b", keys: [] },
      { name: "c", keys: null },
      { name: "d", keys: null },
      { name: "e", keys: [] },
    ]);
  });

  it("accepts a call only when some overload takes exactly those names", () => {
    const old = [{ args: ["p_credit_id", "p_job_id", "p_user_id"], required: 3 }];
    const now = [{ args: ["p_credit_id", "p_job_id", "p_user_id", "p_retired_session"], required: 3 }];
    const call = ["p_credit_id", "p_job_id", "p_user_id", "p_retired_session"];
    expect(overloadAccepts(call, old)).toBe(false);
    expect(overloadAccepts(call, now)).toBe(true);
    expect(overloadAccepts(["p_credit_id", "p_job_id", "p_user_id"], now)).toBe(true);
    // A required argument left out is refused too.
    expect(overloadAccepts(["p_credit_id", "p_job_id"], now)).toBe(false);
    expect(overloadAccepts(["p_credit_id", "p_job_id"], [...old, ...now])).toBe(false);
    // A lone unnamed json argument takes the whole body.
    expect(overloadAccepts(["anything"], [{ args: [""], required: 1, types: ["jsonb"] }])).toBe(true);
  });

  it("covers the real edge functions: create-payment's redeem call carries p_retired_session", () => {
    const calls = walk(join(ROOT, "supabase", "functions")).flatMap((f) =>
      extractRpcCalls(readFileSync(f, "utf8")).map((c) => ({ ...c, f })),
    );
    // Measured 2026-10-12: 94 calls, every one with keys the source spells out.
    expect(calls.length).toBeGreaterThan(80);
    expect(calls.filter((c) => c.keys !== null).length).toBeGreaterThan(80);
    const redeem = calls.find((c) => c.name === "redeem_gift_card" && c.f.endsWith("create-payment/index.ts"));
    expect(redeem?.keys).toContain("p_retired_session");
  });

  it("the deploy gate reads overloads and fails on a call no overload accepts", () => {
    const script = readFileSync(join(ROOT, "scripts", "check-edge-rpcs-live.mjs"), "utf8");
    expect(script).toContain('from "./lib/rpcCallArgs.mjs"');
    expect(script).toContain("AS overloads");
    expect(script).toContain("if (badArgs.length && !missing.length) process.exit(1);");
  });
});
