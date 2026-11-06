#!/usr/bin/env node
/**
 * Detach the saved cards piling up on the TEST accounts' Stripe TEST customers (docs/OPEN.md Q1816,
 * core-loop-canary #4151).
 *
 * Why: the test-mode journeys pay with 4242 and save the card to the poster seat's one wallet customer
 * (stripe_customers, 20261018090700), and nothing ever detached them. On 2026-11-05 every create-payment
 * 500 in prod's function_edge_logs (22 of them, 01:05Z..22:30Z) came from ONE test account
 * (951264df..., public.test_accounts, test wallet only), and the 10 read in function_logs all said
 * "Customer has maximum number of payment methods attached." (StripeInvalidRequestError 400), so the
 * canary's Checkout start failed.
 *
 * What it does, and the fences:
 *   - HARD-REFUSES unless STRIPE_TEST_SECRET_KEY starts with sk_test_ (no live key, no restricted key).
 *   - The customers come from OUR database, never from Stripe: stripe_customers rows with
 *     wallet_mode = 'test' whose user is in public.test_accounts or has profiles.is_seed = true. It never
 *     lists Stripe customers.
 *   - Per customer it lists that customer's own payment methods, refuses (exit 1) if any answers
 *     livemode !== false, keeps the KEEP_NEWEST newest (default 3, so a run's own fresh card stays) and
 *     detaches the rest.
 *   - A failed read or detach exits 1 with Stripe's or PostgREST's own words. Never prints the key.
 *
 * Run by core-loop-canary.yml and e2e-journeys.yml before the money journeys (after the service-role
 * step). Env: STRIPE_TEST_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KEEP_NEWEST (optional).
 * Test seam: LH_STRIPE_API_BASE (loopback only). Guard: src/test/stripeTestDetachCards.test.ts.
 */
import { apiBase } from "./lib/apiBase.mjs";

export const DEFAULT_KEEP_NEWEST = 3;

/** null when the key may be used; otherwise why not. Only a test-mode SECRET key (sk_test_) passes. */
export function refuseKey(key) {
  if (!key) return "STRIPE_TEST_SECRET_KEY is not set; nothing was detached";
  if (!key.startsWith("sk_test_")) {
    return "STRIPE_TEST_SECRET_KEY is not a test-mode secret key (sk_test_); refusing, nothing was detached";
  }
  return null;
}

async function restRows(fetchImpl, supabaseUrl, serviceKey, path) {
  const res = await fetchImpl(`${supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PostgREST GET ${path.split("?")[0]} ${res.status}: ${text.slice(0, 300)}`);
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error(`PostgREST GET ${path.split("?")[0]} answered a non-list`);
  return rows;
}

/**
 * The TEST wallet customers of test accounts (public.test_accounts) and seed accounts (profiles.is_seed),
 * read from our database. Every other stripe_customers row is dropped, whatever its mode.
 */
export async function testWalletCustomers({ supabaseUrl, serviceKey, fetchImpl = fetch }) {
  const wallets = await restRows(fetchImpl, supabaseUrl, serviceKey,
    "stripe_customers?select=user_id,stripe_customer_id,wallet_mode&wallet_mode=eq.test");
  const candidates = wallets.filter((w) => w.wallet_mode === "test" && /^cus_[A-Za-z0-9]+$/.test(w.stripe_customer_id ?? ""));
  if (candidates.length === 0) return [];
  const ids = [...new Set(candidates.map((w) => w.user_id))];
  const inList = `(${ids.join(",")})`;
  const tests = await restRows(fetchImpl, supabaseUrl, serviceKey, `test_accounts?select=user_id&user_id=in.${inList}`);
  const seeds = await restRows(fetchImpl, supabaseUrl, serviceKey,
    `profiles?select=user_id&is_seed=eq.true&user_id=in.${inList}`);
  const allowed = new Set([...tests.map((r) => r.user_id), ...seeds.map((r) => r.user_id)]);
  return candidates.filter((w) => allowed.has(w.user_id)).map((w) => ({ userId: w.user_id, customer: w.stripe_customer_id }));
}

/** A tiny Stripe REST client: only the two calls this script needs. */
export function stripeRestClient(key, base, fetchImpl = fetch) {
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" };
  const call = async (method, path) => {
    const res = await fetchImpl(`${base}${path}`, { method, headers, signal: AbortSignal.timeout(30_000) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Stripe ${method} ${path.split("?")[0]} ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 300)}`);
    return json;
  };
  return {
    listPaymentMethods: (customer, startingAfter) =>
      call("GET", `/v1/customers/${encodeURIComponent(customer)}/payment_methods?limit=100${startingAfter ? `&starting_after=${encodeURIComponent(startingAfter)}` : ""}`),
    detach: (pm) => call("POST", `/v1/payment_methods/${encodeURIComponent(pm)}/detach`),
  };
}

/** Detach all but the `keepNewest` newest payment methods of each customer. Returns the count detached. */
export async function detachSavedCards({ stripe, customers, keepNewest = DEFAULT_KEEP_NEWEST, log = console.log }) {
  let detached = 0;
  for (const { customer } of customers) {
    const pms = [];
    let after;
    for (;;) {
      const page = await stripe.listPaymentMethods(customer, after);
      const data = Array.isArray(page?.data) ? page.data : null;
      if (!data) throw new Error(`Stripe answered no payment-method list for ${customer}`);
      pms.push(...data);
      if (!page.has_more || data.length === 0) break;
      after = data[data.length - 1].id;
    }
    const live = pms.find((pm) => pm.livemode !== false);
    if (live) throw new Error(`${customer}: payment method ${live.id} is not test mode (livemode=${live.livemode}); refusing`);
    const drop = [...pms].sort((a, b) => (b.created ?? 0) - (a.created ?? 0)).slice(keepNewest);
    for (const pm of drop) {
      const out = await stripe.detach(pm.id);
      if (out?.livemode !== false) throw new Error(`${pm.id}: the detach did not answer test mode; stopping`);
      detached++;
    }
    log(`${customer}: ${pms.length} saved, kept ${pms.length - drop.length}, detached ${drop.length}`);
  }
  return detached;
}

async function main() {
  const key = process.env.STRIPE_TEST_SECRET_KEY;
  const bad = refuseKey(key);
  if (bad) {
    console.error(`::error::${bad}`);
    process.exit(1);
  }
  const supabaseUrl = (process.env.SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co").replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error("::error::SUPABASE_SERVICE_ROLE_KEY is not set (run the service-role step first); nothing was detached");
    process.exit(1);
  }
  const keepRaw = process.env.KEEP_NEWEST ?? String(DEFAULT_KEEP_NEWEST);
  const keepNewest = Number(keepRaw);
  if (!Number.isInteger(keepNewest) || keepNewest < 0 || keepNewest > 50) {
    console.error(`::error::KEEP_NEWEST must be a whole number from 0 to 50; got "${keepRaw}"`);
    process.exit(1);
  }
  const customers = await testWalletCustomers({ supabaseUrl, serviceKey });
  console.log(`${customers.length} test-account TEST wallet customer(s) from stripe_customers`);
  const stripe = stripeRestClient(key, apiBase(process.env.LH_STRIPE_API_BASE, "https://api.stripe.com"));
  const n = await detachSavedCards({ stripe, customers, keepNewest });
  console.log(`detached ${n} saved payment method(s) in TEST mode`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`::error::${e?.message ?? e}`);
    process.exit(1);
  });
}
