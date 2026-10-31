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
 *   - Oct 2026 money audit, finding 7: a TEST-LOOKING account (is_seed or a
 *     test_accounts row without the other, or a fixture inbox email) that is
 *     not properly enrolled ran LIVE. Now every ROUTED decision refuses one for
 *     new money and payouts (classifyParties + refuseUnenrolled; behaviour in
 *     src/test/edge/stripeRefusesUnenrolledTestAccounts.test.ts), and LIVE_ONLY
 *     splits in two: LIVE_ONLY_REFUSES_TEST must call
 *     refuseLiveOnlyForTestOrSeed and answer it before its first
 *     `new Stripe(`; LIVE_ONLY_EXEMPT says why it may run live for anyone
 *     (Stripe-initiated, read-only, or only money already taken: owner via lead
 *     2026-10-25, Q4). The party-based calls that opt OUT of the refusal (kind
 *     "refund"/"read") are an exact inventory, so a new one is a decision.
 *
 * @mutate supabase/functions/create-payment/index.ts |     const stripe = new Stripe(stripeSecretKeyFor(stripeMode), { |     const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") \|\| "", {
 * @mutate supabase/functions/release-payout/index.ts |     stripeKey = stripeSecretKeyFor(stripeMode); |     stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |     const stripes = createStripeModeResolver(supabaseAdmin, (key) => new Stripe(key, { apiVersion: "2025-08-27.basil" })); |     const stripes = createStripeModeResolver(supabaseAdmin, (key) => new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? key, { apiVersion: "2025-08-27.basil" }));
 * @mutate supabase/functions/create-gift-card-checkout/index.ts |     const stripe = new Stripe(stripeSecretKeyFor(stripeMode), { |     const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") \|\| "", {
 * @mutate supabase/functions/stripe-connect/index.ts |     const stripe = new Stripe(stripeSecretKeyFor(callerMode), { |     const stripe = new Stripe(Deno.env.get("STRIPE_TEST_SECRET_KEY") ?? "", {
 * @mutate supabase/functions/create-pro-checkout/index.ts |     if (liveOnlyRefusal) return stripeModeRefusedResponse(liveOnlyRefusal, corsHeaders); |     void liveOnlyRefusal;
 * @mutate supabase/functions/stripe-idv-start/index.ts |     const liveOnlyRefusal = await refuseLiveOnlyForTestOrSeed(supabaseAdmin, user.id); |     const liveOnlyRefusal = null;
 * @mutate supabase/functions/_shared/stripeMode.ts |   return e.endsWith("@mailinator.com") \|\| e.endsWith("@helpr.test") \|\| e.startsWith("eli.test."); |   return e.endsWith("@mailinator.com") \|\| e.endsWith("@helpr.test");
 * @mutate supabase/functions/declutter-money/index.ts |       const { stripe, mode } = await modes.clientForParties([p.buyer_id, p.seller_id], "payout", [p.seller_id]); |       const { stripe, mode } = await modes.clientForParties([p.buyer_id, p.seller_id], "read", [p.seller_id]);
 * @mutate supabase/functions/declutter-money/index.ts |       const { stripe, mode } = await modes.clientForParties([h.customer_id, h.pickup_contact_id, h.helpr_id], "payout", [h.helpr_id]); |       const { stripe, mode } = await modes.clientForParties([h.customer_id, h.pickup_contact_id, h.helpr_id], "payout", []);
 * @mutate supabase/functions/shop-checkout/index.ts |   const outcome = await captureShopHold(await stripeForOrder(admin, o, "new"), admin |   const outcome = await captureShopHold(await stripeForOrder(admin, o, "refund"), admin
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

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
  "auto-tip-charge/index.ts",
  "card-hold-sweep/index.ts",
  "cash-out-credits/index.ts",
  "charge-recurring-visits/index.ts",
  "create-bgc-payment/index.ts",
  "create-boost-payment/index.ts",
  "create-gift-card-checkout/index.ts",
  "create-payment/index.ts",
  "declutter-card/index.ts",
  "declutter-checkout/index.ts",
  "shop-checkout/index.ts",
  "declutter-money/index.ts",
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

/**
 * On the live key for everyone, AND they refuse a test account or an
 * unenrolled test-looking account before any Stripe call
 * (refuseLiveOnlyForTestOrSeed). EXACT, both ways.
 */
const LIVE_ONLY_REFUSES_TEST: Record<string, string> = {
  "create-pro-checkout/index.ts": `${PRO}; it opens a NEW live checkout, so a test account is refused`,
  "stripe-idv-start/index.ts": `${IDV}; a live check is billed, so a test account is refused`,
};

/** On the live key for everyone, with why that is safe for a test account. EXACT, both ways. */
// @two-way src/test/stripeKeyChosenByMode.test.ts:toEqual([...ROUTED, ...Object.keys(LIVE_ONLY)].sort())
const LIVE_ONLY_EXEMPT: Record<string, string> = {
  "_shared/accountPurge.ts": "account deletion removes the person's LIVE Stripe customer; a test account has none, so the purge finds nothing to delete",
  "calculate-tax/index.ts": "a tax QUOTE on the post screen: it creates no charge and moves no money (read-only, Q4); the checkout's own tax is computed in the checkout's mode",
  "check-pro-subscription/index.ts": `${PRO}; it only READS the member's live subscription (read-only, Q4)`,
  "money-reconciliation/index.ts": "reconciles the LIVE ledger against live Stripe (read only); seed jobs are out of its default scope, and a test job read under the live key is the classified test-object skip",
  "pro-customer-portal/index.ts": `${PRO}; it opens only on a customer that already carries a live subscription (money already taken, Q4), so a member can always cancel`,
  "stripe-idv-webhook/index.ts": `${IDV}; Stripe-initiated: it records a check that already ran`,
  "subscription-reconciliation/index.ts": `${PRO}; a cron that READS live subscriptions (read-only, Q4)`,
  "verification-webhook/index.ts": `${IDV}; Stripe-initiated: it records a check that already ran`,
};

/** Still on the live key for everyone. EXACT, both ways. */
// @two-way src/test/stripeKeyChosenByMode.test.ts:toEqual([...ROUTED, ...Object.keys(LIVE_ONLY)].sort())
const LIVE_ONLY: Record<string, string> = { ...LIVE_ONLY_REFUSES_TEST, ...LIVE_ONLY_EXEMPT };

/**
 * Party-based mode calls that opt OUT of refusing an unenrolled test-looking
 * account (kind "refund" or "read": money already taken goes back, or nothing
 * moves; owner via lead 2026-10-25, Q4), or that pass their kind through
 * (`kind`), each as `file: the source line it sits on` (whitespace collapsed).
 * EXACT, both ways: swapping a capture's "new" for a release's "refund"
 * changes both lines (lh-money-escrow review 2026-10-25, finding 12).
 */
// @two-way src/test/stripeKeyChosenByMode.test.ts:toEqual([...LENIENT_PARTY_CALLS].sort())
const LENIENT_PARTY_CALLS = [
  '_shared/refundNotice.ts: mode = await stripeModeForParties(supabase, [recipient], { kind: "read" });',
  'charge-recurring-visits/index.ts: : (await stripes.modeForParties([row.payer_id as string | null], "refund")) === "live" ? "live" : stored ?? "test";',
  'declutter-money/index.ts: const byParties = await modes.modeForParties([r.buyer_id, r.seller_id], "refund");',
  'declutter-money/index.ts: const done = await releaseShopHold(await shopClient(r, "refund"), admin, r);',
  'declutter-money/index.ts: const stripe = mode ? modes.clientFor(mode) : (await modes.clientForParties([r.buyer_id, r.seller_id], "refund")).stripe;',
  'declutter-money/index.ts: return await modes.clientForParties([r.buyer_id, r.seller_id], "refund");',
  'declutter-money/index.ts: return mode ? modes.clientFor(mode) : (await modes.clientForParties([r.buyer_id, r.seller_id], kind)).stripe;',
  'payout-hold-stripe-sync/index.ts: port = portFor((await stripes.clientForParties([id], "read")).stripe);',
  'process-scheduled-payouts/index.ts: const c = await stripes.clientForParties([helperId], "refund");',
  'recheck-pending-accepts/index.ts: const stripeFor = async (helperId: string) => (await stripes.clientForParties([helperId], "read")).stripe;',
  'shop-checkout/index.ts: ?? await stripeModeForParties(admin, [o.buyer_id, o.seller_id], { kind });',
  'shop-checkout/index.ts: await releaseShopHold(await stripeForOrder(admin, o, "refund"), admin, {',
  'shop-checkout/index.ts: const outcome = await sendShopRefund(await stripeForOrder(admin, o, "refund"), admin, row);',
  'shop-checkout/index.ts: const refund = await retrieveRefund(await stripeForOrder(admin, o, "read"), refundId);',
  'shop-checkout/index.ts: const refund = await retrieveRefund(await stripeForOrder(admin, o, "read"), refundId);',
  'stripe-payouts/index.ts: const stripe = new Stripe(stripeSecretKeyFor(await stripeModeForParties(supabaseAdmin, [user.id], { kind: "read" })), {',
];
const LENIENT_CALL = /\b(?:stripeModeForParties|modeForParties|clientForParties|stripeForOrder|shopClient)\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g;
const lenientCalls: string[] = [];
for (const [file, s] of sources) {
  if (file === MODE_MODULE) continue;
  for (const m of s.matchAll(LENIENT_CALL)) {
    if (!/"(?:refund|read)"|[,{]\s*kind\s*[)}]/.test(m[0])) continue;
    // Keyed by the whole source line, so the action around the call (a capture vs a release) is part of it.
    const lineStart = s.lastIndexOf("\n", m.index!) + 1;
    const lineEnd = s.indexOf("\n", m.index!);
    lenientCalls.push(`${file}: ${s.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim().replace(/\s+/g, " ")}`);
  }
}

/**
 * Party decisions that NARROW who must be properly enrolled to the payee
 * (resolver `modeForParties` / `clientForParties` third argument, or
 * stripeModeForParties `mustBeEnrolled`): narrowing is itself a way to opt out
 * of the check, so each is listed by its source line, and each must name a
 * non-empty list (lh-money-escrow re-review 2026-10-25, nit 7). EXACT both ways.
 */
// @two-way src/test/stripeKeyChosenByMode.test.ts:toEqual([...NARROWED_PARTY_CALLS].sort())
const NARROWED_PARTY_CALLS = [
  'declutter-money/index.ts: const byParties = await modes.modeForParties([p.buyer_id, p.seller_id], "payout", [p.seller_id]);',
  'declutter-money/index.ts: const resolved = mode ? { mode, stripe: modes.clientFor(mode) } : await modes.clientForParties([p.buyer_id, p.seller_id], "payout", [p.seller_id]);',
  'declutter-money/index.ts: const { stripe, mode } = await modes.clientForParties([p.buyer_id, p.seller_id], "payout", [p.seller_id]);',
  'declutter-money/index.ts: const { stripe, mode } = await modes.clientForParties([h.customer_id, h.pickup_contact_id, h.helpr_id], "payout", [h.helpr_id]);',
];
const NARROW_CALL = /\b(?:modeForParties|clientForParties)\(\s*\[[^\]]*\]\s*,\s*[^,()]+,\s*([^)]*)\)|\bmustBeEnrolled\s*:\s*([^,}]+)/g;
const narrowedCalls: string[] = [];
const emptyNarrowing: string[] = [];
for (const [file, s] of sources) {
  if (file === MODE_MODULE) continue;
  for (const m of s.matchAll(NARROW_CALL)) {
    const lineStart = s.lastIndexOf("\n", m.index!) + 1;
    const lineEnd = s.indexOf("\n", m.index!);
    const line = s.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim().replace(/\s+/g, " ");
    narrowedCalls.push(`${file}: ${line}`);
    if (!/^\s*\[\s*[\w.]+/.test(m[1] ?? m[2] ?? "")) emptyNarrowing.push(`${file}: ${line}`);
  }
}

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

  it("every live-only function either refuses a test account before its first Stripe client, or says why it need not", () => {
    for (const [file, why] of Object.entries(LIVE_ONLY_REFUSES_TEST)) {
      const s = sources.get(file) ?? "";
      const refusal = s.search(/=\s*await refuseLiveOnlyForTestOrSeed\(/);
      const answered = s.search(/if \((\w+)\) return stripeModeRefusedResponse\(\1, corsHeaders\);/);
      const client = s.search(/new Stripe\(/);
      expect(refusal, `${file} calls refuseLiveOnlyForTestOrSeed (${why})`).toBeGreaterThan(-1);
      expect(answered, `${file} answers the refusal`).toBeGreaterThan(refusal);
      expect(client, `${file}: the refusal comes before the first Stripe client`).toBeGreaterThan(answered);
      expect(s).toMatch(/from "\.\.\/_shared\/stripeMode\.ts"/);
    }
    for (const [file, why] of Object.entries(LIVE_ONLY_EXEMPT)) {
      expect(why.length, `${file} needs a reason`).toBeGreaterThan(40);
      expect(LIVE_ONLY_REFUSES_TEST[file], file).toBeUndefined();
    }
  });

  it("the calls that do not refuse an unenrolled test-looking account are exactly the listed refunds and reads", () => {
    expect([...lenientCalls].sort()).toEqual([...LENIENT_PARTY_CALLS].sort());
  });

  it("the calls that narrow who must be enrolled are exactly the listed payee-only payouts, each naming a payee", () => {
    expect([...narrowedCalls].sort()).toEqual([...NARROWED_PARTY_CALLS].sort());
    expect(emptyNarrowing).toEqual([]);
  });

  it("the mode module's fixture-inbox rule is public.is_fixture_email's, pattern for pattern", () => {
    const sql = blankSqlComments(effectiveDefs(resolve(__dirname, "../../supabase/migrations")).get("is_fixture_email")?.stmt ?? "");
    const likes = [...sql.matchAll(/LIKE\s+'([^']+)'/gi)].map((m) => m[1]).sort();
    expect(likes).toEqual(["%@helpr.test", "%@mailinator.com", "eli.test.%"]);
    const mode = sources.get(MODE_MODULE) ?? "";
    const ts = [
      ...[...mode.matchAll(/e\.endsWith\("([^"]+)"\)/g)].map((m) => `%${m[1]}`),
      ...[...mode.matchAll(/e\.startsWith\("([^"]+)"\)/g)].map((m) => `${m[1]}%`),
    ].sort();
    expect(ts).toEqual(likes);
  });

  it("no function calls the Stripe API around the SDK except the read-only config check", () => {
    // A scan of edge-function SOURCE TEXT for the Stripe API host, not URL
    // validation. Built from parts because CodeQL reads a host-shaped literal
    // here as URL sanitization (PR #3621: alerts 502 regex-anchor, 503
    // url-substring, both false positives on this test).
    const STRIPE_API_HOST = ["api", "stripe", "com"].join(".");
    const raw = [...sources].filter(([, s]) => s.includes(STRIPE_API_HOST)).map(([f]) => f);
    expect(raw).toEqual(["stripe-webhook-config-check/shape.ts"]);
  });

  it("only the mode module reads the test key", () => {
    const readers = [...sources].filter(([, s]) => /STRIPE_TEST_SECRET_KEY/.test(s)).map(([f]) => f);
    expect(readers).toEqual([MODE_MODULE]);
  });
});
