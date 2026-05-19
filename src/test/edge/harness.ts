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
 *   1. Read the function's `index.ts` from `supabase/functions/<name>/`.
 *   2. Rewrite its Deno/npm/esm imports to point at the local mock modules
 *      in `./mocks/`, and rewrite `../_shared/*` imports likewise.
 *   3. Write the rewritten source to a temp `.gen.ts` file inside this
 *      directory so vitest's own TypeScript transform compiles it.
 *   4. Dynamically `import()` the temp module. A mock `serve()` (injected via
 *      the rewrite) captures the request handler.
 *   5. Hand the test a `fetch`-style callable plus the env + mocks.
 *
 * The function's REAL branching logic (auth checks, ownership checks, charge /
 * release / revision / refund branches, signature handling) runs unchanged —
 * only its external dependencies are swapped for inspectable doubles.
 */
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
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
 * Rewrites a single edge-function source string so it imports the test
 * doubles instead of the Deno-only modules, and so its top-level `serve()`
 * call registers the handler on a harness-controlled global.
 */
function rewriteSource(src: string): string {
  let out = src;

  // Stripe: `import Stripe from "https://esm.sh/stripe@..."`
  out = out.replace(
    /import\s+Stripe\s+from\s+["']https:\/\/esm\.sh\/stripe@[^"']+["'];?/g,
    `import Stripe from "${MOCK.stripe}";`,
  );

  // supabase-js: `import { createClient } from "npm:@supabase/supabase-js@2"`
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["']npm:@supabase\/supabase-js@[^"']+["'];?/g,
    `import {$1} from "${MOCK.supabase}";`,
  );

  // serve: `import { serve } from "https://deno.land/std@.../http/server.ts"`
  // Drop the import entirely — `serve` is provided as a harness global below.
  out = out.replace(
    /import\s+\{\s*serve\s*\}\s+from\s+["']https:\/\/deno\.land\/[^"']+["'];?/g,
    "",
  );

  // Shared helpers: `../_shared/rate-limit.ts`, `../_shared/slack-alerts.ts`,
  // and `../_shared/cors.ts`
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["']\.\.\/_shared\/(rate-limit|slack-alerts|cors)\.ts["'];?/g,
    `import {$1} from "${MOCK.shared}";`,
  );

  // Prepend the harness preamble: a `serve` that records the handler and a
  // `Deno` global backed by an env map the test controls.
  const preamble = `
import { __registerHandler as __hReg, __denoStub as Deno } from "${MOCK.deno}";
const serve = (h) => __hReg(h);
`;
  return preamble + out;
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

/**
 * Load an edge function and return a harness to drive it.
 *
 * @param fnName  Directory name under `supabase/functions/`.
 */
export async function loadEdgeFunction(fnName: string): Promise<EdgeHarness> {
  const srcPath = join(FUNCTIONS_DIR, fnName, "index.ts");
  const src = readFileSync(srcPath, "utf8");
  const rewritten = rewriteSource(src);

  // Write into THIS directory (NOT a subdir) so the relative `./mocks/*`
  // specifiers in the rewritten source resolve, and vitest applies its
  // TypeScript transform on import. The `.gen.` infix is git-ignored.
  const genPath = join(
    HERE,
    `${fnName}.${randomBytes(4).toString("hex")}.gen.ts`,
  );
  writeFileSync(genPath, rewritten, "utf8");

  // Reset the captured handler before importing so each load is isolated.
  const deno = await import("./mocks/deno-runtime.ts");
  deno.__clearHandler();

  try {
    // `?t=` cache-bust so repeated loads in one process re-evaluate the module.
    await import(/* @vite-ignore */ `${genPath}?t=${Date.now()}`);
  } finally {
    // The module has been evaluated + cached by vite; the temp file is no
    // longer needed on disk.
    rmSync(genPath, { force: true });
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
