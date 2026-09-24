/**
 * ME-015: instant-payout takes its fee (a transfer out of the helper's Connect
 * balance) BEFORE the payout. When the payout then fails, the helper is out the
 * fee, and the only trace used to be a substring in instant_payouts.error_message
 * (Slack fired only if that DB write itself failed). Also: the skipped-fee
 * branch (platform account unreadable) only logged, and the payout-failure write
 * overwrote the fee_uncollected marker.
 */
//
// @mutate supabase/functions/instant-payout/index.ts |       if (feeCents > 0 && feeTransferSucceeded) { |       if (false) {
// @mutate supabase/functions/instant-payout/index.ts |       let fullError = feeMarker ? `${feeMarker} \| ${msg}` : msg; |       let fullError = msg;
// @mutate supabase/functions/instant-payout/index.ts |             message: "The platform Stripe account could not be read |             kind: "x", message: "The platform Stripe account could not be read
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

let fn: EdgeHarness;

const execute = () =>
  fn.fetch(fn.request({
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer caller.jwt.sig" },
    body: { action: "execute" },
  }));

type Alert = { kind: string; severity: string; title: string };
const alerts = () => slackAlerts as Alert[];
const failedWrite = () =>
  scenario.writes.find(
    (w) => w.table === "instant_payouts" && (w.payload as { status?: string })?.status === "failed",
  )?.payload as { error_message: string } | undefined;

beforeEach(async () => {
  resetEnv(); resetSupabaseMock(); resetSharedMocks(); resetStripeMock();
  setEnv({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    SECRET_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_instant",
  });
  scenario.authUser = { id: "helper-1", email: "h@example.com" };
  scenario.reads.profiles = {
    rows: [{ stripe_account_id: "acct_helper", full_name: "H", subscription_tier: "basic", subscription_expires_at: null }],
  };
  scenario.writeSelectRows["instant_payouts:insert"] = [{ id: "ip-1" }];
  stripeMock.balance.retrieve.mockResolvedValue({ instant_available: [{ currency: "usd", amount: 10_000 }] });
  stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_platform" });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_fee" });
  stripeMock.payouts.create.mockRejectedValue(new Error("card declined the instant payout"));
  fn = await loadEdgeFunction("instant-payout");
});

describe("instant-payout fee outcomes always reach someone (ME-015)", () => {
  it("fee taken, payout failed: pages critical even though the row was marked failed", async () => {
    await execute();
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    expect(failedWrite()?.error_message).toMatch(/already transferred/);
    const a = alerts().find((x) => x.title === "Instant-payout fee taken but the payout failed");
    expect(a, JSON.stringify(alerts())).toBeDefined();
    expect(a!.severity).toBe("critical");
  });

  it("platform account unreadable: the skipped fee alerts, and the payout failure keeps the marker", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(new Error("platform lookup timed out"));
    await execute();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(alerts().some((x) => x.kind === "money_at_risk" && x.title === "Instant-payout fee NOT collected")).toBe(true);
    expect(alerts().some((x) => x.title === "Instant-payout fee taken but the payout failed")).toBe(false);
    expect(failedWrite()?.error_message).toMatch(/^fee_uncollected: platform_account_retrieval_failed: platform lookup timed out \| /);
  });
});
