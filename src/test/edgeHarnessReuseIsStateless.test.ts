/**
 * Q2811: the edge harness may evaluate a function ONCE per test file (`loadEdgeFunction(name, { reuseModule: true })`),
 * and create-payment's big test file must.
 *
 * Coverage shard 4/4 crashed at the end of src/test/edge/create-payment.test.ts on every main run (43746742812,
 * 43725796197: "Worker exited unexpectedly with exit code 1"). The file loaded create-payment (452 KB of source plus
 * its walked `_shared` modules) as a FRESH module graph 214 times, and under `--coverage` V8's block-count coverage
 * keeps every evaluated script alive until the worker ends. Reproduced locally 2026-11-15 (threads pool, 1 worker,
 * --coverage): worker exit 1 after 70 s; with reuse, 383/383 green under the same command
 * (~/.lh-shots/builder4d-1115/q2811-local-cov*.log).
 *
 * Reuse is only honest for a function that keeps no state of its own between requests, so this checks, for every
 * function a test loads with reuseModule: no top-level `let`/`var`, no top-level Map/WeakMap, and no top-level Set
 * that anything adds to or clears, in its entry and in every `_shared` module the harness walks into its graph.
 * And it proves the option really reuses (a second load evaluates nothing), so the fix cannot quietly stop working.
 */
// @mutate src/test/edge/create-payment.test.ts |   return loadEdgeFunction("create-payment", { reuseModule: true }); |   return loadEdgeFunction("create-payment");
// @mutate supabase/functions/create-payment/index.ts | const TAX_BEHAVIOR = "exclusive" as const; | let TAX_BEHAVIOR = "exclusive" as const;
// @mutate src/test/edge/harness.ts |   if (opts.reuseModule) reusedHandlers.set(fnName, handler); |   if (opts.reuseModule) void reusedHandlers;
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";
import { loadEdgeFunction } from "./edge/harness";
import { setEnv } from "./edge/mocks/deno-runtime";

const ROOT = join(__dirname, "..", "..");
const FUNCTIONS = join(ROOT, "supabase", "functions");
const HARNESS = readFileSync(join(__dirname, "edge", "harness.ts"), "utf8");
const SHARED_WALKED = JSON.parse(
  (/const SHARED_WALKED = (\[[^\]]*\]);/.exec(HARNESS)?.[1] ?? "[]").replace(/,\s*\]/, "]"),
) as string[];

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : testFiles(p);
    return /\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

/** Every `loadEdgeFunction("<name>", { reuseModule: true })` in the test tree, as [test file, function name]. */
const reusers = testFiles(join(ROOT, "src", "test")).flatMap((p) => {
  const code = blankComments(readFileSync(p, "utf8"));
  return [...code.matchAll(/loadEdgeFunction\(\s*["']([\w-]+)["']\s*,\s*\{\s*reuseModule:\s*true\s*\}\s*\)/g)].map(
    (m) => [p.slice(ROOT.length + 1), m[1]] as const,
  );
});

/** The entry plus the walked `_shared` modules reachable from it: what a load evaluates as its own copy. */
function graph(fnName: string): string[] {
  const seen = new Set<string>();
  const queue = [join(FUNCTIONS, fnName, "index.ts")];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(/from\s+["'](\.{1,2}\/[^"']+\.ts)["']/g)) {
      const spec = m[1];
      if (spec.includes("/_shared/") && !SHARED_WALKED.some((s) => spec.endsWith(s))) continue;
      queue.push(resolve(dirname(file), spec));
    }
  }
  return [...seen];
}

/** Top-level state a reused module would carry from one test into the next. */
function moduleState(file: string): string[] {
  const code = blankComments(readFileSync(file, "utf8"));
  const out: string[] = [];
  for (const m of code.matchAll(/^(?:export\s+)?(let|var)\s+(\w+)/gm)) out.push(`${m[1]} ${m[2]}`);
  for (const m of code.matchAll(/^(?:export\s+)?const\s+(\w+)(?:\s*:[^=]+)?\s*=\s*new\s+(Map|WeakMap)\b/gm)) out.push(`${m[2]} ${m[1]}`);
  for (const m of code.matchAll(/^(?:export\s+)?const\s+(\w+)(?:\s*:[^=]+)?\s*=\s*new\s+Set\b/gm)) {
    if (new RegExp(`\\b${m[1]}\\.(add|delete|clear)\\(`).test(code)) out.push(`mutated Set ${m[1]}`);
  }
  return out.map((s) => `${file.slice(ROOT.length + 1)}: ${s}`);
}

describe("Q2811 — reused edge modules hold no state, and create-payment's file reuses", () => {
  it("finds the reusers (inventory floor), create-payment's big file among them", () => {
    expect(SHARED_WALKED.length).toBeGreaterThan(5);
    expect(reusers.length).toBeGreaterThan(0);
    expect(reusers).toContainEqual(["src/test/edge/create-payment.test.ts", "create-payment"]);
  });

  it("every reused function's module graph keeps no state between requests", () => {
    const fns = [...new Set(reusers.map(([, fn]) => fn))];
    const files = fns.flatMap(graph);
    // Floor: the graph walk reads real files (create-payment + its walked _shared modules).
    expect(files.length).toBeGreaterThan(2);
    expect(files.flatMap(moduleState), "reuseModule would carry this state from one test into the next").toEqual([]);
  });

  it("a second reuseModule load evaluates nothing (the option really reuses)", async () => {
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "svc", STRIPE_SECRET_KEY: "sk_test_x" });
    const deno = await import("./edge/mocks/deno-runtime.ts");
    await loadEdgeFunction("create-payment", { reuseModule: true });
    deno.__clearHandler();
    const again = await loadEdgeFunction("create-payment", { reuseModule: true });
    // A fresh evaluation would have called serve() again and registered a handler.
    expect(deno.__getHandler(), "the second load re-evaluated create-payment").toBeFalsy();
    const res = await again.fetch(again.request({ method: "OPTIONS" }));
    expect(res.status).toBe(200);
  });
});
