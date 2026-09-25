/**
 * BR-024: deploy evidence read from the RUNNING function.
 *
 * The Management API's `version` / `ezbr_sha256` churn with no deploy for about
 * forty functions (health-check 1305 -> 1307 in nine minutes, 2026-09-22), so
 * they cannot prove what a function serves. functions-deploy.yml now stamps
 * each function's bundle with a hash of its source
 * (scripts/lib/edgeBuildStamp.mjs), `_shared/buildStamp.ts` answers an OPTIONS
 * build probe with it, and scripts/check-edge-build-stamps.mjs compares every
 * function's answer with HEAD's hash. Measured before this landed, against prod
 * on 2026-09-25: `check-edge-build-stamps.mjs --functions "health-check
 * create-payment"` exited 1 with "serving nothing (HTTP 200, no x-lh-build
 * header)" for both — prod could not say which build it runs.
 *
 * This file keeps the three parts honest:
 *   1. CLASS: every function directory (inventory from supabase/functions) is
 *      served through the wrapper, so every function can answer the probe.
 *   2. The stamp covers what the workflow deploys a function for, and nothing
 *      the deploy itself rewrites.
 *   3. The workflow stamps before EVERY deploy call and runs the check over all
 *      functions, always(), never continue-on-error.
 *
 * @mutate supabase/functions/health-check/index.ts | serve(async (req) => { | Deno.serve(async (req) => {
 * @mutate supabase/functions/stripe-webhook/index.ts | import { serve } from "../_shared/buildStamp.ts"; | import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
 * @mutate scripts/lib/edgeBuildStamp.mjs |     .filter((p) => p !== STAMP_FILE); |     ;
 * @mutate supabase/functions/_shared/buildStamp.ts |   if (req.method !== "OPTIONS" \|\| !req.headers.has(BUILD_PROBE_HEADER)) return null; |   if (!req.headers.has(BUILD_PROBE_HEADER)) return null;
 * @mutate .github/workflows/functions-deploy.yml |               node scripts/edge-build-stamp.mjs write "$fn"\n              supabase functions deploy "$fn" --project-ref "$SUPABASE_PROJECT_REF" 2>&1 |               supabase functions deploy "$fn" --project-ref "$SUPABASE_PROJECT_REF" 2>&1
 * @mutate .github/workflows/functions-deploy.yml |             if node scripts/check-edge-build-stamps.mjs --wait-seconds 120 | if node scripts/check-edge-build-stamps.mjs --functions "${{ steps.targets.outputs.functions }}" --wait-seconds 120
 */
import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import {
  BUILD_HEADER,
  BUILD_PROBE_HEADER,
  PLACEHOLDER,
  STAMP_FILE,
  compareStamps,
  expectedStamp,
  listFunctions,
  stampedFiles,
  withStamp,
  writeStamp,
} from "../../scripts/lib/edgeBuildStamp.mjs";

const ROOT = resolve(__dirname, "..", "..");
const FUNCTIONS = listFunctions(ROOT);
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/functions-deploy.yml"), "utf8");

describe("every edge function answers the build probe (class)", () => {
  it("the inventory is the directory listing, and is not empty", () => {
    expect(FUNCTIONS.length).toBeGreaterThan(60);
    expect(FUNCTIONS).not.toContain("_shared");
  });

  it.each(FUNCTIONS)("%s serves through _shared/buildStamp.ts", (fn) => {
    const file = join(ROOT, "supabase/functions", fn, "index.ts");
    expect(existsSync(file), `${fn} has no index.ts entrypoint`).toBe(true);
    const code = blankComments(readFileSync(file, "utf8"));
    expect(code, `${fn} must import serve from ../_shared/buildStamp.ts`).toMatch(
      /^import \{ serve \} from ["']\.\.\/_shared\/buildStamp\.ts["'];?$/m,
    );
    expect(code, `${fn} must call serve( at top level`).toMatch(/^serve\(/m);
    expect(code, `${fn} bypasses the wrapper with Deno.serve`).not.toMatch(/\bDeno\.serve\s*\(/);
    expect(code, `${fn} imports std's serve instead of the wrapper`).not.toMatch(/deno\.land\/std@[^"']*\/http\/server\.ts/);
  });
});

describe("the wrapper", () => {
  // A variable specifier: buildStamp.ts uses the Deno global, so it is loaded
  // at runtime by vitest rather than compiled into the app's tsconfig.
  const load = async () => {
    const spec = join(ROOT, STAMP_FILE);
    return (await import(/* @vite-ignore */ spec)) as {
      BUILD_STAMP: string;
      BUILD_HEADER: string;
      BUILD_PROBE_HEADER: string;
      buildProbeResponse: (req: Request) => Response | null;
      serve: (h: (req: Request, info: unknown) => Response | Promise<Response>) => unknown;
    };
  };

  it("agrees with the script on header names, and the committed stamp is the placeholder", async () => {
    const m = await load();
    expect(m.BUILD_HEADER).toBe(BUILD_HEADER);
    expect(m.BUILD_PROBE_HEADER).toBe(BUILD_PROBE_HEADER);
    // A committed real stamp would make every function claim that one build.
    expect(m.BUILD_STAMP).toBe(PLACEHOLDER);
  });

  it("answers only an OPTIONS request that carries the probe header", async () => {
    const m = await load();
    const probe = m.buildProbeResponse(new Request("https://x/f", { method: "OPTIONS", headers: { [BUILD_PROBE_HEADER]: "1" } }));
    expect(probe?.status).toBe(204);
    expect(probe?.headers.get(BUILD_HEADER)).toBe(m.BUILD_STAMP);
    expect(m.buildProbeResponse(new Request("https://x/f", { method: "OPTIONS" }))).toBeNull();
    // A POST with the header is a real request: it must reach the handler.
    expect(m.buildProbeResponse(new Request("https://x/f", { method: "POST", headers: { [BUILD_PROBE_HEADER]: "1" } }))).toBeNull();
  });

  it("never runs the function's handler for a probe, and runs it for everything else", async () => {
    const m = await load();
    let captured: ((req: Request, info: unknown) => Response | Promise<Response>) | null = null;
    const g = globalThis as unknown as { Deno?: unknown };
    const before = g.Deno;
    g.Deno = { serve: (h: typeof captured) => (captured = h) };
    try {
      let calls = 0;
      m.serve(() => {
        calls++;
        return new Response("handled");
      });
      expect(captured).not.toBeNull();
      const probed = await captured!(new Request("https://x/f", { method: "OPTIONS", headers: { [BUILD_PROBE_HEADER]: "1" } }), {});
      expect(probed.headers.get(BUILD_HEADER)).toBe(m.BUILD_STAMP);
      expect(calls).toBe(0);
      const real = await captured!(new Request("https://x/f", { method: "OPTIONS" }), {});
      expect(await real.text()).toBe("handled");
      expect(calls).toBe(1);
    } finally {
      g.Deno = before;
    }
  });
});

describe("the stamp", () => {
  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), "lh-stamp-"));
    for (const p of ["supabase/functions/a", "supabase/functions/b", "supabase/functions/_shared"]) mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, "supabase/functions/a/index.ts"), "a1");
    writeFileSync(join(dir, "supabase/functions/b/index.ts"), "b1");
    writeFileSync(join(dir, "supabase/functions/_shared/lib.ts"), "s1");
    cpSync(join(ROOT, STAMP_FILE), join(dir, STAMP_FILE));
    return dir;
  }

  it("moves when the function or _shared changes, not when another function or the stamp file does", () => {
    const dir = fixture();
    try {
      const a0 = expectedStamp(dir, "a");
      expect(a0).toMatch(/^a@[0-9a-f]{16}$/);
      expect(expectedStamp(dir, "b")).not.toBe(a0.replace(/^a/, "b"));

      writeFileSync(join(dir, "supabase/functions/b/index.ts"), "b2");
      expect(expectedStamp(dir, "a")).toBe(a0);

      writeStamp(dir, "a");
      expect(readFileSync(join(dir, STAMP_FILE), "utf8")).toContain(`export const BUILD_STAMP = "${a0}";`);
      expect(expectedStamp(dir, "a"), "writing the stamp must not change the stamp").toBe(a0);

      writeFileSync(join(dir, "supabase/functions/_shared/lib.ts"), "s2");
      const a1 = expectedStamp(dir, "a");
      expect(a1).not.toBe(a0);
      writeFileSync(join(dir, "supabase/functions/a/nested.ts"), "n");
      expect(expectedStamp(dir, "a")).not.toBe(a1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("covers the function's own files and _shared, excluding the stamp file (real repo)", () => {
    const files = stampedFiles(ROOT, "create-payment");
    expect(files).toContain("supabase/functions/create-payment/index.ts");
    expect(files).toContain("supabase/functions/_shared/money.ts");
    expect(files).not.toContain(STAMP_FILE);
    expect(files.some((f) => f.startsWith("supabase/functions/health-check/"))).toBe(false);
  });

  it("the writer refuses a stamp file it cannot rewrite exactly once, and unsafe values", () => {
    const one = 'x\nexport const BUILD_STAMP = "unstamped";\ny';
    expect(withStamp(one, "a@0123")).toContain('export const BUILD_STAMP = "a@0123";');
    expect(() => withStamp("nothing here", "a@1")).toThrow(/exactly one/);
    expect(() => withStamp(`${one}\n${one}`, "a@1")).toThrow(/exactly one/);
    expect(() => withStamp(one, 'a"; evil()')).toThrow(/unsafe/);
  });

  it("grades a missing header, a wrong build and an unprobed function as mismatches", () => {
    const r = compareStamps({ a: "a@1", b: "b@1", c: "c@1", d: "d@1" }, { a: "a@1", b: null, c: "c@0" });
    expect(r.ok).toEqual(["a"]);
    expect(r.mismatched.map((m) => m.fn)).toEqual(["b", "c", "d"]);
  });
});

describe("functions-deploy.yml wiring", () => {
  it("stamps the function immediately before every deploy call", () => {
    const lines = WORKFLOW.split("\n");
    const deploys = lines.map((l, i) => [l, i] as const).filter(([l]) => /^\s*(if\s+)?supabase functions deploy\b/.test(l));
    expect(deploys.length).toBeGreaterThanOrEqual(3);
    for (const [l, i] of deploys) {
      const prev = lines.slice(Math.max(0, i - 3), i).join("\n");
      expect(prev, `no stamp before: ${l.trim()}`).toMatch(/node scripts\/edge-build-stamp\.mjs write "\$fn"/);
    }
  });

  it("checks EVERY function's build, always(), never continue-on-error", () => {
    const at = WORKFLOW.indexOf("- name: Verify every function serves HEAD's build");
    expect(at).toBeGreaterThan(-1);
    const next = WORKFLOW.indexOf("\n      - name:", at + 1);
    const step = WORKFLOW.slice(at, next < 0 ? undefined : next);
    expect(step).toMatch(/if: always\(\) && /);
    expect(step).not.toMatch(/continue-on-error/);
    const call = step.match(/node scripts\/check-edge-build-stamps\.mjs[^\n]*/)?.[0] ?? "";
    expect(call).not.toBe("");
    expect(call, "the check must cover every function, not only this run's targets").not.toContain("--functions");
    // It runs after the deploy steps, so it reads what they left behind.
    expect(at).toBeGreaterThan(WORKFLOW.indexOf("- name: Verify every deploy actually landed"));
  });
});
