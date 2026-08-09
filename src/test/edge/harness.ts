/// <reference types="node" />
/**
 * Edge-function test harness.
 *
 * Supabase edge functions run under Deno: they import from `https://deno.land`,
 * `https://esm.sh`, and `npm:` specifiers, use the `Deno` global, and call
 * `serve(handler)` at module scope. None of that runs under vitest/jsdom
 * directly.
 *
 * This harness makes them testable WITHOUT modifying production source
 * (the test task is strictly additive):
 *
 *   1. Read the function's `index.ts` from `supabase/functions/<name>/`, then
 *      follow its LOCAL relative imports (`./context.ts`, `../constants.ts`,
 *      `./handlers/*.ts`) breadth-first so a multi-file function is bundled in
 *      full — not just its entry point.
 *   2. For each module, rewrite its Deno/npm/esm imports to point at the local
 *      mock modules in `./mocks/`, rewrite `_shared/*` imports likewise (at any
 *      `../` depth), and rewrite each intra-function local specifier to the
 *      flat `.gen.ts` sibling that module was emitted as.
 *   3. Write every rewritten module to a temp `.gen.ts` file inside this
 *      directory so vitest's own TypeScript transform compiles it, and so the
 *      `./mocks/*` + `./<sibling>.gen.ts` specifiers all resolve from one dir.
 *   4. Dynamically `import()` the ENTRY temp module (its static imports pull in
 *      the rest of the graph). A mock `serve()` (injected via the rewrite)
 *      captures the request handler.
 *   5. Hand the test a `fetch`-style callable plus the env + mocks.
 *
 * The function's REAL branching logic (auth checks, ownership checks, charge /
 * release / revision / refund branches, signature handling) runs unchanged —
 * only its external dependencies are swapped for inspectable doubles.
 */
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

/** This file's own directory — `import.meta.url` is portable under vitest. */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const FUNCTIONS_DIR = join(REPO_ROOT, "supabase", "functions");

/** Mock-module specifiers, resolved relative to a `.gen.ts` in THIS dir. */
const MOCK = {
  stripe: "./mocks/stripe.ts",
  supabase: "./mocks/supabase.ts",
  shared: "./mocks/shared.ts",
  deno: "./mocks/deno-runtime.ts",
};

/**
 * Rewrites an edge-function module's EXTERNAL imports (Deno/npm/esm/`_shared`)
 * to the test doubles. Intra-function local imports are handled separately by
 * the bundler in `loadEdgeFunction`. `type`-only variants (`import type Stripe`,
 * `import type { SupabaseClient }`) are matched too — they're erased by the TS
 * transform, but rewriting keeps their specifiers resolvable and consistent.
 */
function rewriteExternalImports(src: string): string {
  let out = src;

  // Stripe: `import Stripe from "https://esm.sh/stripe@..."`
  // (also the `import type Stripe from ...` form used by context + handlers).
  out = out.replace(
    /import\s+(type\s+)?Stripe\s+from\s+["']https:\/\/esm\.sh\/stripe@[^"']+["'];?/g,
    `import $1Stripe from "${MOCK.stripe}";`,
  );

  // supabase-js: `import { createClient } from "npm:@supabase/supabase-js@2"`
  // (also `import type { SupabaseClient } from ...`).
  out = out.replace(
    /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']npm:@supabase\/supabase-js@[^"']+["'];?/g,
    `import $1{$2} from "${MOCK.supabase}";`,
  );

  // serve: `import { serve } from "https://deno.land/std@.../http/server.ts"`
  // Drop the import entirely — `serve` is provided as a harness global below.
  out = out.replace(
    /import\s+\{\s*serve\s*\}\s+from\s+["']https:\/\/deno\.land\/[^"']+["'];?/g,
    "",
  );

  // Shared helpers: `_shared/rate-limit.ts`, `_shared/slack-alerts.ts`,
  // `_shared/cors.ts`, `_shared/appUrl.ts`, `_shared/pifGiftEmail.ts` — at ANY
  // `../` depth (index.ts uses `../_shared/...`; nested handlers use
  // `../../_shared/...`). pifGiftEmail does network I/O (Resend), so it's
  // mocked network-free like slack-alerts rather than pointed at the real file.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/(rate-limit|slack-alerts|cors|appUrl|pifGiftEmail)\.ts["'];?/g,
    `import {$1} from "${MOCK.shared}";`,
  );

  // Tiered fee resolver: `_shared/helperFees.ts` is pure TypeScript (it takes
  // the Supabase client as a param and has no Deno/remote imports), so point
  // the generated file at the REAL module — relative to a `.gen.ts` in THIS
  // dir (src/test/edge) — instead of a mock. The live ladder logic stays under
  // test; with no subscription row in the mocked client it falls back to the
  // caller's prior fee, so existing fee assertions hold unchanged. Matched at
  // any `../` depth for parity with the block above.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/helperFees\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/helperFees.ts";`,
  );

  // Stripe processing-cost floor: `_shared/stripeFees.ts` is likewise pure
  // TypeScript (plain constants + arithmetic, no Deno/remote imports), so the
  // generated file points at the REAL module — the actual withholding math the
  // refund paths use stays under test rather than being mocked away.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/stripeFees\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/stripeFees.ts";`,
  );

  // Poster tier service fee + Stripe floor: `_shared/posterFees.ts` is pure
  // TypeScript too (it only re-exports the helper ladder + the floor helper), so
  // the generated file points at the REAL module — the poster fee the checkout
  // charges stays under test rather than being mocked away.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/posterFees\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/posterFees.ts";`,
  );

  // Admin-id fan-out for ops alerts: `_shared/adminIds.ts` takes the supabase
  // client as an argument and has no module-scope Deno imports, so the
  // generated file points at the REAL module. That keeps the "did we actually
  // notify an admin?" behaviour under test — the whole point of the helper is
  // that a failed lookup must be loud rather than an empty array, and mocking
  // it away would hide exactly that.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/adminIds\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/adminIds.ts";`,
  );

  // Business seat fee ladder: `_shared/seatTierGrant.ts` is pure TypeScript
  // (plain lookup tables + one pure function), so the generated file points at
  // the REAL module. The commission a seat plan actually buys stays under test
  // rather than being mocked away — same rationale as helperFees/posterFees.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/seatTierGrant\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/seatTierGrant.ts";`,
  );

  return out;
}

/**
 * The harness preamble, prepended ONLY to the entry module: a `serve` that
 * records the handler and a `Deno` global backed by a test-controlled env map.
 */
const HARNESS_PREAMBLE = `
import { __registerHandler as __hReg, __denoStub as Deno } from "${MOCK.deno}";
const serve = (h) => __hReg(h);
`;

/** True for an intra-function local module import (`./x.ts`, `../y.ts`) that is
 * NOT a `_shared/*` helper (those are mocked/aliased by external rewriting). */
function isLocalModuleSpecifier(spec: string): boolean {
  return (
    (spec.startsWith("./") || spec.startsWith("../")) &&
    spec.endsWith(".ts") &&
    !spec.includes("/_shared/")
  );
}

export interface EdgeHarness {
  /** Invoke the function like an HTTP request. */
  fetch: (req: Request) => Promise<Response>;
  /** Build a Request with sane defaults for this function. */
  request: (init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    rawBody?: string;
    url?: string;
  }) => Request;
}

/** A module in the function's local graph, emitted as a flat `.gen.ts`. */
interface GenModule {
  /** Absolute path of the original source module. */
  absPath: string;
  /** Flat filename it's emitted as inside HERE (sibling to `./mocks/`). */
  genName: string;
}

/**
 * Load an edge function and return a harness to drive it.
 *
 * Follows the entry's LOCAL relative imports breadth-first, flattening the
 * whole module graph into sibling `.gen.ts` files so a multi-file function
 * (entry + `context.ts` + `constants.ts` + `handlers/*.ts`) is fully bundled.
 *
 * @param fnName  Directory name under `supabase/functions/`.
 */
export async function loadEdgeFunction(fnName: string): Promise<EdgeHarness> {
  const entryPath = join(FUNCTIONS_DIR, fnName, "index.ts");
  const runId = randomBytes(4).toString("hex");

  // Dedupe by absolute path so a module imported by many handlers
  // (e.g. `context.ts`) is emitted exactly once and every specifier that
  // points at it rewrites to the same flat gen filename.
  const byAbs = new Map<string, GenModule>();
  let counter = 0;
  const register = (absPath: string): GenModule => {
    const existing = byAbs.get(absPath);
    if (existing) return existing;
    const base = basename(absPath).replace(/\.ts$/, "");
    const mod: GenModule = {
      absPath,
      genName: `${fnName}.${runId}.${counter++}_${base}.gen.ts`,
    };
    byAbs.set(absPath, mod);
    return mod;
  };

  const entry = register(entryPath);
  const queue: GenModule[] = [entry];
  const written: string[] = [];

  // BFS the local import graph, rewriting each module's specifiers and
  // collecting its emitted source. Nothing is written until the whole graph
  // is walked so gen filenames are stable across cross-references.
  const toWrite: Array<{ genName: string; source: string }> = [];
  while (queue.length > 0) {
    const mod = queue.shift()!;
    const dir = dirname(mod.absPath);
    let src = readFileSync(mod.absPath, "utf8");

    // Collect local specifiers from the ORIGINAL source, BEFORE external
    // rewriting introduces `./mocks/*.ts` specifiers we must not treat as
    // local graph modules.
    const localSpecs = new Set<string>();
    for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
      if (isLocalModuleSpecifier(m[1])) localSpecs.add(m[1]);
    }

    // Rewrite each local specifier to its flat gen sibling, enqueueing any
    // module we haven't seen yet.
    for (const spec of localSpecs) {
      const depAbs = resolve(dir, spec);
      const isNew = !byAbs.has(depAbs);
      const depMod = register(depAbs);
      if (isNew) queue.push(depMod);
      // `split().join()` is a target-lib-safe literal replace-all (no
      // `String.prototype.replaceAll`, which needs ES2021).
      src = src
        .split(`"${spec}"`)
        .join(`"./${depMod.genName}"`)
        .split(`'${spec}'`)
        .join(`'./${depMod.genName}'`);
    }

    src = rewriteExternalImports(src);
    // Only the entry calls `serve()` / reads `Deno` — inject the preamble there.
    if (mod === entry) src = HARNESS_PREAMBLE + src;

    toWrite.push({ genName: mod.genName, source: src });
  }

  // Write into THIS directory (NOT a subdir) so relative `./mocks/*` and
  // `./<sibling>.gen.ts` specifiers resolve, and vitest applies its TypeScript
  // transform on import. The `.gen.` infix is git-ignored. All files must be on
  // disk before the entry is imported, since its static imports pull them in.
  for (const { genName, source } of toWrite) {
    const p = join(HERE, genName);
    writeFileSync(p, source, "utf8");
    written.push(p);
  }

  // Reset the captured handler before importing so each load is isolated.
  const deno = await import("./mocks/deno-runtime.ts");
  deno.__clearHandler();

  const entryGenPath = join(HERE, entry.genName);
  try {
    // `?t=` cache-bust so repeated loads in one process re-evaluate the module.
    await import(/* @vite-ignore */ `${entryGenPath}?t=${Date.now()}`);
  } finally {
    // The graph has been evaluated + cached by vite; the temp files are no
    // longer needed on disk.
    for (const p of written) rmSync(p, { force: true });
  }

  const handler = deno.__getHandler();
  if (!handler) {
    throw new Error(
      `Edge function "${fnName}" did not call serve() — no handler captured`,
    );
  }

  return {
    fetch: (req: Request) => Promise.resolve(handler(req)),
    request: (init = {}) => {
      const headers = new Headers(init.headers ?? {});
      let body: string | undefined;
      if (init.rawBody !== undefined) {
        body = init.rawBody;
      } else if (init.body !== undefined) {
        body = JSON.stringify(init.body);
        if (!headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }
      }
      return new Request(init.url ?? "https://edge.test/fn", {
        method: init.method ?? "POST",
        headers,
        body,
      });
    },
  };
}
