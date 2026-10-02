/**
 * Q859 (2)(3)(5) — stripe-connect may clear a helper's payout account link ONLY
 * when Stripe says the ACCOUNT itself is unusable, and the clear is complete
 * and checked.
 *
 * (5) A 404 / `resource_missing` names whatever resource was missing. A double
 *     tap on "remove payout method" 404s on the EXTERNAL ACCOUNT while the
 *     Connect account is healthy; the old catch nulled that valid live
 *     `stripe_account_id`. The rule is now confirmed by an account-scoped
 *     `accounts.retrieve` before anything is cleared.
 * (2) The clear resets the cached gate columns written from that account:
 *     `stripe_payouts_enabled`, `stripe_charges_enabled`, and
 *     `stripe_identity_verified` (derived from the Connect account's
 *     requirements ledger by `stripeIdentityVerified()`; its only writers are
 *     stripe-connect `status` and the `account.updated` webhook).
 * (3) The clear ends in `.select("id")`, and a write error or zero rows is not
 *     reported to the user as "your account was reset".
 *
 * Runs the REAL function source through the edge harness.
 *
 * @mutate supabase/functions/stripe-connect/index.ts |       await stripe.accounts.retrieve(accountId);\n      return "account-usable";\n    } catch (probeErr) {\n      if (!isUnusableConnectAccountError(probeErr)) { |       throw new Error("unconfirmed");\n    } catch (probeErr) {\n      if (false) {
 * @mutate supabase/functions/stripe-connect/index.ts | null,\n        stripe_payouts_enabled: false,\n | null,\n
 * @mutate supabase/functions/stripe-connect/index.ts | stripe_charges_enabled: false,\n        stripe_identity_verified: false,\n      }) | stripe_charges_enabled: false,\n      })
 * @mutate supabase/functions/stripe-connect/index.ts |     if (clearErr \|\| (clearedRows?.length ?? 0) === 0) { |     if (false) {
 * @mutate supabase/functions/stripe-connect/index.ts |       .eq("stripe_account_id", accountId)\n      .select("id"); |       .eq("stripe_account_id", accountId);
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const USER = { id: "user-q859", email: "q859@example.test" };
const ACCT = "acct_q859_live";

const stripeErr = (message: string, extra: Record<string, unknown>) =>
  Object.assign(new Error(message), extra);

/** What Stripe answers for a second delete of an already-removed bank account. */
const externalAccountGone = () =>
  stripeErr("No such external account: 'ba_gone'", {
    statusCode: 404,
    code: "resource_missing",
    type: "StripeInvalidRequestError",
  });

/** What Stripe answers when the Connect account itself is unusable (#1582). */
const accountUnusable = () =>
  stripeErr(
    `The account ${ACCT} was a test account created with a testmode key, and therefore can only be used with testmode keys.`,
    { statusCode: 400, type: "StripeInvalidRequestError" },
  );

const profileClears = () =>
  scenario.writes.filter(
    (w) =>
      w.table === "profiles" &&
      w.op === "update" &&
      (w.payload as Record<string, unknown>)?.stripe_account_id === null,
  );

async function deletePayoutMethod() {
  const fn = await loadEdgeFunction("stripe-connect");
  return fn.fetch(
    fn.request({
      headers: { Authorization: "Bearer good" },
      body: { action: "delete_payout_method", method_id: "ba_gone" },
    }),
  );
}

describe("Q859 — stripe-connect clears a payout account only when the ACCOUNT is unusable", () => {
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
    // Q863: the clear breaker counts this hour's clears first; none yet.
    scenario.reads.error_logs = { rows: [], count: 0 };
  });
  afterEach(() => resetEnv());

  it("(5) a double-tap 404 on an external account leaves a healthy account linked", async () => {
    stripeMock.accounts.deleteExternalAccount.mockRejectedValue(externalAccountGone());
    stripeMock.accounts.retrieve.mockResolvedValue({ id: ACCT, charges_enabled: true, payouts_enabled: true });

    const res = await deletePayoutMethod();

    expect(profileClears(), "a valid live stripe_account_id was nulled").toEqual([]);
    expect(res.status).not.toBe(409);
    // The confirmation asked about the account itself.
    expect(stripeMock.accounts.retrieve).toHaveBeenCalledWith(ACCT);
  });

  it("(5) a probe that fails for some OTHER reason (network, rate limit) clears nothing", async () => {
    stripeMock.accounts.deleteExternalAccount.mockRejectedValue(externalAccountGone());
    stripeMock.accounts.retrieve.mockRejectedValue(stripeErr("Too many requests", { statusCode: 429 }));

    const res = await deletePayoutMethod();

    expect(profileClears()).toEqual([]);
    expect(res.status).toBe(500);
  });

  it("(2)(3) a confirmed-unusable account is cleared with its gate columns, checked, and scoped to that id", async () => {
    stripeMock.accounts.deleteExternalAccount.mockRejectedValue(accountUnusable());
    stripeMock.accounts.retrieve.mockRejectedValue(accountUnusable());

    const res = await deletePayoutMethod();

    expect(res.status).toBe(409);
    const clears = profileClears();
    expect(clears.length, "inventory floor: the clear ran").toBeGreaterThan(0);
    expect(clears).toHaveLength(1);
    expect(clears[0].payload).toEqual({
      stripe_account_id: null,
      stripe_payouts_enabled: false,
      stripe_charges_enabled: false,
      stripe_identity_verified: false,
    });
    expect(clears[0].selectCols, "the clear must read back its rows").toBe("id");
    expect(clears[0].filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "user_id", value: USER.id },
        { op: "eq", column: "stripe_account_id", value: ACCT },
      ]),
    );
  });

  it("(3) a clear that errors is not reported as a reset", async () => {
    stripeMock.accounts.deleteExternalAccount.mockRejectedValue(accountUnusable());
    stripeMock.accounts.retrieve.mockRejectedValue(accountUnusable());
    scenario.writeErrors.profiles = { message: "permission denied for table profiles", code: "42501" };

    const res = await deletePayoutMethod();

    expect(profileClears()).toHaveLength(1);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("permission denied");
  });

  it("(3) a clear that matched zero rows is not reported as a reset", async () => {
    stripeMock.accounts.deleteExternalAccount.mockRejectedValue(accountUnusable());
    stripeMock.accounts.retrieve.mockRejectedValue(accountUnusable());
    scenario.writeSelectRows.profiles = [];

    const res = await deletePayoutMethod();

    expect(profileClears()).toHaveLength(1);
    expect(res.status).toBe(500);
  });
});
