/**
 * LOW-2: a single-Helpr cancellation-fee transfer settles its OWN ledger row
 * (cancellation_fee_transfers) in the Stripe transfer webhooks, and nothing
 * else.
 *
 * Before LOW-2 void-cancelled-payments sent the fee with no ledger row at all,
 * so transfer.created / failed / canceled / reversed for a fee either matched
 * nothing in payout_transfers (failure invisible) or, keyed by job, could be
 * mistaken for the job's payout. Now each handler routes metadata.type =
 * "cancellation_fee" (without share_id) to settleCancellationFeeTransfer, which
 * moves the row named by metadata.fee_transfer_id under a status precondition,
 * never re-points a row that records a different transfer, and pages when no
 * row matched. Crew shares (share_id) keep the existing path.
 *
 * Runs the REAL handler source via the edge harness.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/_cancellationFeeLedger.ts | return md.type === "cancellation_fee" && !md.share_id; | return false;
 * @mutate supabase/functions/stripe-webhook/handlers/_cancellationFeeLedger.ts | if (!rowId) { | if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/_cancellationFeeLedger.ts | q = q.or( | void (
 * @mutate supabase/functions/stripe-webhook/handlers/_cancellationFeeLedger.ts | q = q.eq("id", md.fee_transfer_id); | q = q;
 * @mutate supabase/functions/stripe-webhook/handlers/transferCreated.ts |   if (isSingleHelprFeeTransfer(transfer)) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/transferFailed.ts |   if (isSingleHelprFeeTransfer(transfer)) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/transferCanceled.ts |   if (isSingleHelprFeeTransfer(transfer)) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/transferReversed.ts |   if (isSingleHelprFeeTransfer(transfer)) { |   if (false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}

function deliver(fn: EdgeHarness) {
  return fn.fetch(
    fn.request({
      rawBody: "{}",
      headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" },
    }),
  );
}

type Alert = { severity: string; title: string; kind: string };
const alerts = () => slackAlerts as unknown as Alert[];
const writesTo = (table: string) => scenario.writes.filter((w) => w.table === table);

const FEE_MD = { type: "cancellation_fee", job_id: "job-1", helper_id: "helper-1", fee_transfer_id: "fee-1" };

function arrange(type: string, metadata: Record<string, string> = FEE_MD) {
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: `evt_low2_${type}`,
    type,
    data: {
      object: {
        id: "tr_fee",
        amount: 13200,
        amount_reversed: 13200,
        destination: "acct_helper",
        failure_message: "account closed",
        metadata,
      },
    },
  });
  scenario.writeSelectRows["cancellation_fee_transfers:update"] = [{ id: "fee-1" }];
  scenario.writeSelectRows.payout_transfers = [{ job_id: "job-1" }];
  scenario.reads.jobs = {
    rows: [{ id: "job-1", status: "cancelled", payment_status: "refunded", dispute_status: null, disputed_at: null }],
  };
}

const CASES = [
  { type: "transfer.created", status: "paid", from: ["pending", "failed", "paid"], pages: null },
  { type: "transfer.failed", status: "failed", from: ["pending", "paid", "failed"], pages: "Helpr cancellation-fee transfer failed" },
  { type: "transfer.canceled", status: "failed", from: ["pending", "paid", "failed"], pages: "Helpr cancellation-fee transfer canceled" },
  { type: "transfer.reversed", status: "reversed", from: ["pending", "paid", "failed", "reversed"], pages: "Helpr cancellation-fee transfer reversed" },
] as const;

describe("LOW-2: transfer webhooks settle the cancellation-fee ledger", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  for (const c of CASES) {
    it(`${c.type}: moves only its fee ledger row to '${c.status}', keyed by fee_transfer_id`, async () => {
      const fn = await loadConfigured();
      arrange(c.type);
      const res = await deliver(fn);
      expect(res.status).toBe(200);

      const w = writesTo("cancellation_fee_transfers");
      expect(w.length).toBe(1);
      expect(w[0].op).toBe("update");
      expect((w[0].payload as Record<string, unknown>).status).toBe(c.status);
      expect((w[0].payload as Record<string, unknown>).stripe_transfer_id).toBe("tr_fee");
      expect(w[0].selectCols).toBe("id");
      const f = w[0].filters;
      expect(f).toContainEqual(expect.objectContaining({ op: "eq", column: "id", value: "fee-1" }));
      expect(f).toContainEqual(expect.objectContaining({ op: "in", column: "status", value: [...c.from] }));
      expect(f).toContainEqual(
        expect.objectContaining({ op: "or", value: "stripe_transfer_id.is.null,stripe_transfer_id.eq.tr_fee" }),
      );

      // Not a job payout: no payout_transfers row, no job flip.
      expect(writesTo("payout_transfers")).toEqual([]);
      expect(writesTo("jobs")).toEqual([]);
    });

    it(`${c.type}: zero ledger rows matched pages money_at_risk and still acks`, async () => {
      const fn = await loadConfigured();
      arrange(c.type);
      scenario.writeSelectRows["cancellation_fee_transfers:update"] = [];
      const res = await deliver(fn);
      expect(res.status).toBe(200);
      const page = alerts().find(
        (a) => a.kind === "money_at_risk" && a.title === `Cancellation-fee transfer ${c.status} with no matching ledger row`,
      );
      expect(page, `no money_at_risk page for ${c.type}`).toBeTruthy();
      // The success-path page is not also posted for a row that did not move.
      if (c.pages) expect(alerts().some((a) => a.title === c.pages)).toBe(false);
      expect(writesTo("payout_transfers")).toEqual([]);
      expect(writesTo("jobs")).toEqual([]);
    });

    it(`${c.type}: a DB error on the ledger write returns 500 so Stripe redelivers`, async () => {
      const fn = await loadConfigured();
      arrange(c.type);
      scenario.writeErrors.cancellation_fee_transfers = { message: "boom" };
      const res = await deliver(fn);
      expect(res.status).toBe(500);
    });

    if (c.pages) {
      it(`${c.type}: a moved row pages ops '${c.pages}'`, async () => {
        const fn = await loadConfigured();
        arrange(c.type);
        await deliver(fn);
        const page = alerts().find((a) => a.title === c.pages);
        expect(page).toBeTruthy();
        expect(page!.severity).toBe("critical");
        expect(alerts().some((a) => a.kind === "money_at_risk")).toBe(false);
      });
    }
  }

  it("transfer.created: a pre-ledger fee transfer (no fee_transfer_id) keys by job + Helpr", async () => {
    const fn = await loadConfigured();
    arrange("transfer.created", { type: "cancellation_fee", job_id: "job-1", helper_id: "helper-1" });
    await deliver(fn);
    const w = writesTo("cancellation_fee_transfers");
    expect(w.length).toBe(1);
    expect(w[0].filters).toContainEqual(expect.objectContaining({ op: "eq", column: "job_id", value: "job-1" }));
    expect(w[0].filters).toContainEqual(expect.objectContaining({ op: "eq", column: "helper_id", value: "helper-1" }));
    expect(w[0].filters.some((x) => x.op === "eq" && x.column === "id")).toBe(false);
  });

  it("a crew share (share_id) is not this ledger: it never writes cancellation_fee_transfers", async () => {
    for (const c of CASES) {
      resetSupabaseMock();
      resetSharedMocks();
      const fn = await loadConfigured();
      arrange(c.type, { type: "cancellation_fee", job_id: "job-1", helper_id: "helper-1", share_id: "share-1" });
      await deliver(fn);
      expect(writesTo("cancellation_fee_transfers"), c.type).toEqual([]);
    }
  });
});
