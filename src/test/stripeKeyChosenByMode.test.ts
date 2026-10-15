/**
 * Class guard for Stripe TEST mode for TEST ACCOUNTS (owner 2026-10-12).
 *
 * The behaviour is pinned in src/test/edge/stripeTestModeForTestAccounts.test.ts
 * (a real user never reaches the test key, a test account never reaches the
 * live key, a mixed job refuses). This file pins the CLASS: every place an edge
 * function builds a Stripe client, read from source.
 *
 *   - ROUTED: the key comes from _shared/stripeMode.ts (stripeSecretKeyFor, or
 *     the per-job resolver's `key`), never straight from STRIPE_SECRET_KEY.
 *   - LIVE_ONLY: still on the live key for everyone, each with why. EXACT and
 *     two-way: a new `new Stripe(` in neither list fails, and so does a stale
 *     entry. A function moved to ROUTED must leave LIVE_ONLY in the same commit.
 *   - Only _shared/stripeMode.ts reads STRIPE_TEST_SECRET_KEY, so no function
 *     can pick the test key by its own rule (or from a request).
 *
 * @mutate supabase/functions/create-payment/index.ts |     const stripe = new Stripe(stripeSecretKeyFor(stripeMode), { |     const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") \|\| "", {
 * @mutate supabase/functions/release-payout/index.ts |     stripeKey = stripeSecretKeyFor(stripeMode); |     stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |     const stripes = createStripeModeResolver(supabaseAdmin, (key) => new Stripe(key, { apiVersion: "2025-08-27.basil" })); |     const stripes = createStripeModeResolver(supabaseAdmin, (key) => new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? key, { apiVersion: "2025-08-27.basil" }));
 * @mutate supabase/functions/create-gift-card-checkout/index.ts |     const stripe = new Stripe(stripeSecretKeyFor(stripeMode), { |     const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") \|\| "", {
 * @mutate supabase/functions/stripe-connect/index.ts |     const stripe = new Stripe(stripeSecretKeyFor(await stripeModeForParties(supabaseAdmin, [user.id])), { |     const stripe = new Stripe(Deno.env.get("STRIPE_TEST_SECRET_KEY") ?? "", {
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const FUNCTIONS = resolve(__dirname, "../../supabase/functions");
const MODE_MODULE = "_shared/stripeMode.ts";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

const sources = new Map<string, string>();
for (const f of walk(FUNCTIONS)) sources.set(relative(FUNCTIONS, f), blankComments(readFileSync(f, "utf8")));

/** Every `new Stripe(<first argument>` per file. */
const constructions: Array<{ file: string; arg: string }> = [];
for (const [file, s] of sources) {
  for (const m of s.matchAll(/new Stripe\(\s*([^,]+?)\s*,/g)) constructions.push({ file, arg: m[1] });
}

/** Functions whose every Stripe client is chosen by mode (owner 2026-10-12). EXACT. */
const ROUTED = [
  "auto-release-payment/index.ts",
  "auto-resolve-disputes/index.ts",
  "auto-tip-charge/index.ts",
  "cash-out-credits/index.ts",
  "charge-recurring-visits/index.ts",
  "create-bgc-payment/index.ts",
  "create-boost-payment/index.ts",
  "create-gift-card-checkout/index.ts",
  "create-payment/index.ts",
  "execute-dispute-split/index.ts",
  "instant-payout/index.ts",
  "pay-onboarding-fee/index.ts",
  "payout-hold-stripe-sync/index.ts",
  "process-scheduled-payouts/index.ts",
  "recheck-pending-accepts/index.ts",
  "release-payout/index.ts",
  "stripe-connect/index.ts",
  "stripe-payouts/index.ts",
  "stripe-webhook/index.ts",
  "stuck-payment-check/index.ts",
  "void-cancelled-payments/index.ts",
];

const PRO = "Pro sells fixed Price ids (PRO_PRICE_MAP, live); a test-mode Pro needs test Price ids first: filed as its own OPEN item";
const IDV = "Stripe Identity has its own webhook endpoint (stripe-idv-webhook) and no test-mode endpoint; filed as its own OPEN item";

/** Still on the live key for everyone, each with why. EXACT, both ways. */
// @two-way src/test/stripeKeyChosenByMode.test.ts:toEqual([...ROUTED, ...Object.keys(LIVE_ONLY)].sort())
const LIVE_ONLY: Record<string, string> = {
  "_shared/accountPurge.ts": "account deletion removes the person's LIVE Stripe customer; a test account has none, so the purge finds nothing to delete",
  "calculate-tax/index.ts": "a tax QUOTE on the post screen: it creates no charge and moves no money; the checkout's own tax is computed in the checkout's mode",
  "check-pro-subscription/index.ts": PRO,
  "create-pro-checkout/index.ts": PRO,
  "money-reconciliation/index.ts": "reconciles the LIVE ledger against live Stripe (read only); seed jobs are out of its default scope, and a test job read under the live key is the classified test-object skip",
  "pro-customer-portal/index.ts": PRO,
  "stripe-idv-start/index.ts": IDV,
  "stripe-idv-webhook/index.ts": IDV,
  "subscription-reconciliation/index.ts": PRO,
  "verification-webhook/index.ts": IDV,
};

/** The argument shapes a ROUTED construction may take. */
const ROUTED_ARG = /^(stripeSecretKeyFor\(|key$|stripeKey$|stripeSecretKey$)/;

describe("every Stripe client is built with a key chosen by mode, or is listed as live-only (owner 2026-10-12)", () => {
  it("finds the inventory (floor)", () => {
    expect(sources.size).toBeGreaterThan(100);
    expect(constructions.length).toBeGreaterThan(25);
  });

  it("the routed and live-only lists cover every file that builds a Stripe client, exactly", () => {
    const files = [...new Set(constructions.map((c) => c.file))].sort();
    expect(files).toEqual([...ROUTED, ...Object.keys(LIVE_ONLY)].sort());
    for (const [k, why] of Object.entries(LIVE_ONLY)) expect(why.length, `${k} needs a reason`).toBeGreaterThan(40);
  });

  it("a routed function never builds a client from STRIPE_SECRET_KEY directly", () => {
    for (const c of constructions.filter((x) => ROUTED.includes(x.file))) {
      expect(c.arg, `${c.file}: new Stripe(${c.arg}, …)`).toMatch(ROUTED_ARG);
      expect(c.arg, `${c.file}`).not.toMatch(/Deno\.env/);
    }
  });

  it("a routed function imports the mode module, and a named key variable is assigned from it", () => {
    for (const file of ROUTED) {
      const s = sources.get(file) ?? "";
      expect(s, `${file} imports stripeMode.ts`).toMatch(/from "\.\.\/_shared\/stripeMode\.ts"/);
      for (const c of constructions.filter((x) => x.file === file)) {
        if (c.arg === "key") {
          expect(s, `${file}: \`key\` is the resolver's`).toMatch(/createStripeModeResolver\([^,]+,\s*\(key\) => new Stripe\(key,/);
        } else if (c.arg === "stripeKey" && file === "stripe-webhook/index.ts") {
          // The LIVE client that verifies signatures and runs live-endpoint
          // events; a test-endpoint event's handlers get the test client.
          expect(s).toMatch(/handlerStripe = new Stripe\(stripeSecretKeyFor\("test"\)/);
          expect(s).toMatch(/const ctx: WebhookContext = \{ stripe: handlerStripe,/);
        } else if (c.arg === "stripeKey" || c.arg === "stripeSecretKey") {
          expect(s, `${file}: ${c.arg} = stripeSecretKeyFor(…)`).toMatch(new RegExp(`${c.arg} = stripeSecretKeyFor\\(`));
          expect(s, `${file}: ${c.arg} is never read from the env`).not.toMatch(new RegExp(`${c.arg} = Deno\\.env`));
        }
      }
    }
  });

  it("only the mode module reads the test key", () => {
    const readers = [...sources].filter(([, s]) => /STRIPE_TEST_SECRET_KEY/.test(s)).map(([f]) => f);
    expect(readers).toEqual([MODE_MODULE]);
  });
});
