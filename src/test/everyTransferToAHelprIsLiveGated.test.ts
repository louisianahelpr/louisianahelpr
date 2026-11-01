/**
 * Every `stripe.transfers.create` that sends money TO a Connect account first
 * asks Stripe, live, whether that account is payable, and holds the money when
 * it is not (lead, 2026-10-23: Stripe rejected the platform and its connected
 * accounts; prod gets no Connect events, Q876, so the cached gate on profiles
 * read payable for 13 of 34 accounts).
 *
 * The class, EXACT both ways: every transfers.create site in supabase/functions
 * is listed here, either GATED (the file calls holdUnlessPayable,
 * _shared/livePayoutHold.ts, before the site, at least once per gated site) or
 * with the reason it is not (its own live check, or money that does not go to
 * a Helpr). A new sender fails this until it is gated or explained.
 *
 * Limit, stated: "before the site" is textual (an earlier holdUnlessPayable call
 * in the same file), not a control-flow proof. Each gated sender also has a
 * behavioural test that a rejected account moves no money.
 *
 * @mutate supabase/functions/_shared/heldTipRepay.ts |       const live = await holdUnlessPayable({ |       const live = await (async (_: unknown) => ({ held: false as const }))({
 * @mutate supabase/functions/_shared/crewBlockFees.ts |     const live = await holdUnlessPayable({ |     const live = await (async (_: unknown) => ({ held: false as const }))({
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "../..");
const FN_DIR = path.join(ROOT, "supabase/functions");
const SITE = /\.transfers\.create\(/g;
const GATE = /\bholdUnlessPayable\(/g;

type Entry = { sites: number } & ({ gated: true } | { gated: false; why: string });

const SENDERS: Record<string, Entry> = {
  "supabase/functions/process-scheduled-payouts/index.ts": { sites: 1, gated: true },
  "supabase/functions/create-payment/index.ts": { sites: 1, gated: true },
  "supabase/functions/cash-out-credits/index.ts": { sites: 1, gated: true },
  "supabase/functions/execute-dispute-split/index.ts": { sites: 1, gated: true },
  "supabase/functions/void-cancelled-payments/index.ts": { sites: 2, gated: true },
  "supabase/functions/_shared/crewBlockFees.ts": { sites: 1, gated: true },
  "supabase/functions/_shared/chargebackClawback.ts": { sites: 1, gated: true },
  "supabase/functions/_shared/heldTipRepay.ts": { sites: 1, gated: true },
  "supabase/functions/release-payout/index.ts": {
    sites: 1,
    gated: false,
    why: "its own live accounts.retrieve right before the transfer, on the same three facts as the shared gate (payouts and charges enabled, transfers capability active, not rejected) plus a rejected platform (409 codes auto-release-payment reads as held)",
  },
  "supabase/functions/declutter-money/index.ts": {
    sites: 4, // + manager mode phase 2b: the manager's share, same live gate (payeeReadyNow)
    gated: false,
    why: "its own live gate before every transfer (_shared/connectReadiness.ts readConnectReadiness: transfers capability active, else deferred)",
  },
  "supabase/functions/instant-payout/index.ts": {
    sites: 1,
    gated: false,
    why: "sends the instant-payout FEE from the Helpr's own account to the platform (stripeAccount header): money leaves the Helpr, never goes to them",
  },
};

/**
 * Destination charges (`transfer_data`) also send money to a Connect account,
 * as part of the CHARGE, not a transfer. Listed (exact, both ways) and NOT
 * live-gated (lead 2026-10-23): Stripe refuses a destination charge whose
 * destination cannot receive money, before any money moves ("Stripe-refused,
 * handled"). Each site turns that refusal into a plain sentence for the member
 * and an ops alert (error_logs) through noteDestinationChargeRefused, proven by
 * the named test. (The exact refusal sentence on our account is not measured.)
 */
const DESTINATION_CHARGES: Record<string, { sites: number; test: string; proof: string }> = {
  "supabase/functions/create-payment/index.ts": {
    sites: 1,
    test: "src/test/edge/create-payment.test.ts",
    proof: "Stripe-refused, handled",
  },
  "supabase/functions/auto-tip-charge/index.ts": {
    sites: 1,
    test: "src/test/edge/auto-tip-charge.test.ts",
    proof: "Stripe-refused, handled",
  },
  // Declutter delivery tips (Q2453): the job tip's destination charge, to the delivery Helpr. (A HELD tip, owner
  // #3706, has no transfer_data: it is charged on the platform and declutter-money's own live gate sends it.)
  "supabase/functions/declutter-checkout/index.ts": {
    sites: 1,
    test: "src/test/edge/declutter-delivery-tip.test.ts",
    proof: "Stripe-refused, handled",
  },
};

function codeOf(file: string): string {
  return blankComments(readSource(file) ?? "");
}

describe("every transfer to a Connect account is live-gated", () => {
  it("the inventory of transfers.create sites is exact, both ways", () => {
    const found: Record<string, number> = {};
    for (const f of walkSource([FN_DIR])) {
      const n = (codeOf(f).match(SITE) ?? []).length;
      if (n > 0) found[path.relative(ROOT, f).split(path.sep).join("/")] = n;
    }
    expect(Object.keys(found).length, "inventory floor: the walker found the senders").toBeGreaterThanOrEqual(8);
    expect(found).toEqual(Object.fromEntries(Object.entries(SENDERS).map(([f, e]) => [f, e.sites])));
  });

  it("the destination charges (transfer_data) are listed, exact both ways", () => {
    const found: Record<string, number> = {};
    for (const f of walkSource([FN_DIR])) {
      const n = (codeOf(f).match(/\btransfer_data\s*:/g) ?? []).length;
      if (n > 0) found[path.relative(ROOT, f).split(path.sep).join("/")] = n;
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(DESTINATION_CHARGES).map(([f, e]) => [f, e.sites])));
  });

  for (const [file, e] of Object.entries(DESTINATION_CHARGES)) {
    it(`${file}: Stripe's refusal is handled out loud, and a test proves it`, () => {
      expect(codeOf(path.join(ROOT, file))).toMatch(/\bnoteDestinationChargeRefused\(/);
      expect(readSource(path.join(ROOT, e.test)) ?? "").toContain(e.proof);
    });
  }

  for (const [file, e] of Object.entries(SENDERS)) {
    if (!e.gated) {
      it(`${file} is not gated here, for a stated reason`, () => {
        expect(e.why.length).toBeGreaterThan(20);
      });
      continue;
    }
    it(`${file}: every transfer is preceded by holdUnlessPayable`, () => {
      const src = codeOf(path.join(ROOT, file));
      const sites = [...src.matchAll(SITE)].map((m) => m.index ?? 0);
      const gates = [...src.matchAll(GATE)].map((m) => m.index ?? 0);
      expect(gates.length, `${file} calls holdUnlessPayable at least once per transfer`).toBeGreaterThanOrEqual(sites.length);
      for (const s of sites) {
        expect(gates.some((g) => g < s), `${file}: a holdUnlessPayable call comes before the transfer at offset ${s}`).toBe(true);
      }
    });
  }
});
