#!/usr/bin/env node
/**
 * Type-check EVERY Supabase edge function, with `deno check`.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `tsconfig.app.json` covers `src` plus a hand-written list of individually
 * named `supabase/functions/_shared/*.ts` files. No edge function HANDLER was
 * ever type-checked — 65+ functions moving real money (payments, payouts,
 * escrow, disputes, refunds, subscriptions) had zero type coverage.
 *
 * That is not theoretical. `subscription.current_period_end` was removed from
 * the Stripe Subscription object in API version 2025-03-31.basil and moved to
 * `items.data[].current_period_end`; three call sites still read the old
 * property against a client pinned to 2025-08-27.basil. `undefined * 1000` is
 * `NaN`, `new Date(NaN).toISOString()` throws `RangeError`, the throw reached
 * the webhook dispatcher, the idempotency row rolled back, Stripe got a 500
 * and retried until it gave up: every recurring membership purchase and
 * renewal charged the card and granted nothing. `stripe@18.5.0`'s own types
 * describe that property as absent. Nothing ever compiled them.
 *
 * ── Why `deno check` and not a tsconfig.edge.json ──────────────────────────
 * These files are Deno: `npm:` specifiers, `https://esm.sh/...` and
 * `https://deno.land/std@.../` URL imports, `Deno.env`, `Deno.serve`. `tsc`
 * cannot resolve a URL import at all. A tsconfig-based lane would need a
 * `paths` mapping per remote specifier plus a wildcard fallback for anything
 * unmapped — and a wildcard fallback resolves to `any`, which is precisely
 * the state that hid the Stripe bug. Worse, it would be opt-in again: a new
 * import means a new mapping, and a forgotten mapping silently degrades to
 * `any` with a green build.
 *
 * `deno check` resolves every specifier the way production does and reads the
 * real `stripe@18.5.0` `.d.ts` off esm.sh, so the Subscription bug is a hard
 * compile error. Cost: the first run downloads remote types (CI caches
 * DENO_DIR; see .github/workflows/test.yml).
 *
 * ── Coverage is by glob, never by list ─────────────────────────────────────
 * Every `.ts`/`.tsx` under supabase/functions is checked. A new edge function
 * is covered the moment the file exists — nobody has to remember to add it
 * anywhere. The only list in this file is KNOWN_ERRORS, which SUBTRACTS from
 * coverage, is scoped to an exact (code, message, file) triple, and fails the
 * build when an entry stops matching so it can only ever shrink.
 *
 * Usage: node scripts/typecheck-edge.mjs [--json]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, statSync, existsSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FUNCTIONS_DIR = path.join(ROOT, "supabase", "functions");
const CONFIG = path.join(ROOT, "scripts", "edge-typecheck.deno.json");
const SKIP_DIRS = new Set(["node_modules", ".git"]);

/**
 * Errors that are known, understood, and NOT fixable from this lane.
 *
 * Rules are deliberately narrow: an entry matches only a specific TS error
 * code, containing a specific message fragment, in a specific list of files.
 * Anything else in those same files still fails the build. There is no
 * file-level or blanket suppression, and there is no `any` or `@ts-ignore`
 * hiding a diagnostic from this script.
 *
 * An entry that no longer matches anything is itself a failure — see
 * `staleRules` below — so this list cannot rot into a permanent exemption.
 */
const KNOWN_ERRORS = [
  {
    code: "TS2345",
    contains: "is not assignable to parameter of type 'FeeAdminClient'",
    files: [
      "supabase/functions/auto-release-payment/index.ts",
      "supabase/functions/create-payment/index.ts",
      "supabase/functions/execute-dispute-split/index.ts",
      "supabase/functions/process-scheduled-payouts/index.ts",
      "supabase/functions/release-payout/index.ts",
      "supabase/functions/void-cancelled-payments/index.ts",
    ],
    why: [
      "ONE upstream type defect, seven call sites. `FeeAdminClient` in",
      "supabase/functions/_shared/helperFees.ts declares `single()` as returning a",
      "`Promise<...>`. The Supabase client returns a `PostgrestBuilder`, which is a",
      "PromiseLike (it implements `then` and nothing else), so it is missing `catch`,",
      "`finally` and `[Symbol.toStringTag]` and NO real client satisfies the declared",
      "parameter type. Runtime is unaffected — structural types are erased and every",
      "caller does pass a real client.",
      "",
      "The fix is one word: `Promise<` -> `PromiseLike<` on helperFees.ts:89. That file",
      "and release-payout/** are owned by other lanes right now, so this lane must not",
      "touch them. Delete this entire entry with that one-word change.",
    ].join("\n"),
  },
  {
    code: "TS2589",
    contains: "Type instantiation is excessively deep and possibly infinite",
    // Same six files as the entry above. A getHelperFeePercent() call site
    // reports EITHER TS2345 or TS2589 depending on how deep the checker gets
    // before it gives up — adding a comment line above the call has been
    // observed to flip one into the other — so both codes are listed against
    // the same set rather than pinning whichever one showed up today.
    files: [
      "supabase/functions/auto-release-payment/index.ts",
      "supabase/functions/create-payment/index.ts",
      "supabase/functions/execute-dispute-split/index.ts",
      "supabase/functions/process-scheduled-payouts/index.ts",
      "supabase/functions/release-payout/index.ts",
      "supabase/functions/void-cancelled-payments/index.ts",
    ],
    why: [
      "Same root cause as the FeeAdminClient entry above, at the same call sites.",
      "Comparing the full generic `SupabaseClient` against the hand-rolled",
      "`FeeAdminClient` shape blows the instantiation depth limit before the checker",
      "can report the plain mismatch. Goes away with the same one-word fix in",
      "_shared/helperFees.ts.",
    ].join("\n"),
  },
];

// ── Collect the files ──────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

if (!existsSync(FUNCTIONS_DIR)) {
  console.error(`${FUNCTIONS_DIR} not found — run from the repo root.`);
  process.exit(1);
}

try {
  execFileSync("deno", ["--version"], { stdio: "ignore" });
} catch {
  console.error(
    [
      "",
      "  Deno is not installed, so the edge functions cannot be type-checked.",
      "",
      "  This check does NOT silently skip: edge functions went unchecked for the",
      "  life of this project and that is how a RangeError shipped into every",
      "  recurring subscription charge. Install Deno and re-run:",
      "",
      "      brew install deno        # or: curl -fsSL https://deno.land/install.sh | sh",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const files = walk(FUNCTIONS_DIR);
if (files.length === 0) {
  console.error("No .ts/.tsx files found under supabase/functions — refusing to report success.");
  process.exit(1);
}

// Deno colourises diagnostics. Strip BOTH complete escape sequences and the
// bare ESC bytes it emits around them — leaving a stray ESC in front of a
// header line silently breaks the `^TS\d+` match, and a parser that finds
// nothing looks exactly like a clean build.
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/\u001b/g, "");

// ── Canary: prove Stripe is actually typed before trusting a green run ──────
// A green result is worthless if the Stripe SDK resolved to `any`, and it can
// do so SILENTLY. esm.sh serves Stripe's .d.ts files wrapped in
// `declare module 'https://esm.sh/stripe@18.5.0/types/index.d.ts'`, which does
// not match the specifier the functions import, so without the `imports` map in
// edge-typecheck.deno.json every Stripe call in the repo type-checks as `any`
// and this whole script reports success while covering nothing. Any drift
// between the URL in the functions, the map key, and the shim would restore
// that state with no visible symptom.
//
// So: compile the original bug on purpose and require the compiler to reject
// it. `subscription.current_period_end` was removed from the Subscription
// object in Stripe API version 2025-03-31.basil; these functions pin
// 2025-08-27.basil. If this snippet COMPILES, the types are not live.
function assertStripeTypesAreLive() {
  // OS temp dir, not the repo: a run killed mid-check must not leave a file
  // behind that lint, knip or the next type check would trip over. The
  // `imports` map resolves relative to the CONFIG file, so the canary itself
  // can live anywhere.
  const canary = path.join(mkdtempSync(path.join(tmpdir(), "lh-edge-canary-")), "canary.ts");
  const source = [
    'import Stripe from "https://esm.sh/stripe@18.5.0";',
    'const stripe = new Stripe("sk_test_canary", { apiVersion: "2025-08-27.basil" });',
    "export async function canary(): Promise<string> {",
    '  const subscription = await stripe.subscriptions.retrieve("sub_canary");',
    "  // Deliberately wrong. `deno check` MUST reject this line.",
    "  return new Date(subscription.current_period_end * 1000).toISOString();",
    "}",
    "",
  ].join("\n");
  writeFileSync(canary, source);
  try {
    const probe = spawnSync("deno", ["check", "--config", CONFIG, canary], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const out = stripAnsi(`${probe.stdout ?? ""}\n${probe.stderr ?? ""}`);
    return { ok: probe.status !== 0 && /TS2339/.test(out) && out.includes("current_period_end"), out };
  } finally {
    rmSync(path.dirname(canary), { recursive: true, force: true });
  }
}

const canary = assertStripeTypesAreLive();
if (!canary.ok) {
  console.error(
    [
      "",
      "  EDGE TYPE CHECK IS NOT ACTUALLY CHECKING STRIPE.",
      "",
      "  The canary compiled `subscription.current_period_end` — a property Stripe",
      "  removed in API version 2025-03-31.basil — without complaint. That means the",
      "  Stripe SDK is resolving to `any`, and a green run below would prove nothing.",
      "",
      "  Check that the `imports` key in scripts/edge-typecheck.deno.json still",
      "  matches the exact URL the edge functions import, and that",
      "  scripts/edge-types/stripe-18.5.0.ts pins the same version.",
      "",
      "  deno output:",
      canary.out.trim() || "  (no output)",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// ── Run deno check ─────────────────────────────────────────────────────────
const run = spawnSync("deno", ["check", "--config", CONFIG, ...files], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

if (run.error) {
  console.error("Failed to run `deno check`:", run.error.message);
  process.exit(1);
}

const output = stripAnsi(`${run.stdout ?? ""}\n${run.stderr ?? ""}`);
const lines = output.split("\n");

// ── Parse the diagnostics ──────────────────────────────────────────────────
const HEADER = /^TS(\d+) \[ERROR\]: (.*)$/;
const LOCATION = /^\s*at (file:\/\/\S+?):(\d+):(\d+)\s*$/;

const diagnostics = [];
let current = null;
let reportedTotal = null;
const fatal = [];

for (const line of lines) {
  const header = HEADER.exec(line);
  if (header) {
    current = { code: `TS${header[1]}`, message: header[2], text: [line], file: null, line: null, col: null };
    diagnostics.push(current);
    continue;
  }
  const found = /^Found (\d+) errors?\.$/.exec(line.trim());
  if (found) {
    reportedTotal = Number(found[1]);
    current = null;
    continue;
  }
  // A non-type diagnostic: unresolved module, bad config, network failure.
  // These have no TS code and must never be swallowed by the allowlist.
  if (/^error: /.test(line) && !/^error: Type checking failed\.$/.test(line)) {
    fatal.push(line);
    current = null;
    continue;
  }
  if (!current) continue;
  current.text.push(line);
  const loc = LOCATION.exec(line);
  if (loc && current.file === null) {
    current.file = path.relative(ROOT, new URL(loc[1]).pathname);
    current.line = Number(loc[2]);
    current.col = Number(loc[3]);
  }
}

// A diagnostic whose first location is outside the repo (inside a cached
// dependency's .d.ts) is attributed to the file that pulled it in; keep it,
// but never let it match an allowlist entry keyed on a repo path.
for (const d of diagnostics) {
  if (d.file && d.file.startsWith("..")) d.file = null;
}

// ── Apply the allowlist ────────────────────────────────────────────────────
const matchedByRule = new Map(KNOWN_ERRORS.map((_, i) => [i, 0]));
const remaining = [];
for (const d of diagnostics) {
  const idx = KNOWN_ERRORS.findIndex(
    (rule) => rule.code === d.code && d.message.includes(rule.contains) && d.file && rule.files.includes(d.file),
  );
  if (idx === -1) remaining.push(d);
  else matchedByRule.set(idx, matchedByRule.get(idx) + 1);
}
const staleRules = KNOWN_ERRORS.map((rule, i) => ({ rule, hits: matchedByRule.get(i) })).filter((r) => r.hits === 0);

// ── Report ─────────────────────────────────────────────────────────────────
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ files: files.length, total: diagnostics.length, remaining, staleRules, fatal }, null, 2));
}

let failed = false;

if (fatal.length) {
  console.error("\n`deno check` failed before type checking could complete:\n");
  console.error(output.trim());
  process.exit(1);
}

// Guard against this parser drifting from Deno's output format: if Deno says
// it found N errors and we parsed a different number, the allowlist could be
// hiding something we never saw. Fail loudly rather than report a false green.
if (reportedTotal !== null && reportedTotal !== diagnostics.length) {
  console.error(
    `\nParser mismatch: \`deno check\` reported ${reportedTotal} errors but this script parsed ` +
      `${diagnostics.length}. Refusing to trust the allowlist — raw output follows.\n`,
  );
  console.error(output.trim());
  process.exit(1);
}

if (remaining.length) {
  failed = true;
  console.error(`\nEdge type check: ${remaining.length} error(s).\n`);
  for (const d of remaining) console.error(`${d.text.join("\n")}\n`);
}

if (staleRules.length) {
  failed = true;
  console.error("\nStale KNOWN_ERRORS entries in scripts/typecheck-edge.mjs — these no longer match anything.");
  console.error("That is good news: the underlying defect is fixed. Delete the entry.\n");
  for (const { rule } of staleRules) console.error(`  ${rule.code}  "${rule.contains}"\n`);
}

if (!failed) {
  const known = diagnostics.length - remaining.length;
  console.log(
    `Edge type check: ${files.length} file(s) checked, 0 errors` +
      (known ? ` (${known} known/allowlisted — see KNOWN_ERRORS in scripts/typecheck-edge.mjs)` : "") +
      ".",
  );
}

process.exit(failed ? 1 : 0);
