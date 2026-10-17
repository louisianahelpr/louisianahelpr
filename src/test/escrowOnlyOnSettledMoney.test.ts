// @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | ...(!isAsyncPayment ? { payment_status: "escrow" } : {}), | payment_status: "escrow",
// @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | const isAsyncPayment = session.payment_status !== "paid"; | const isAsyncPayment = false;
// @mutate supabase/functions/charge-recurring-visits/index.ts | if (intent.status !== "succeeded") { | if (false) {
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | const FUNDED_PAYMENT_STATES = new Set(["escrow", "payout_pending", "released"]); | const FUNDED_PAYMENT_STATES = new Set(["payout_pending", "released"]);
// @mutate supabase/functions/stripe-webhook/index.ts | "payment_intent.payment_failed": handlePaymentIntentPaymentFailed, | "payment_intent.payment_failedX": handlePaymentIntentPaymentFailed,
// @mutate supabase/migrations/20261017205845_failed_bank_payment_cancels_hired_job.sql |   PERFORM set_config('app.sanctioned_cancel', 'on', true);\n  PERFORM set_config('app.payment_failed_cancel', 'on', true); |   PERFORM set_config('app.payment_failed_cancel', 'on', true);
// @mutate supabase/migrations/20261017205845_failed_bank_payment_cancels_hired_job.sql |   IF COALESCE(current_setting('app.payment_failed_cancel', true), '') = 'on' THEN\n    RETURN NULL;\n  END IF; |   NULL;
// @mutate supabase/migrations/20261017205845_failed_bank_payment_cancels_hired_job.sql |          cancellation_fee = 0, |          cancellation_fee = 1,
// @mutate supabase/migrations/20261017205845_failed_bank_payment_cancels_hired_job.sql |   WHERE id = v_job.id\n     AND stripe_payment_intent_id = p_payment_intent_id\n     AND payment_status IN ('escrow', 'payout_pending'); |   WHERE id = v_job.id;
// @mutate supabase/migrations/20261017205845_failed_bank_payment_cancels_hired_job.sql |       EXECUTE 'SELECT public.return_bounced_gift_card($1, $2)' INTO v_gift USING v_job.id, p_gift_card_id; |       v_gift := NULL;
// @mutate supabase/migrations/20261017205845_failed_bank_payment_cancels_hired_job.sql | GRANT EXECUTE ON FUNCTION public.cancel_job_after_failed_bank_payment(uuid, text, uuid) TO service_role; | GRANT EXECUTE ON FUNCTION public.cancel_job_after_failed_bank_payment(uuid, text, uuid) TO service_role, authenticated;
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
 *  D. (Q1972, owner 2026-10-17) A HIRED job whose bank payment failed is
 *     CANCELLED, not left hired: the handler asks
 *     public.cancel_job_after_failed_bank_payment first, and that RPC's
 *     newest definition is a sanctioned cancel (app.sanctioned_cancel around
 *     its one UPDATE, pinned to the job's PI and a funded state) that charges
 *     no fee, strikes nobody, gives back a gift the checkout spent, and is
 *     service_role only; record_backout_notice's newest definition stays
 *     quiet for it. Behaviour: src/test/pglite/failedBankPaymentCancelsHiredJob
 *     .pglite.mjs; handler: src/test/edge/fundedJobPaymentFailed.test.ts.
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
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
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

describe("a hired job whose bank payment failed is cancelled, not left hired (D, Q1972)", () => {
  const MIGRATIONS = join(REPO, "supabase/migrations");
  const handler = code(join(FUNCTIONS, "stripe-webhook/handlers/paymentIntentPaymentFailed.ts"));

  it("the handler asks the cancel RPC before its own un-fund write, after the released and live-status gates", () => {
    const rpc = handler.indexOf('"cancel_job_after_failed_bank_payment"');
    const released = handler.indexOf('if (job.payment_status === "released") {');
    const live = handler.indexOf("if (!liveStatus || !FAILED_PI_STATUSES.has(liveStatus)) {");
    const unfund = handler.indexOf('.update({ payment_status: "failed", stripe_session_id: null })');
    expect(Math.min(rpc, released, live, unfund)).toBeGreaterThan(-1);
    expect(live).toBeLessThan(released);
    expect(released).toBeLessThan(rpc);
    expect(rpc).toBeLessThan(unfund);
  });

  it("the RPC's newest definition is a sanctioned, fee-free, strike-free cancel pinned to the failing PI", () => {
    const fn = newestFunction("cancel_job_after_failed_bank_payment");
    const body = blankSqlComments(fn.body);
    // One row lock, then the sanctioned hatch around the ONE jobs UPDATE.
    expect(body).toMatch(/FROM public\.jobs j\s+WHERE j\.id = p_job_id\s+FOR UPDATE;/);
    const on = body.indexOf("PERFORM set_config('app.sanctioned_cancel', 'on', true);");
    const quiet = body.indexOf("PERFORM set_config('app.payment_failed_cancel', 'on', true);");
    const upd = body.indexOf("UPDATE public.jobs");
    const off = body.indexOf("PERFORM set_config('app.sanctioned_cancel', 'off', true);");
    expect(Math.min(on, quiet, upd, off)).toBeGreaterThan(-1);
    expect(on).toBeLessThan(upd);
    expect(quiet).toBeLessThan(upd);
    expect(upd).toBeLessThan(off);
    expect(body.match(/UPDATE public\.jobs/g)).toHaveLength(1);
    const update = body.slice(upd, body.indexOf(";", upd));
    expect(update).toMatch(/status = 'cancelled'::job_status/);
    expect(update).toMatch(/payment_status = 'failed'/);
    expect(update).toMatch(/cancellation_fee = 0,/);
    expect(update).toMatch(/cancellation_fee_status = NULL/);
    expect(update).toMatch(/AND stripe_payment_intent_id = p_payment_intent_id\s+AND payment_status IN \('escrow', 'payout_pending'\)/);
    // Nobody is struck and nobody is charged.
    expect(body).not.toMatch(/apply_cancellation_violation_consequence|apply_consequence_ladder|user_violations|crew_cancellation_fee_shares/);
    // A spent gift goes back in the same transaction (Q1876's single put-back).
    expect(body).toMatch(/EXECUTE 'SELECT public\.return_bounced_gift_card\(\$1, \$2\)' INTO v_gift USING v_job\.id, p_gift_card_id;/);
  });

  it("only the service role can run it", () => {
    const fn = newestFunction("cancel_job_after_failed_bank_payment");
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, fn.file), "utf8"));
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.cancel_job_after_failed_bank_payment\(uuid, text, uuid\) FROM PUBLIC, anon, authenticated;/);
    const grants = [...sql.matchAll(/GRANT EXECUTE ON FUNCTION public\.cancel_job_after_failed_bank_payment\([^)]*\) TO ([^;]+);/g)].map((m) => m[1].trim());
    expect(grants).toEqual(["service_role"]);
  });

  it("the back-out notice stays quiet for it (newest record_backout_notice)", () => {
    const body = blankSqlComments(newestFunction("record_backout_notice").body);
    expect(body).toMatch(/IF COALESCE\(current_setting\('app\.payment_failed_cancel', true\), ''\) = 'on' THEN\s+RETURN NULL;\s+END IF;/);
    // ...before any branch that writes a notice.
    expect(body.indexOf("app.payment_failed_cancel")).toBeLessThan(body.indexOf("INSERT INTO public.backout_notices"));
  });
});
