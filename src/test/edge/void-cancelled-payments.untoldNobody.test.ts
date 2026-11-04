/**
 * Q2726 (live alert 11-04; lh-money-escrow review of ready/b109-money-test-alerts): the hourly untold-refund sweep
 * (Part G) still TRIES a ledger row that names no job and no member, because a live Dashboard refund of a tip or a
 * gift card writes exactly such a row and the refund notice finds the tipper or the donor from the payment. Only when
 * even that finds nobody (no_recipient) is the row counted and sent to the seed digest instead of paging every hour.
 *
 * @mutate supabase/functions/void-cancelled-payments/index.ts |             const nobodyToTell = !!problem && result.status === "no_recipient" && !result.error && !r.customer_id && !r.job_id; |             const nobodyToTell = false;
 * @mutate supabase/functions/void-cancelled-payments/index.ts |                 ...(nobodyToTell ? { seed: true } : {}), |
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

const CRON_SECRET = "cron-secret-untold";
const TIPPER = "44444444-4444-4444-8444-444444444444";
const ROW = {
  stripe_refund_id: "re_tip_dash", stripe_payment_intent_id: "pi_tip_dash", job_id: null, customer_id: null,
  amount_cents: 500, source: "stripe_dashboard", created_at: new Date(Date.now() - 60 * 60_000).toISOString(),
};

function seedSweep(tipper: string | null) {
  scenario.reads.jobs = { rows: [] };
  scenario.reads.group_job_helpers = { rows: [] };
  scenario.reads.payment_refunds = { rows: [ROW] };
  scenario.reads.refund_notices = { rows: [] };
  scenario.reads.tips = { rows: tipper ? [{ tipper_id: tipper }] : [] };
  scenario.reads.gift_cards = { rows: [] };
}

async function run() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_real_money", STRIPE_TEST_SECRET_KEY: "sk_test_sandbox", CRON_SECRET,
  });
  const fn = await loadEdgeFunction("void-cancelled-payments");
  const res = await fn.fetch(
    new Request("https://x/functions/v1/void-cancelled-payments", { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } }),
  );
  return { res, body: JSON.parse(await res.text()) as Record<string, unknown> };
}

const pages = () => slackAlerts.filter((a) => (a as { title?: string }).title === "Money went back to a poster who was not fully told");

describe("void-cancelled-payments Part G: a ledger row with no job and no member", () => {
  beforeEach(() => { resetEnv(); resetSupabaseMock(); resetStripeMock(); resetSharedMocks(); });
  afterEach(() => resetEnv());

  it("a live tip's Dashboard refund is still retried and the tipper is told", async () => {
    seedSweep(TIPPER);
    const { body } = await run();
    expect(body.untold_refunds_sent).toBe(1);
    expect(body.untold_refunds_nobody).toBe(0);
    const told = scenario.writes.filter((w) => w.table === "notifications").map((w) => w.payload as Record<string, unknown>);
    expect(told.some((n) => n.user_id === TIPPER)).toBe(true);
    expect(pages()).toHaveLength(0);
  });

  it("nobody to tell at all: counted and sent to the seed digest, never a page or a defect", async () => {
    seedSweep(null);
    const { body } = await run();
    expect(body.untold_refunds_sent).toBe(0);
    expect(body.untold_refunds_nobody).toBe(1);
    expect(String(body.defectReasons ?? "")).not.toContain("re_tip_dash");
    expect(pages()).toHaveLength(1);
    expect(pages()[0]).toEqual(expect.objectContaining({ seed: true }));
  });
});
