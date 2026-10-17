/**
 * THE NETWORK GATE (lead, 2026-10-17). The prod press sweep decides which
 * presses are mutating from words and markers (DESTRUCTIVE_RX, data-commit,
 * ...). A control that writes with words no list knows (a direct write, no
 * confirm) was pressed ungated; "End series" / "Leave series" were the case
 * that surfaced it (Q?press-irreversible-commits). Words are now the
 * optimisation and the network is the guarantee: while a press the gate did
 * NOT class as mutating is in flight, every write it sets off on
 * /rest|functions|storage/v1 is aborted in the browser before it leaves,
 * recorded as a GATE MISS with the control's label and route, and the run
 * fails naming each one.
 *
 * This test fails when an unclassified press's write would get through:
 * - networkGate itself: armed, a write is aborted and counted, never passed on;
 * - pressWriteKind: every write the app's own source can make (each
 *   supabase.from(t).insert/update/upsert/delete table, each functions.invoke
 *   name) classifies as a write or a named side effect, never a read, bar the
 *   exact PRESS_READ_FUNCTIONS; both exception lists are two-way;
 * - the wiring: the gate is on the context after the Stripe and CAPTCHA
 *   routes, armed before every ungated press and replayed opener, its verdict
 *   fails the press, and any miss fails the run.
 *
 * @mutate scripts/audit/press-every-control.mjs |       if (!armed \|\| kind === "read") return route.fallback(); |       return route.fallback();
 * @mutate scripts/audit/press-every-control.mjs |           if (!entry.mutating) netGate.arm();\n | \n
 * @mutate scripts/audit/press-every-control.mjs |       await ctx.route(PRESS_WRITE_SURFACE_RX, netGate.handler); |
 * @mutate scripts/audit/press-every-control.mjs |   if (gateMisses.length > 0 \|\| failedPresses > 0 | if (failedPresses > 0
 * @mutate scripts/audit/pressProdSafety.mjs |   return "write";\n} |   return "read";\n}
 * @mutate scripts/audit/pressProdSafety.mjs | export const PRESS_WRITE_SURFACE_RX = /\/(rest\|functions\|storage)\/v1\//; | export const PRESS_WRITE_SURFACE_RX = /\/(rest)\/v1\//;
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";
import { isReadRpcPath } from "../../e2e/readRpc";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";

const ROOT = resolve(__dirname, "..", "..");
const BASE = "https://fncmgoasalhdgfwzhsqa.supabase.co";
type Kind = "read" | "side-effect" | "write";
const kind = (method: string, path: string, body: string | null = null): Kind =>
  safety.pressWriteKind({ method, url: `${BASE}${path}`, body });

/** A Playwright route + request stand-in that records what the handler did with it. */
function fake(method: string, path: string, body: string | null = null) {
  const route = { fallback: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
  const req = { method: () => method, url: () => `${BASE}${path}`, postData: () => body };
  return { route, req };
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

/** The app's own write call sites: tables written through PostgREST and edge functions invoked. */
function appWrites(): { tables: Set<string>; functions: Set<string>; rpcs: Set<string> } {
  const tables = new Set<string>(), functions = new Set<string>(), rpcs = new Set<string>();
  for (const f of sourceFiles(resolve(ROOT, "src"))) {
    const src = blankComments(readFileSync(f, "utf8"));
    for (const m of src.matchAll(/\.from\(\s*"([a-z0-9_]+)"\s*\)/g)) {
      const tail = src.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 400).split(";")[0];
      if (/^\s*\.(insert|update|upsert|delete)\(/.test(tail)) tables.add(m[1]);
    }
    for (const m of src.matchAll(/functions\.invoke\(\s*"([a-z0-9-]+)"/g)) functions.add(m[1]);
    for (const m of src.matchAll(/\.rpc\(\s*"([a-z0-9_]+)"/g)) rpcs.add(m[1]);
  }
  return { tables, functions, rpcs };
}

describe("the press sweep's network gate aborts every write an ungated press sets off", () => {
  it("armed: a write is aborted and recorded as a gate miss, never passed on", async () => {
    const gate = harness.networkGate();
    gate.arm();
    const w = fake("POST", "/rest/v1/rpc/end_recurring_series", '{"p_job_id":"x"}');
    await gate.handler(w.route, w.req);
    expect(w.route.abort).toHaveBeenCalledTimes(1);
    expect(w.route.fallback).not.toHaveBeenCalled();
    const p = fake("PATCH", "/rest/v1/profiles?user_id=eq.x", "{}");
    await gate.handler(p.route, p.req);
    expect(p.route.abort).toHaveBeenCalledTimes(1);
    expect(gate.disarm()).toEqual({ misses: ["POST /rest/v1/rpc/end_recurring_series", "PATCH /rest/v1/profiles"], sideEffects: [] });
  });

  it("armed: reads pass; a side effect is aborted but is not a miss", async () => {
    const gate = harness.networkGate();
    gate.arm();
    for (const [m, path] of [["GET", "/rest/v1/jobs?id=eq.1"], ["POST", "/rest/v1/rpc/get_safe_profiles"], ["POST", "/storage/v1/object/sign/avatars/a.png"]] as const) {
      const r = fake(m, path);
      await gate.handler(r.route, r.req);
      expect(r.route.fallback, `${m} ${path}`).toHaveBeenCalledTimes(1);
      expect(r.route.abort).not.toHaveBeenCalled();
    }
    const v = fake("POST", "/rest/v1/rpc/record_job_view", '{"p_job_id":"x"}');
    await gate.handler(v.route, v.req);
    expect(v.route.abort).toHaveBeenCalledTimes(1);
    expect(gate.disarm()).toEqual({ misses: [], sideEffects: ["POST /rest/v1/rpc/record_job_view"] });
  });

  it("disarmed (a gated press, or between presses): every request falls through", async () => {
    const gate = harness.networkGate();
    const w = fake("DELETE", "/rest/v1/jobs?id=eq.1");
    await gate.handler(w.route, w.req);
    expect(w.route.fallback).toHaveBeenCalledTimes(1);
    expect(w.route.abort).not.toHaveBeenCalled();
    gate.arm();
    expect(gate.disarm().misses).toEqual([]);
    const again = fake("POST", "/rest/v1/jobs");
    await gate.handler(again.route, again.req);
    expect(again.route.fallback).toHaveBeenCalledTimes(1);
  });

  it("pressWriteKind: methods, surfaces and the named exceptions", () => {
    expect(kind("GET", "/rest/v1/jobs")).toBe("read");
    expect(kind("POST", "/rest/v1/jobs")).toBe("write");
    expect(kind("PATCH", "/rest/v1/profiles")).toBe("write");
    expect(kind("DELETE", "/rest/v1/saved_searches")).toBe("write");
    expect(kind("POST", "/rest/v1/rpc/get_ranked_open_jobs")).toBe("read");
    expect(kind("POST", "/rest/v1/rpc/get_helper_earnings_export")).toBe("write"); // read-named but VOLATILE
    expect(kind("POST", "/rest/v1/rpc/end_recurring_series")).toBe("write");
    expect(kind("POST", "/rest/v1/error_logs")).toBe("side-effect");
    expect(kind("POST", "/functions/v1/stripe-connect", '{"action":"status"}')).toBe("read");
    expect(kind("POST", "/functions/v1/stripe-connect", '{"action":"onboard"}')).toBe("write");
    expect(kind("POST", "/functions/v1/create-payment", "{}")).toBe("write");
    expect(kind("POST", "/functions/v1/calculate-tax", "{}")).toBe("read");
    expect(kind("POST", "/storage/v1/object/list/avatars")).toBe("read");
    expect(kind("POST", "/storage/v1/object/avatars/me.png")).toBe("write");
    expect(kind("POST", "/auth/v1/token?grant_type=refresh_token")).toBe("read"); // out of scope: session refresh
    expect(safety.pressWriteKind({ method: "POST", url: "not a url" })).toBe("write");
  });

  it("every write the app's source can make is a write (or a named side effect) to the gate", () => {
    const { tables, functions, rpcs } = appWrites();
    // Inventory floors, measured on this branch 2026-10-17.
    expect(tables.size).toBeGreaterThan(35); // 39
    expect(functions.size).toBeGreaterThan(28); // 32
    expect(rpcs.size).toBeGreaterThan(150); // 166
    const leaks: string[] = [];
    for (const t of tables) {
      for (const m of ["POST", "PATCH", "DELETE"]) if (kind(m, `/rest/v1/${t}`) === "read") leaks.push(`${m} ${t}`);
    }
    for (const fn of functions) {
      if (kind("POST", `/functions/v1/${fn}`, "{}") === "read" && !(fn in safety.PRESS_READ_FUNCTIONS)) leaks.push(`invoke ${fn}`);
    }
    for (const name of rpcs) {
      // A read-named RPC is a read by the convention src/test/readNamedRpcsAreNotVolatile.test.ts holds to pg_proc.
      if (!isReadRpcPath(`/rest/v1/rpc/${name}`) && kind("POST", `/rest/v1/rpc/${name}`) === "read") leaks.push(`rpc ${name}`);
    }
    expect(leaks).toEqual([]);
  });

  it("the exception lists are exact: each names something the app really calls", () => {
    const { tables, functions, rpcs } = appWrites();
    for (const fn of Object.keys(safety.PRESS_READ_FUNCTIONS)) expect(functions.has(fn), `PRESS_READ_FUNCTIONS ${fn} is invoked nowhere in src/`).toBe(true);
    for (const path of Object.keys(safety.PRESS_SIDE_EFFECT_WRITES)) {
      const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(path)?.[1];
      const table = /^\/rest\/v1\/([a-z0-9_]+)$/.exec(path)?.[1];
      if (rpc) expect(rpcs.has(rpc), `side effect ${path} is called nowhere`).toBe(true);
      else if (table === "error_logs") expect(readFileSync(resolve(ROOT, "src/lib/errorLogger.ts"), "utf8")).toMatch(/from\("error_logs"\)\.insert/);
      else expect(table && tables.has(table), `side effect ${path} is written nowhere`).toBe(true);
    }
  });

  it("the harness wires it: on the context after the backstops, armed around every ungated press and replayed opener, and a miss fails the press and the run", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    const gateAt = src.indexOf("await ctx.route(PRESS_WRITE_SURFACE_RX, netGate.handler);");
    expect(gateAt).toBeGreaterThan(src.indexOf('await ctx.route("**/functions/v1/**"'));
    expect(gateAt).toBeGreaterThan(src.indexOf('await ctx.route("**/auth/v1/**"'));
    expect(gateAt).toBeLessThan(src.indexOf("const page = await ctx.newPage();"));
    const arm = src.indexOf("          if (!entry.mutating) netGate.arm();\n");
    expect(arm).toBeGreaterThan(0);
    expect(src.indexOf("await target.click({ timeout: PRESS_TIMEOUT });", arm)).toBeGreaterThan(arm);
    expect(src).toMatch(/if \(!step\.mutating\) netGate\.arm\(\);\n\s*await loc\.first\(\)\.click/);
    expect(src).toMatch(/const nextChain = \[\.\.\.chain, \{ \.\.\.item\.step, label, mutating: !!entry\.mutating \}\];/);
    expect(src).toMatch(/const watched = netGate\.disarm\(\);[\s\S]{0,300}if \(watched\.misses\.length\) \{[\s\S]{0,200}gateMisses\.push\(/);
    expect(src).toMatch(/entry\.why = `\$\{GATE_MISS\}:/);
    expect(src).toMatch(/if \(gateMisses\.length > 0 \|\| failedPresses > 0/);
  });
});
