#!/usr/bin/env node
/**
 * Top up the Stripe TEST platform balance so test-mode payouts keep settling
 * (ledger "stripe test balance below payout threshold", Q3/Q145). Run by
 * .github/workflows/stripe-test-topup.yml, dispatch only.
 *
 * Charges the platform account with Stripe's `pm_card_bypassPending` test
 * card (4000 0000 0000 0077), which lands in the AVAILABLE balance at once.
 * Refuses anything that is not a test-mode key, refuses an amount outside
 * 1..MAX_DOLLARS, and fails unless Stripe answers livemode=false on both the
 * charge and the balance. Never prints the key.
 *
 * Env: STRIPE_TEST_SECRET_KEY, TOPUP_DOLLARS. Test seam: LH_STRIPE_API_BASE.
 */
export const MAX_DOLLARS = 2000;

export function checkInputs(key, dollarsRaw) {
  if (!key) return "STRIPE_TEST_SECRET_KEY is not set";
  if (!/^(sk|rk)_test_/.test(key)) {
    return "STRIPE_TEST_SECRET_KEY is not a test-mode key (sk_test_/rk_test_). Stripe stays in sandbox until launch; nothing was charged.";
  }
  const dollars = Number(dollarsRaw);
  if (!Number.isInteger(dollars) || dollars < 1 || dollars > MAX_DOLLARS) {
    return `TOPUP_DOLLARS must be a whole number from 1 to ${MAX_DOLLARS}; got "${dollarsRaw}"`;
  }
  return null;
}

async function main() {
  const key = process.env.STRIPE_TEST_SECRET_KEY;
  const dollarsRaw = process.env.TOPUP_DOLLARS ?? "";
  const bad = checkInputs(key, dollarsRaw);
  if (bad) {
    console.error(`::error::${bad}`);
    process.exit(1);
  }
  const base = process.env.LH_STRIPE_API_BASE ?? "https://api.stripe.com";
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" };
  const body = new URLSearchParams({
    amount: String(Number(dollarsRaw) * 100),
    currency: "usd",
    payment_method: "pm_card_bypassPending",
    confirm: "true",
    "automatic_payment_methods[enabled]": "true",
    "automatic_payment_methods[allow_redirects]": "never",
    description: "TEST-mode platform balance top-up (stripe-test-topup.yml)",
  });
  const pi = await fetch(`${base}/v1/payment_intents`, { method: "POST", headers, body, signal: AbortSignal.timeout(30_000) });
  const piJson = await pi.json();
  if (!pi.ok) {
    console.error(`::error::Stripe POST /v1/payment_intents ${pi.status}: ${JSON.stringify(piJson.error ?? piJson).slice(0, 300)}`);
    process.exit(1);
  }
  if (piJson.livemode !== false || piJson.status !== "succeeded") {
    console.error(`::error::top-up did not succeed in TEST mode (livemode=${piJson.livemode}, status=${piJson.status})`);
    process.exit(1);
  }
  const bal = await fetch(`${base}/v1/balance`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
  const balJson = await bal.json();
  if (!bal.ok || balJson.livemode !== false) {
    console.error(`::error::could not confirm the TEST balance afterwards (${bal.status}, livemode=${balJson.livemode})`);
    process.exit(1);
  }
  const usd = (balJson.available ?? []).find((b) => b.currency === "usd");
  console.log(`topped up $${dollarsRaw} (payment_intent ${piJson.id}, livemode=false); available now $${((usd?.amount ?? 0) / 100).toFixed(2)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`::error::${e?.message ?? e}`);
    process.exit(1);
  });
}
