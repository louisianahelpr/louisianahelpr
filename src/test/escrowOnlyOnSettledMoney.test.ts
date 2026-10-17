// @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | ...(!isAsyncPayment ? { payment_status: "escrow" } : {}), | payment_status: "escrow",
// @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | const isAsyncPayment = session.payment_status !== "paid"; | const isAsyncPayment = false;
// @mutate supabase/functions/charge-recurring-visits/index.ts | if (intent.status !== "succeeded") { | if (false) {
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | const FUNDED_PAYMENT_STATES = new Set(["escrow", "payout_pending", "released"]); | const FUNDED_PAYMENT_STATES = new Set(["payout_pending", "released"]);
// @mutate supabase/functions/stripe-webhook/index.ts | "payment_intent.payment_failed": handlePaymentIntentPaymentFailed, | "payment_intent.payment_failedX": handlePaymentIntentPaymentFailed,
/**
 * CLASS GUARD: a job is 'escrow' only once the poster's money has ARRIVED, and
 * leaves it when that money fails (ach-fix, 2026-10-17).
 *
 * The incident: real job 7440a72d was paid by ACH. checkout.session.completed
 * set 'escrow' while the bank debit was pending (before ME-046, 10-16); the
 * debit failed on 10-15 and the failure handler ignored any job past unpaid,
 * so the job stayed funded on paper and was hired, offered and re-broadcast.
 *
 * Three layers, each inventoried from source so a new path cannot slip past:
 *
 *  A. Every edge-function write of `payment_status: "escrow"` is in
 *     ESCROW_WRITERS with the gate that proves the money settled (a checkout
 *     whose session.payment_status is "paid", the payment_intent.succeeded
 *     event, or a PaymentIntent read as "succeeded"). Exact both ways: a new
 *     writer fails until it is listed with its gate, a removed one fails until
 *     it is unlisted.
 *  B. The payment-failure handler un-funds EVERY state the database calls
 *     funded (public.job_payment_is_funded, newest migration), and is the
 *     handler wired to payment_intent.payment_failed. A funded state the
 *     handler does not know is the 7440a72d hole again.
 *  C. Every edge function that sends a Stripe transfer AND reads a job's
 *     stripe_payment_intent_id refuses when that PaymentIntent is not
 *     succeeded. The behaviour is proven per path in their own edge tests
 *     (release-payout, process-scheduled-payouts, auto-release-payment,
 *     execute-dispute-split); this keeps the inventory exact.
 *
 * Not covered here, by design: SQL RPCs that set 'escrow' for jobs paid with
 * platform credit or a gift card. No bank debit stands behind those, so there
 * is nothing that can arrive late or bounce.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { newestFunction } from "./helpers/parityReaders";

const REPO = resolve(__dirname, "../..");
const FUNCTIONS = join(REPO, "supabase/functions");

function edgeSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts") && !/\.test\.ts$|_test\.ts$/.test(p)) out.push(p);
    }
  };
  walk(FUNCTIONS);
  return out;
}
const code = (abs: string) => blankComments(readFileSync(abs, "utf8"));
const rel = (abs: string) => relative(FUNCTIONS, abs);

/** file -> regexes that must ALL match its code, proving the escrow write waits for settled money. */
const ESCROW_WRITERS: Record<string, { why: string; gates: RegExp[] }> = {
  "stripe-webhook/handlers/checkoutSessionCompleted.ts": {
    why: "only a checkout Stripe reports PAID (card/Link); an ACH session completes unpaid and waits for payment_intent.succeeded (ME-046)",
    gates: [
      /const isAsyncPayment = session\.payment_status !== "paid";/,
      /\.\.\.\(!isAsyncPayment \? \{ payment_status: "escrow" \} : \{\}\)/,
    ],
  },
  "stripe-webhook/handlers/paymentIntentSucceeded.ts": {
    why: "runs only for payment_intent.succeeded: the money has arrived",
    gates: [/export async function handlePaymentIntentSucceeded\(/],
  },
  "charge-recurring-visits/index.ts": {
    why: "books a visit only after its off-session PaymentIntent reads succeeded",
    gates: [/if \(intent\.status !== "succeeded"\) \{/],
  },
};

const ESCROW_WRITE = /payment_status\s*:\s*["'`]escrow["'`]/;

describe("escrow is set only on settled money (A)", () => {
  const writers = edgeSources().filter((f) => ESCROW_WRITE.test(code(f))).map(rel).sort();

  it("the inventory found the writers (floor)", () => {
    expect(writers.length).toBeGreaterThan(2);
  });

  it("every edge-function escrow write is listed, and every listed one still writes", () => {
    expect(writers).toEqual(Object.keys(ESCROW_WRITERS).sort());
  });

  for (const [file, { why, gates }] of Object.entries(ESCROW_WRITERS)) {
    it(`${file} waits for settled money: ${why}`, () => {
      const src = code(join(FUNCTIONS, file));
      for (const g of gates) expect(src, `${file} lost its gate ${g}`).toMatch(g);
    });
  }

  it("charge-recurring-visits refuses before it books (gate precedes the escrow insert)", () => {
    const src = code(join(FUNCTIONS, "charge-recurring-visits/index.ts"));
    const gate = src.search(/if \(intent\.status !== "succeeded"\) \{/);
    const write = src.search(ESCROW_WRITE);
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(write);
  });

  it("paymentIntentSucceeded is the handler wired to payment_intent.succeeded", () => {
    const idx = code(join(FUNCTIONS, "stripe-webhook/index.ts"));
    expect(idx).toMatch(/"payment_intent\.succeeded": handlePaymentIntentSucceeded,/);
  });
});

describe("a payment failure un-funds every funded state (B)", () => {
  it("the failure handler's funded set equals public.job_payment_is_funded's", () => {
    const fn = newestFunction("job_payment_is_funded");
    const dbStates = [...fn.body.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
    expect(dbStates.length).toBeGreaterThan(1);
    const handler = code(join(FUNCTIONS, "stripe-webhook/handlers/paymentIntentPaymentFailed.ts"));
    const m = /const FUNDED_PAYMENT_STATES = new Set\(\[([^\]]*)\]\)/.exec(handler);
    expect(m, "FUNDED_PAYMENT_STATES not found in paymentIntentPaymentFailed.ts").not.toBeNull();
    const handlerStates = [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
    expect(handlerStates).toEqual(dbStates);
    // ...and the funded branch runs before the unpaid-only CAS path.
    expect(handler).toMatch(/if \(failedJob && FUNDED_PAYMENT_STATES\.has\(String\(failedJob\.payment_status\)\)\) \{\s*await unfundFailedEscrow\(/);
  });

  it("it is the handler wired to payment_intent.payment_failed", () => {
    const idx = code(join(FUNCTIONS, "stripe-webhook/index.ts"));
    expect(idx).toMatch(/"payment_intent\.payment_failed": handlePaymentIntentPaymentFailed,/);
  });
});

describe("every escrow payout path refuses an unsucceeded charge (C)", () => {
  // Transfers that never draw on a job's PaymentIntent (Helpr balance,
  // platform credit, Declutter orders, clawbacks, crew fees, held tips).
  const PAYOUT_FROM_JOB_PI = [
    "create-payment/index.ts",
    "execute-dispute-split/index.ts",
    "process-scheduled-payouts/index.ts",
    "release-payout/index.ts",
    "void-cancelled-payments/index.ts",
  ];
  const files = edgeSources()
    .filter((f) => {
      const s = code(f);
      return /\.transfers\.create\(/.test(s) && /stripe_payment_intent_id/.test(s);
    })
    .map(rel)
    .sort();

  it("the inventory is exact", () => {
    expect(files.length).toBeGreaterThan(3);
    expect(files).toEqual(PAYOUT_FROM_JOB_PI);
  });

  for (const f of PAYOUT_FROM_JOB_PI) {
    it(`${f} reads the PaymentIntent's status before paying from it`, () => {
      expect(code(join(FUNCTIONS, f))).toMatch(/\.status\s*(?:!==|===)\s*"succeeded"/);
    });
  }
});
