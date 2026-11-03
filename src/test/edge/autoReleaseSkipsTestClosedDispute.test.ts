/**
 * Q1910, the escrow half: auto-release-payment's Phase 2 reads the matured
 * payout_pending jobs, then hands each to release-payout. If an admin closed
 * the job's dispute as a Stripe TEST mode dispute (rpc_close_test_mode_dispute,
 * 20261015061949) after that read, the close moved the job to 'cancelled' and
 * release-payout refused it, which this sweep counted as a failed payout
 * attempt and a run defect (a page). It now asks checkUnsettledDispute first
 * and skips a test-closed job as an outcome (status dispute_closed_as_test),
 * with no release-payout call, no failed attempt and no defect; and a close
 * that lands after that check (release-payout refuses) is the same outcome.
 * Any other refusal is still a failed attempt.
 *
 * Runs the REAL function source via the edge harness, with the REAL
 * _shared/unsettledDispute.ts.
 *
 * @mutate supabase/functions/auto-release-payment/index.ts |         if (testClosedBefore) { |         if (false) {
 * @mutate supabase/functions/auto-release-payment/index.ts |           } else if (await closedAsTest(job.id)) { |           } else if (false) {
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { TEST_MODE_CLOSE_PREFIX } from "../../../supabase/functions/_shared/unsettledDispute.ts";

const CRON_SECRET = "cron-secret-q1910";
const json = async (res: Response) => JSON.parse(await res.text()) as Record<string, unknown>;
const failedAttempts = () =>
  scenario.writes.filter((w) => w.table === "payout_transfers" && w.op === "insert" && (w.payload as { status?: string }).status === "failed");
const CLOSED = { id: "d-test", execution_error: `${TEST_MODE_CLOSE_PREFIX}, no real money moved: both test accounts` };

/** One matured single-Helpr job; `closedRows` answer the test-close read (the decided-unexecuted read is empty). */
function seed(closedRows: unknown[]) {
  scenario.reads.jobs = {
    rows: [],
    selectOverrides: [{
      includes: "payout_scheduled_at",
      result: {
        rows: [{
          id: "job-p", title: "Paint fence", helper_id: "helper-1", budget: 100, urgent_fee: 0,
          is_group_job: false, helpers_needed: 1, payout_scheduled_at: new Date(0).toISOString(), is_seed: false,
        }],
      },
    }],
  };
  scenario.reads.profiles = { rows: [] };
  scenario.reads.gift_cards = { rows: [] };
  scenario.reads.payout_transfers = { rows: [] };
  scenario.reads.payout_holds = { rows: [] };
  scenario.reads.dispute_settlement_claims = { rows: [] };
  scenario.reads.disputes = { rows: [], selectOverrides: [{ includes: "execution_error", result: { rows: closedRows } }] };
}

async function run() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc", CRON_SECRET, RELEASE_PAYOUT_AUTO: "1",
  });
  const fn = await loadEdgeFunction("auto-release-payment");
  return fn.fetch(fn.request({ method: "POST", url: "https://edge.test/auto-release-payment", headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
}

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Q1910: auto-release-payment skips a job whose dispute was closed as a test", () => {
  it("does not hand it to release-payout, records no failed attempt, and the run is not a defect", async () => {
    seed([CLOSED]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, stripe_transfer_id: "tr_x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await run();
    const body = await json(res);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body.paid).toBe(0);
    expect(body.payoutResults).toEqual([{ job_id: "job-p", status: "dispute_closed_as_test", detail: "d-test" }]);
    expect(failedAttempts()).toHaveLength(0);
    expect(res.status).toBe(200);
  });

  it("a close that lands after the check (release-payout refuses the cancelled job) is the same outcome", async () => {
    seed([]);
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      // The close commits while release-payout runs: the sweep's re-check now finds it.
      scenario.reads.disputes = { rows: [], selectOverrides: [{ includes: "execution_error", result: { rows: [CLOSED] } }] };
      return new Response(JSON.stringify({ error: "payment_status is cancelled, expected payout_pending" }), { status: 409 });
    }));
    const res = await run();
    const body = await json(res);
    expect(calls).toBe(1);
    expect((body.payoutResults as Array<{ status: string }>)[0].status).toBe("dispute_closed_as_test");
    expect(failedAttempts()).toHaveLength(0);
    expect(res.status).toBe(200);
  });

  it("control: the same refusal with no test close is still a failed attempt and a defect", async () => {
    seed([]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "payment_status is cancelled, expected payout_pending" }), { status: 409 })));
    const res = await run();
    const body = await json(res);
    expect((body.payoutResults as Array<{ status: string }>)[0].status).toBe("failed");
    expect(failedAttempts()).toHaveLength(1);
    expect(res.status).not.toBe(200);
  });

  it("control: a real executed split (another execution_error) is paid as before", async () => {
    seed([{ id: "d-real", execution_error: "transfer retried" }]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, stripe_transfer_id: "tr_x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const body = await json(await run());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body.paid).toBe(1);
  });
});
