// Pure classification for scripts/audit/prod-seed.mjs's `--verify` rows. No
// top-level side effects, no env/CLI access — prod-seed.mjs itself exits if
// imported outside a --mode CLI invocation (`if (!MODE) { ...; process.exit(2) }`),
// so this is split out here specifically so a vitest guard can import it directly.
//
// "Money state" = a job/payment status or money-ledger row (payout_transfers,
// tips) that only a REAL, completed Stripe payment produces. `--apply` never
// writes one (jobBase is always payment_status "unpaid"), and Stripe is LIVE
// on prod pre-launch, so the standing rule (never complete a live payment to
// seed test data) means these can never be seeded before launch.
//
// Owner decision 2026-10-02 (prod-seed --verify measured 27/55 states present,
// 28 missing that run): accept the money states as unseedable before launch;
// `--verify` must mark a MISSING money state "expected-unseeded" (still a
// pass) rather than a defect, while any OTHER missing state still fails.
//
// The money states are identified by the `source` tag `check()` already
// passes them in prod-seed.mjs (`"real flow"`), not by a separate list here —
// a second list would drift from the first. See src/test/prodSeedMoneyStatesExpectedUnseeded.test.ts
// for the exact count measured in prod-seed.mjs's source (17 "real flow" rows
// as of 2026-10-02: 6 job-status + 9 payment-status + payout_transfers + tips).
export const MONEY_STATE_SOURCE = "real flow";

/**
 * @param {{ n: number, min: number, err: string, source: string }} row
 * @returns {{ ok: boolean, expectedUnseeded: boolean }}
 */
export function classifyVerifyRow({ n, min, err, source }) {
  const passed = !err && n >= min;
  // A query ERROR is never "expected-unseeded" — that would silently swallow
  // a broken query (CLAUDE.md: never drop the error) behind the same label as
  // a row that's merely absent because no live Stripe payment has run. Only a
  // clean, merely-short-of-min result on a money-state source gets the pass.
  const expectedUnseeded = !err && !passed && source === MONEY_STATE_SOURCE;
  return { ok: passed || expectedUnseeded, expectedUnseeded };
}
