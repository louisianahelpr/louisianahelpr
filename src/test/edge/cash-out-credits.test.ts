/**
 * cash-out-credits — HM-1: the Stripe idempotency key must bind to a STABLE
 * per-attempt id, never to the claimed credit SET.
 *
 * The double-pay this guards (hole hunt 2026-09-15): a transfer succeeds but its
 * response is lost → the catch rolls the claim back → a new credit accrues →
 * the retry claims a DIFFERENT set → the old set-hash key changes → Stripe does
 * not dedupe → a second transfer goes out and the overlapping credit is paid
 * twice. Keying on a client-supplied attempt id that is reused across the retry
 * makes the key identical, so Stripe replays the original transfer instead.
 *
 * Red-first: against the pre-fix function (key = `cashout-${sha256(set)}`) the
 * first assertion below fails because the key is not `cashout-${attemptId}`, and
 * the "same attempt, different set" case fails because two different sets hash
 * to two different keys.
 */
//
// Registered mutations - each turns this guard RED on its own:
//   Reverting the key to the legacy SET hash is the double-pay: a retry that
//   claims a different set gets a different key and Stripe sends a SECOND transfer.
// @mutate supabase/functions/cash-out-credits/index.ts | `cashout-${attemptId}` | `cashout-${await sha256Hex(creditIds.slice().sort().join(","))}`
//   ME-013: dropping the ledger stamp or the transfer metadata makes a cash-out unreconcilable.
// @mutate supabase/functions/cash-out-credits/index.ts | .update({ redeemed_at: new Date().toISOString(), stripe_transfer_id: transfer.id }) | .update({ redeemed_at: new Date().toISOString() })
// @mutate supabase/functions/cash-out-credits/index.ts |             type: "referral_cashout", |             kind: "x",
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const JWT = "Bearer caller.jwt.sig";
const USER = { id: "helper-1", email: "helper@example.com" };
const ATTEMPT = "11111111-2222-4333-8444-555555555555";

let fn: EdgeHarness;

const post = (body: unknown, auth: string | null = JWT) =>
  fn.fetch(fn.request({
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body,
  }));

/** Configure a happy-path cash-out that claims `claimed` credit rows. */
function stageClaim(claimed: Array<{ id: string; amount: number }>) {
  scenario.authUser = USER;
  scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
  // The atomic claim UPDATE ... .select("id, amount") returns these rows.
  scenario.writeSelectRows["referral_credits:update"] = claimed;
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_ok" });
}

beforeEach(async () => {
  resetEnv(); resetSupabaseMock(); resetSharedMocks(); resetStripeMock();
  setEnv({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    SECRET_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_cashout",
  });
  fn = await loadEdgeFunction("cash-out-credits");
});

describe("HM-1 · idempotency key binds to the client attempt id, not the credit set", () => {
  it("keys the Stripe transfer on cashout-<attemptId> when the client supplies one", async () => {
    stageClaim([{ id: "cA", amount: 5 }]);

    const res = await post({ attemptId: ATTEMPT });
    expect(res.status).toBe(200);

    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    const opts = stripeMock.transfers.create.mock.calls[0][1] as { idempotencyKey?: string };
    expect(opts.idempotencyKey).toBe(`cashout-${ATTEMPT}`);
  });

  it("uses the SAME key for the same attempt id even when the claimed set changed (the double-pay case)", async () => {
    // First attempt claims {cA}. Ambiguous failure would roll it back; here we
    // just re-drive with the same attempt id but a set that has grown to
    // {cA,cB}. The key must not change, or Stripe sends a second transfer.
    stageClaim([{ id: "cA", amount: 5 }]);
    await post({ attemptId: ATTEMPT });
    const firstKey = (stripeMock.transfers.create.mock.calls[0][1] as { idempotencyKey?: string }).idempotencyKey;

    stripeMock.transfers.create.mockClear();
    stageClaim([{ id: "cA", amount: 5 }, { id: "cB", amount: 5 }]);
    await post({ attemptId: ATTEMPT });
    const secondKey = (stripeMock.transfers.create.mock.calls[0][1] as { idempotencyKey?: string }).idempotencyKey;

    expect(secondKey).toBe(firstKey);
    expect(secondKey).toBe(`cashout-${ATTEMPT}`);
  });

  it("ignores a malformed attempt id (falls back to the legacy key rather than trusting junk)", async () => {
    stageClaim([{ id: "cA", amount: 5 }]);
    const res = await post({ attemptId: "not-a-uuid" });
    expect(res.status).toBe(200);
    const opts = stripeMock.transfers.create.mock.calls[0][1] as { idempotencyKey?: string };
    // Not the junk value, and not a bare prefix — the legacy set-hash shape.
    expect(opts.idempotencyKey).not.toBe("cashout-not-a-uuid");
    expect(opts.idempotencyKey).toMatch(/^cashout-[0-9a-f]{64}$/);
  });
});

describe("ME-013 · a cash-out is reconcilable", () => {
  it("stamps each claimed credit with the transfer id and time, and tags the transfer", async () => {
    stageClaim([{ id: "cA", amount: 5 }, { id: "cB", amount: 5 }]);
    const res = await post({ attemptId: ATTEMPT });
    expect(res.status).toBe(200);
    const params = stripeMock.transfers.create.mock.calls[0][0] as { metadata?: Record<string, string> };
    expect(params.metadata).toMatchObject({ type: "referral_cashout", user_id: USER.id, credit_count: "2" });
    const stamp = scenario.writes.find(
      (w) => w.table === "referral_credits" && (w.payload as { stripe_transfer_id?: string }).stripe_transfer_id,
    );
    expect(stamp?.payload).toMatchObject({ stripe_transfer_id: "tr_ok" });
    expect(typeof (stamp?.payload as { redeemed_at?: string }).redeemed_at).toBe("string");
  });
});
