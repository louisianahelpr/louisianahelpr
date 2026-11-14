/**
 * prod-errors item 9 (owner 11-14): two members with NO payout account (no stripe_account_id, no
 * connect_account_retirements row; read-only SQL 2026-11-14) got stripe-connect's generic 500 from `status`
 * (2026-11-11 13:09Z) and `list_payout_methods` (2026-11-13 15:20Z). The edge logs had aged out, so the cause
 * could not be read back.
 *
 *  1. No account, nothing on that path needs Stripe: `status` and `list_payout_methods` answer the empty state from
 *     the caller's own row BEFORE the Stripe mode lookup and the Stripe client. A missing profile row is no account
 *     (`.single()` turned it into a 500). A failed profile READ still fails (a connected Helpr must never be told to
 *     connect again), and now says why.
 *  2. Every generic 500 leaves one error_logs row with the cause: action, error name and message, Stripe
 *     type/code/status, the user; no key or card number; the member's message unchanged.
 *
 * @mutate supabase/functions/stripe-connect/index.ts |     if (action === "status" \|\| action === "list_payout_methods") { |     if (false) {
 * @mutate supabase/functions/stripe-connect/index.ts |     await recordConnectFailure(supabaseAdmin, { userId: callerId, action: failedAction, test: callerTestMode, err }); |
 * @mutate supabase/functions/_shared/connectRecord.ts |     .replace(/\b(?:sk\|rk\|pk)_(?:live\|test)_[A-Za-z0-9]+/g, "<key>") |
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const USER = { id: "user-item9", email: "item9@example.test" };
const GENERIC = "We couldn't set up your payout account right now. Please try again.";

async function call(action: string) {
  const fn = await loadEdgeFunction("stripe-connect");
  const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer good" }, body: { action } }));
  return { status: res.status, body: JSON.parse(await res.text()) as Record<string, unknown> };
}

type Row = { severity: string; user_id: string | null; message: string; tags: Record<string, unknown>; context: Record<string, unknown> };
const failureRows = () =>
  scenario.writes
    .filter((w) => w.table === "error_logs" && w.op === "insert")
    .map((w) => w.payload as Row)
    .filter((r) => r.tags?.kind === "connect-500");

beforeEach(() => {
  resetEnv();
  resetSupabaseMock();
  resetSharedMocks();
  resetStripeMock();
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_x",
  });
  scenario.authUser = USER;
  scenario.reads.error_logs = { rows: [], count: 0 };
});

describe("1. no payout account: status and payout methods answer the empty state", () => {
  it.each([
    ["status", { connected: false, details_submitted: false, payouts_enabled: false }],
    ["list_payout_methods", { methods: [] }],
  ])("%s with no profile row answers 200 empty (was .single() -> 500)", async (action, empty) => {
    scenario.reads.profiles = { rows: [] };
    const res = await call(action);
    expect(res).toEqual({ status: 200, body: empty });
  });

  it.each(["status", "list_payout_methods"])("%s with no account answers 200 even when the Stripe mode lookup would fail", async (action) => {
    scenario.reads.profiles = { rows: [{ stripe_account_id: null }] };
    scenario.reads.test_accounts = { rows: [], error: { message: "permission denied for table test_accounts" } };
    const res = await call(action);
    expect(res.status).toBe(200);
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
  });

  it("a member WITH an account still goes to Stripe (the floor: the early answer is only for no account)", async () => {
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_item9" }] };
    stripeMock.accounts.listExternalAccounts.mockResolvedValue({ data: [] });
    const res = await call("list_payout_methods");
    expect(res.status).toBe(200);
    expect(stripeMock.accounts.listExternalAccounts).toHaveBeenCalledTimes(1);
  });

  it("a failed profile READ still fails (never 'not connected' for someone who may be), and records why", async () => {
    scenario.reads.profiles = { rows: [], error: { message: "canceling statement due to statement timeout", code: "57014" } };
    const res = await call("status");
    expect(res).toEqual({ status: 500, body: { error: GENERIC } });
    expect(failureRows().map((r) => r.message)).toEqual([
      "stripe-connect 500 (status) — Error: Could not load your profile — please try again (57014)",
    ]);
  });
});

describe("2. every generic 500 records its cause", () => {
  it("a Stripe failure: action, name, message, Stripe type/code/status and the user; the member's words unchanged", async () => {
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_item9" }] };
    stripeMock.accounts.listExternalAccounts.mockRejectedValue(
      // The fake key is assembled at run time so the secret scanner (gitleaks stripe-access-token) does not read it as one.
      Object.assign(new Error(`Rate limit with key ${["sk", "live", "abc123SECRET"].join("_")} on card 4242424242424242`), {
        name: "StripeRateLimitError", type: "StripeRateLimitError", code: "rate_limit", statusCode: 429,
      }),
    );
    const res = await call("list_payout_methods");
    expect(res).toEqual({ status: 500, body: { error: GENERIC } });
    const rows = failureRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      severity: "error",
      user_id: USER.id,
      tags: { source: "stripe-connect", kind: "connect-500", action: "list_payout_methods" },
      context: { error_name: "StripeRateLimitError", stripe_type: "StripeRateLimitError", stripe_code: "rate_limit", stripe_status: 429 },
    });
    expect(rows[0].message).toBe("stripe-connect 500 (list_payout_methods) — StripeRateLimitError: Rate limit with key <key> on card <number>");
    expect(JSON.stringify(rows[0])).not.toMatch(/sk_live_abc|4242424242424242/);
  });
});
