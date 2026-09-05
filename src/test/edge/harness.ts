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
  email: "./mocks/email.ts",
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

  // supabase-js via esm.sh: `import { createClient } from
  // "https://esm.sh/@supabase/supabase-js@2"` (also `@2.99.0`). Functions are
  // split roughly half and half between this form and the `npm:` form above —
  // verification-webhook and daily-match-digest use esm.sh — and without this
  // rule their `createClient` resolved to the REAL library, which then tried to
  // reach the network instead of the in-memory table store.
  out = out.replace(
    /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']https:\/\/esm\.sh\/@supabase\/supabase-js@[^"']+["'];?/g,
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

  // Cron result envelope: `_shared/cron-result.ts` is a pure shape helper (no
  // Deno, no network) that decides a cron's HTTP status from its defect count.
  // Point at the REAL module — whether a failed run answers non-2xx is exactly
  // the thing the silent-cron watcher depends on, and several crons were
  // answering 200 on failure until recently.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/cron-result\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/cron-result.ts";`,
  );

  // Payout claim protocol: `_shared/payoutClaim.ts` has ZERO imports — it takes
  // the Supabase client as a parameter — so the generated file points at the
  // REAL module rather than a mock. This is deliberate: the claim protocol is
  // what stands between two concurrent payout paths and a double transfer
  // (INSERT the ledger row BEFORE Stripe, unique index arbitrates, the loser
  // gets 23505 and never reaches transfers.create). Mocking it would mean the
  // one guard against paying a helper twice is the one thing not under test.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/payoutClaim\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/payoutClaim.ts";`,
  );

  // Captured-escrow resolver: `_shared/capturedEscrow.ts` has ZERO imports (it
  // is structurally typed over the PaymentIntent), so the generated file points
  // at the REAL module — same reasoning as payoutClaim above. It is the single
  // place that decides how many cents Stripe actually took, which is the ceiling
  // both payout paths cap their transfer against. Mocking it would mean the
  // guard against paying out more than was ever collected is the one thing not
  // under test, and its whole point is that a MISSING amount must not read as
  // zero captured and silently refuse every payout on the platform.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/capturedEscrow\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/capturedEscrow.ts";`,
  );

  // Subscription period resolver: `_shared/stripeSubscriptionPeriod.ts` has
  // ZERO imports (it is structurally typed over the Stripe payload), so the
  // generated file points at the REAL module rather than a mock — same
  // reasoning as payoutClaim above. This helper is the ONLY thing standing
  // between a paid recurring membership and a `RangeError: Invalid time value`
  // that 500s the whole webhook: `subscription.current_period_end` was removed
  // from the Subscription object in Stripe API version 2025-03-31.basil and
  // these functions pin 2025-08-27.basil. Mocking it would mean the fix for a
  // "customer charged, entitlement never granted" bug is the one thing not
  // under test.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/stripeSubscriptionPeriod\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/stripeSubscriptionPeriod.ts";`,
  );

  // Tier display names: `_shared/tierNames.ts` has ZERO imports and is a plain
  // lookup table, so the generated file points at the REAL module. It is what
  // stops a lapse notification telling a member "Your pro pass ended" with the
  // raw column id in it, which is a user-visible string worth having under test.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/tierNames\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/tierNames.ts";`,
  );

  // Stripe->profile linkage projection: `_shared/subscriptionLinkage.ts` has
  // ZERO imports and is a pure function of the Stripe payload, so — same
  // reasoning as stripeSubscriptionPeriod above — the generated file points at
  // the REAL module. It decides the customer id, subscription id, billing cycle
  // and cancel-at-period-end that get written onto `profiles`, which is what
  // makes a membership reconcilable against Stripe at all and what decides
  // whether the Membership card says "Renews", "Ends" or "Expires". Mocking it
  // would leave exactly that untested.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/subscriptionLinkage\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/subscriptionLinkage.ts";`,
  );

  // Stripe product -> membership tier: `_shared/productTiers.ts` is a plain
  // constant map (no Deno/remote imports), so the generated file points at the
  // REAL module. Matched for BOTH forms, because stripe-webhook/constants.ts
  // RE-EXPORTS it (`export { PRODUCT_TO_TIER } from ...`) rather than importing
  // it — a re-export the import-only rules above would have missed, leaving an
  // unresolvable `../_shared/...` specifier in the emitted sibling.
  out = out.replace(
    /(import|export)\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/productTiers\.ts["'];?/g,
    `$1 {$2} from "../../../supabase/functions/_shared/productTiers.ts";`,
  );

  // Stripe identity verdict: `_shared/stripeIdentity.ts` is pure TypeScript
  // (its only import is a TYPE-only Stripe import, stripped on transpile), so
  // the generated file points at the REAL module. The rule deciding whether a
  // helper may display "ID verified" is a trust claim — it stays under test
  // rather than being mocked away.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/stripeIdentity\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/stripeIdentity.ts";`,
  );

  // Flat one-time product prices: `_shared/productPrices.ts` is a plain
  // constant module (no Deno/remote imports), so the generated file points at
  // the REAL module. These ARE the amounts Stripe charges for a boost and a
  // background check, and BOOST_DISCOUNT_PCT / BOOST_MIN_UNIT_AMOUNT_CENTS
  // decide what a subscriber actually pays — mocking them would leave the one
  // thing worth asserting (the charged cents) untested. Without this rule the
  // specifier stayed `../_shared/productPrices.ts`, unresolvable from a
  // `.gen.ts` in this directory, so create-boost-payment could not be loaded
  // by the harness at all.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/productPrices\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/productPrices.ts";`,
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

  // LA sales-tax classification: `_shared/salesTax.ts` is a pure lookup (a Set
  // plus arithmetic), so the generated file points at the REAL module. Which
  // Stripe `tax_code` each line gets is exactly what the checkout screen
  // mirrors, so it stays under test rather than being mocked away.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/salesTax\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/salesTax.ts";`,
  );

  // Notification money formatting: `_shared/money.ts` is pure TypeScript
  // (Math.floor + toLocaleString, no Deno or remote imports), so the generated
  // file points at the REAL module. The FLOORING is the whole point of it — a
  // payout notification must never round up and promise more than lands — so
  // that behaviour belongs under test rather than mocked away.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/money\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/money.ts";`,
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

  // PostgREST paging: `_shared/paginate.ts` has ZERO imports (it drives a
  // query factory the caller supplies), so the generated file points at the
  // REAL module. This is the code that reads past `db-max-rows = 1000` and
  // decides whether a scan saw everything — the previous generation of that
  // logic was `.limit(5000)` plus an alarm on `rows.length >= 5000`, which the
  // 1000-row cap made unsatisfiable, so several crons certified completeness
  // over a fifth of the data. Mocking it away would leave exactly the
  // mechanism that failed as the one thing not under test.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/paginate\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/paginate.ts";`,
  );

  // Helper take-home: `_shared/helperEarnings.ts` is pure TypeScript (its only
  // import is a sibling `_shared` constant module, which vitest resolves from
  // disk once this specifier points at the real file). It is the arithmetic
  // behind the dollar figure `weekly-helper-report` emails a helper about
  // their own week — including the group-job roster split that used to mail a
  // 3-person job's FULL budget to each of them — so it stays under test.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/helperEarnings\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/helperEarnings.ts";`,
  );

  // Cancellation ladder: `_shared/cancellationFee.ts` has ZERO imports and is
  // the module `money-reconciliation` re-derives every stored cancellation fee
  // from. Mocking it would mean the reconciler's central comparison — stored
  // column vs. what settlement would compute — is asserted against a stub.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/cancellationFee\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/cancellationFee.ts";`,
  );

  // ── The transactional-email layer ────────────────────────────────────────
  //
  // `_shared/resend.ts` constructs a Resend client at module scope,
  // `_shared/unsubscribe.ts` signs links with a Deno-provided secret, and the
  // templates pull in `@react-email/components`. None of that is what a
  // lifecycle cron's tests are about — the decisions under test (who is
  // eligible, whose consent was read, when the run refuses to send at all) are
  // all made before a template is touched. The whole layer points at one
  // double; see `./mocks/email.ts`.
  //
  // Without these rules `engagement-automations` could not be loaded by this
  // harness at all, which is why the one function in the repo that mails
  // marketing to real people had no tests.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/(resend|unsubscribe)\.ts["'];?/g,
    `import {$1} from "${MOCK.email}";`,
  );
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/email-templates\/[A-Za-z0-9_-]+\.tsx?["'];?/g,
    `import {$1} from "${MOCK.email}";`,
  );
  // `import * as React from 'npm:react@18.3.1'` — this repo already depends on
  // React 18, so the real library serves. `React.createElement` on an inert
  // template component is exactly what the function does in production; only
  // the rendering is stubbed out.
  out = out.replace(
    /import\s+\*\s+as\s+React\s+from\s+["']npm:react@[^"']+["'];?/g,
    `import * as React from "react";`,
  );

  // Recurring calendar: `_shared/recurringSchedule.ts` has ZERO imports and is
  // the single definition of which dates a series runs. The Post-a-Task screen
  // quotes "9 visits · $450 total" from it and `charge-recurring-visits` bills
  // a saved card from it, so a stub here would mean the calendar every one of
  // those charges is derived from is the one thing not under test — and the
  // failure mode is a poster billed for a visit the app never showed them.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/recurringSchedule\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/recurringSchedule.ts";`,
  );

  // Cron authorization: `_shared/cron-auth.ts` is the ONLY thing standing
  // between a public HTTPS endpoint and a function that charges saved cards
  // off-session, so it points at the REAL module rather than a permissive
  // stub — a mocked gate is a gate nobody tested. It is otherwise pure: its
  // sole dependency is `Deno.env.get`, which the global installed in
  // `loadEdgeFunction` below satisfies (a `_shared` module is imported from
  // disk, so it cannot receive the per-function preamble the entry gets).
  //
  // Without this rule any function importing it — charge-recurring-visits,
  // cleanup-abandoned-accounts, process-email-queue — could not be loaded by
  // the harness at all: the emitted `.gen.ts` kept a `../_shared/cron-auth.ts`
  // specifier that does not resolve from this directory.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/cron-auth\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/cron-auth.ts";`,
  );

  // Escrow clock: `_shared/escrowTiming.ts` has ZERO imports and is the single
  // source of the 24-hour auto-release cutoff that user copy, the payout cron
  // and `payment-confirm-reminder`'s window all have to agree on.
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["'](?:\.\.\/)+_shared\/escrowTiming\.ts["'];?/g,
    `import {$1} from "../../../supabase/functions/_shared/escrowTiming.ts";`,
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

  // A `Deno` GLOBAL, in addition to the per-function preamble binding.
  //
  // The preamble gives the function's own modules a local `Deno`, but a
  // `_shared` helper pointed at its real path is imported from disk and never
  // rewritten, so it can only see a global. `_shared/cron-auth.ts` is exactly
  // that: real source, under test, reading `Deno.env.get`. The stub is backed
  // by the same map `setEnv()` writes, so a test configures both the same way.
  //
  // The preamble's local binding SHADOWS this inside every rewritten module, so
  // nothing that worked before changes behaviour.
  (globalThis as { Deno?: unknown }).Deno = deno.__denoStub;

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
