/**
 * The READ ALLOWANCE of scripts/perf/cwv-lab.mjs (`--allow-reads`): which of a
 * signed-in prod screen's non-GET requests are reads of the test account's own
 * data and may pass the lab's write block. Its own module (no shebang) so the
 * vitest guard src/test/cwvLabBlocksProdWrites.test.ts can import it.
 *
 * `reads` is null unless the run passed --allow-reads; `reads.rpcs` is the
 * comma list of prod's STABLE/IMMUTABLE public functions (pg_proc.provolatile),
 * `reads.refresh` is set only for an --expired run.
 */
export function allowedRead(reads, method, url, body) {
  if (!reads || method !== "POST") return null;
  const u = new URL(url);
  if (!/(^|\.)supabase\.co$/.test(u.hostname)) return null;
  const rpc = /^\/rest\/v1\/rpc\/([A-Za-z0-9_]+)$/.exec(u.pathname)?.[1];
  if (rpc) return reads.rpcs.has(rpc) ? `rpc:${rpc}` : null;
  if (reads.refresh && u.pathname === "/auth/v1/token" && u.searchParams.get("grant_type") === "refresh_token") return "auth:refresh";
  if (u.pathname === "/functions/v1/stripe-connect") {
    let action = null;
    try { action = JSON.parse(body ?? "")?.action ?? null; } catch { /* not JSON: not the status read */ }
    return action === "status" ? "fn:stripe-connect:status" : null;
  }
  return null;
}


/**
 * The MOCKED READS of `--allow-reads`: a non-GET read the lab ANSWERS ITSELF
 * with fixed test data, so the request never leaves the browser (no prod, no
 * Stripe). stripe-payouts' list read (POST /functions/v1/stripe-payouts with
 * no payout_id) calls Stripe's LIVE balance and payouts API server side, so
 * letting it through is not an option; blocked, Money (/profile?tab=earnings)
 * measured its "We couldn't load your payout data." error state (B67, 10-31).
 * The payout-detail read (a payout_id) and every other function stay blocked.
 * Returns { read, body } (the JSON to fulfill with) or null.
 */
export const LAB_STRIPE_PAYOUTS = Object.freeze({
  connected: true,
  payouts_enabled: true,
  available: [{ amount: 12_500, currency: "usd" }],
  pending: [{ amount: 4_200, currency: "usd" }],
  instant_available: [{ amount: 0, currency: "usd" }],
  payouts: [
    { id: "po_lab_test_1", amount: 8_000, currency: "usd", status: "paid", arrival_date: 1_793_000_000, method: "standard", created: 1_792_900_000, description: "lab test data" },
    { id: "po_lab_test_2", amount: 3_500, currency: "usd", status: "in_transit", arrival_date: 1_793_400_000, method: "standard", created: 1_793_300_000, description: "lab test data" },
  ],
});

export function mockedRead(reads, method, url, body) {
  if (method !== "POST" || !reads) return null;
  const u = new URL(url);
  if (!/\.supabase\.co$/.test(u.hostname)) return null;
  if (u.pathname !== "/functions/v1/stripe-payouts") return null;
  let parsed = null;
  try { parsed = JSON.parse(body || "{}"); } catch { /* not JSON: not the list read */ }
  if (!parsed || typeof parsed !== "object" || "payout_id" in parsed) return null;
  return { read: "mock:stripe-payouts:list", body: LAB_STRIPE_PAYOUTS };
}
