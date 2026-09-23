/**
 * Q244: the job writes in the transfer.canceled / transfer.failed /
 * transfer.reversed webhook handlers must SEE a zero-row match.
 *
 * Each is a CAS on `payment_status = 'released'`. A job that is not 'released'
 * when the event lands (refunded, charged back, the flip to released never
 * happened) matches zero rows, and PostgREST answers `{ data: [], error: null }`.
 * Before Q244 the handlers read only `error`, so:
 *   - canceled / failed logged "job reset to payout_pending for retry" over a
 *     job that was never re-queued (the Helpr silently unpaid);
 *   - reversed logged "job frozen" over a job with NO reversal_hold, which is
 *     payable again on money Stripe already clawed back.
 * Now each write ends in `.select("id")` and zero rows pages ops as critical,
 * the way release-payout pages its zero-row flip. It does not throw: a retry
 * cannot change the match.
 *
 * Runs the REAL handler source via the edge harness.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/transferCanceled.ts | if ((resetRows?.length ?? 0) === 0) { | if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/transferFailed.ts | if ((resetRows?.length ?? 0) === 0) { | if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/transferReversed.ts | } else if ((frozenRows?.length ?? 0) === 0) { | } else if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/transferCanceled.ts | .eq("payment_status", "released")\n      .select("id"); | .eq("payment_status", "released");
 * @mutate supabase/functions/stripe-webhook/handlers/transferReversed.ts | .eq("payment_status", "released")\n      .select("id"); | .eq("payment_status", "released");
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
const jobUpdates = () => scenario.writes.filter((w) => w.table === "jobs" && w.op === "update");

const TYPES = ["transfer.canceled", "transfer.failed", "transfer.reversed"] as const;

function arrange(type: string, jobRowsMatched: Array<{ id: string }>) {
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: `evt_q244_${type}_${jobRowsMatched.length}`,
    type,
    data: {
      object: { id: "tr_q244", amount: 5000, destination: "acct_helper", failure_message: "closed" },
    },
  });
  scenario.writeSelectRows.payout_transfers = [{ job_id: "job-q244" }];
  scenario.writeSelectRows["jobs:update"] = jobRowsMatched;
  scenario.reads.jobs = {
    rows: [{ id: "job-q244", status: "completed", payment_status: "released", dispute_status: null, disputed_at: null }],
  };
}

describe("Q244: transfer webhook job flips page on a zero-row match", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("inventory: all three handlers still write the job (floor)", async () => {
    let written = 0;
    for (const type of TYPES) {
      resetSupabaseMock();
      resetSharedMocks();
      const fn = await loadConfigured();
      arrange(type, [{ id: "job-q244" }]);
      await deliver(fn);
      written += jobUpdates().length;
    }
    expect(written).toBeGreaterThan(2);
  });

  for (const type of TYPES) {
    it(`${type}: the job write reads back its row count`, async () => {
      const fn = await loadConfigured();
      arrange(type, [{ id: "job-q244" }]);
      await deliver(fn);
      const w = jobUpdates();
      expect(w.length).toBe(1);
      expect(w[0].selectCols).toBe("id");
    });

    it(`${type}: zero rows matched pages ops as critical and still acks (no retry storm)`, async () => {
      const fn = await loadConfigured();
      arrange(type, []);
      const res = await deliver(fn);
      expect(res.status).toBe(200);
      const page = alerts().find((a) => a.severity === "critical" && /zero rows/i.test(a.title));
      expect(page, `no critical zero-row page for ${type}`).toBeTruthy();
    });

    it(`${type}: one row matched raises no zero-row page`, async () => {
      const fn = await loadConfigured();
      arrange(type, [{ id: "job-q244" }]);
      await deliver(fn);
      expect(alerts().some((a) => /zero rows/i.test(a.title))).toBe(false);
    });
  }

  it("transfer.reversed: zero rows does not also post the routine 'Investigate and reconcile' warning", async () => {
    const fn = await loadConfigured();
    arrange("transfer.reversed", []);
    await deliver(fn);
    expect(alerts().some((a) => a.severity === "warning" && a.title === "Helpr payout reversed")).toBe(false);
  });
});
