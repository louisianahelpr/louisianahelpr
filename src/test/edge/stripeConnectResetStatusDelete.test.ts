/**
 * Q861 / Q862 / Q864 — the lh-money-escrow notes on Q859, the other paths in
 * stripe-connect that touch a helper's payout-account link.
 *
 * Q861 `reset`: the clear resets stripe_account_id AND the three cached gate
 *   columns written from that account (stripe_payouts_enabled,
 *   stripe_charges_enabled, stripe_identity_verified), is scoped to the id it
 *   just deleted at Stripe, reads back `.select("id")`, and an error or zero
 *   rows stops the reset before a new account is linked.
 * Q862 `status`: the cache write-back is scoped to the account id it
 *   RETRIEVED, so a status call that read the old account before a concurrent
 *   clear cannot write payouts_enabled=true back onto a cleared profile.
 * Q864 `delete_payout_method`: a double tap (the external account is already
 *   gone, the Connect account probes healthy) answers success, not the
 *   generic 500; a probe that fails still goes to Q859's confirm-then-clear.
 *
 * Runs the REAL function source through the edge harness.
 *
 * @mutate supabase/functions/stripe-connect/index.ts | null,\n          stripe_payouts_enabled: false,\n          stripe_charges_enabled: false,\n          stripe_identity_verified: false,\n        }) | null,\n        })
 * @mutate supabase/functions/stripe-connect/index.ts | ? resetClear.eq("stripe_account_id", oldAccountId) | ? resetClear
 * @mutate supabase/functions/stripe-connect/index.ts | if (!resetUpdateErr && oldAccountId && (resetRows?.length ?? 0) === 0) { | if (false) {
 * @mutate supabase/functions/stripe-connect/index.ts | : resetClear.is("stripe_account_id", null)\n      ).select("id"); | : resetClear.is("stripe_account_id", null)\n      );
 * @mutate supabase/functions/stripe-connect/index.ts | .eq("user_id", user.id)\n        .eq("stripe_account_id", profile.stripe_account_id)\n        .eq("stripe_identity_verified" | .eq("user_id", user.id)\n        .eq("stripe_identity_verified"
 * @mutate supabase/functions/stripe-connect/index.ts | const methodMissing = de?.statusCode === 404 \|\| de?.code === "resource_missing"; | const methodMissing = false;
 * @mutate supabase/functions/stripe-connect/index.ts | await stripe.accounts.retrieve(profile.stripe_account_id);\n        } catch {\n | } catch {\n
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const USER = { id: "user-q861", email: "q861@example.test" };
const ACCT = "acct_q861_live";

const stripeErr = (message: string, extra: Record<string, unknown>) =>
  Object.assign(new Error(message), extra);

const externalAccountGone = () =>
  stripeErr("No such external account: 'ba_gone'", {
    statusCode: 404,
    code: "resource_missing",
    type: "StripeInvalidRequestError",
  });

const accountGone = () =>
  stripeErr(`No such account: '${ACCT}'`, {
    statusCode: 404,
    code: "resource_missing",
    type: "StripeInvalidRequestError",
  });

const profileUpdates = () =>
  scenario.writes.filter((w) => w.table === "profiles" && w.op === "update");

const notificationInserts = () =>
  scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert");

async function call(body: Record<string, unknown>) {
  const fn = await loadEdgeFunction("stripe-connect");
  return fn.fetch(fn.request({ headers: { Authorization: "Bearer good" }, body }));
}

describe("Q861/Q862/Q864 — stripe-connect reset, status write-back, idempotent delete", () => {
  beforeEach(() => {
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
    scenario.reads.profiles = { rows: [{ stripe_account_id: ACCT }] };
    // Q863: the stale-clear breaker counts this hour's clears first; none yet.
    scenario.reads.error_logs = { rows: [], count: 0 };
    stripeMock.accounts.del.mockResolvedValue({ id: ACCT, deleted: true });
    stripeMock.accountLinks.create.mockResolvedValue({ url: "https://connect.stripe.test/onboard" });
  });
  afterEach(() => resetEnv());

  // ─── Q861 ───
  it("Q861 reset clears the id and all three gate columns, scoped to the deleted id, read back", async () => {
    const res = await call({ action: "reset", return_url: "https://louisianahelpr.com/profile" });

    expect(res.status).toBe(200);
    const clears = profileUpdates().filter(
      (w) => (w.payload as Record<string, unknown>)?.stripe_account_id === null,
    );
    expect(clears.length, "inventory floor: the reset clear ran").toBeGreaterThan(0);
    expect(clears).toHaveLength(1);
    expect(clears[0].payload).toEqual({
      stripe_account_id: null,
      stripe_payouts_enabled: false,
      stripe_charges_enabled: false,
      stripe_identity_verified: false,
    });
    expect(clears[0].selectCols, "the reset clear must read back its rows").toBe("id");
    expect(clears[0].filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "user_id", value: USER.id },
        { op: "eq", column: "stripe_account_id", value: ACCT },
      ]),
    );
  });

  it("Q861 a reset clear that matched zero rows stops before a new account is linked", async () => {
    scenario.writeSelectRows.profiles = [];

    const res = await call({ action: "reset", return_url: "https://louisianahelpr.com/profile" });

    expect(res.status).toBe(500);
    expect(stripeMock.accountLinks.create).not.toHaveBeenCalled();
    expect(notificationInserts()).toEqual([]);
  });

  it("Q861 a reset clear that errors stops before a new account is linked", async () => {
    scenario.writeErrors.profiles = { message: "permission denied for table profiles", code: "42501" };

    const res = await call({ action: "reset", return_url: "https://louisianahelpr.com/profile" });

    expect(res.status).toBe(500);
    expect(stripeMock.accountLinks.create).not.toHaveBeenCalled();
    expect(await res.text()).not.toContain("permission denied");
  });

  // ─── Q862 ───
  it("Q862 the status write-back is scoped to the account id it retrieved", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({
      id: ACCT,
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      capabilities: { transfers: "active" },
      requirements: { currently_due: [], eventually_due: [], past_due: [], errors: [] },
    });

    const res = await call({ action: "status" });

    expect(res.status).toBe(200);
    const writes = profileUpdates().filter(
      (w) => "stripe_payouts_enabled" in ((w.payload as Record<string, unknown>) ?? {}),
    );
    expect(writes.length, "inventory floor: the write-back ran").toBeGreaterThan(0);
    expect(writes).toHaveLength(1);
    expect(stripeMock.accounts.retrieve).toHaveBeenCalledWith(ACCT);
    expect(writes[0].filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "user_id", value: USER.id },
        { op: "eq", column: "stripe_account_id", value: ACCT },
      ]),
    );
  });

  // ─── Q864 ───
  it("Q864 a double-tap delete on a healthy account answers success, clears nothing, no second alert", async () => {
    stripeMock.accounts.deleteExternalAccount.mockRejectedValue(externalAccountGone());
    stripeMock.accounts.retrieve.mockResolvedValue({ id: ACCT, charges_enabled: true, payouts_enabled: true });

    const res = await call({ action: "delete_payout_method", method_id: "ba_gone" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
    expect(stripeMock.accounts.retrieve).toHaveBeenCalledWith(ACCT);
    expect(profileUpdates()).toEqual([]);
    expect(notificationInserts()).toEqual([]);
  });

  it("Q864 a 404 whose account probe also fails is NOT answered as success (Q859 confirm-then-clear still runs)", async () => {
    stripeMock.accounts.deleteExternalAccount.mockRejectedValue(accountGone());
    stripeMock.accounts.retrieve.mockRejectedValue(accountGone());

    const res = await call({ action: "delete_payout_method", method_id: "ba_any" });

    expect(res.status).toBe(409);
    expect(profileUpdates()).toHaveLength(1);
  });

  it("Q864 a non-404 delete failure is not swallowed", async () => {
    stripeMock.accounts.deleteExternalAccount.mockRejectedValue(
      stripeErr("You cannot delete the default external account", { statusCode: 400, type: "StripeInvalidRequestError" }),
    );
    stripeMock.accounts.retrieve.mockResolvedValue({ id: ACCT });

    const res = await call({ action: "delete_payout_method", method_id: "ba_default" });

    expect(res.status).toBe(500);
    expect(profileUpdates()).toEqual([]);
  });
});
