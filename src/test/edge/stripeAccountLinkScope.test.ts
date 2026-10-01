/**
 * Q866 / Q868 — the lh-money-escrow notes on 9dee375db (Q861-864): two more
 * writes to a helper's payout-account link that were scoped by user_id only.
 *
 * Q866 stripe-webhook `account.updated`: the cached gate columns
 *   (stripe_identity_verified / charges / payouts) are written scoped to the
 *   EVENT's account id too, and read back `.select("id")`. Zero rows is a
 *   stale event for a replaced/cleared account: acknowledged, not an error,
 *   and no payout notice goes out about an account the helper no longer has.
 * Q868 stripe-connect `getOrCreateAccount`: the new-account link is a
 *   compare-and-set (`.is("stripe_account_id", null)` + `.select("id")`). On
 *   zero rows it re-reads and uses the id already on file instead of
 *   overwriting a concurrent link.
 *
 * Runs the REAL function source through the edge harness.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | .eq("user_id", helperProfile.user_id)\n      .eq("stripe_account_id", account.id)\n | .eq("user_id", helperProfile.user_id)\n
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | .eq("stripe_payouts_enabled", helperProfile.stripe_payouts_enabled)\n      .select("id"); | .eq("stripe_payouts_enabled", helperProfile.stripe_payouts_enabled);
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | if (!idvErr && (idvRows?.length ?? 0) === 0) { | if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | return;\n      }\n      // Still linked, so | }\n      // Still linked, so
 * @mutate supabase/functions/stripe-connect/index.ts | .eq("user_id", user.id)\n          .is("stripe_account_id", null)\n          .select("id"); | .eq("user_id", user.id)\n          .select("id");
 * @mutate supabase/functions/stripe-connect/index.ts | .is("stripe_account_id", null)\n          .select("id"); | .is("stripe_account_id", null);
 * @mutate supabase/functions/stripe-connect/index.ts | if ((linkedRows?.length ?? 0) === 0) { | if (false) {
 * @mutate supabase/functions/stripe-connect/index.ts | accountId = current.stripe_account_id; | accountId = accountId;
 * @mutate supabase/functions/stripe-connect/index.ts | if (reReadErr \|\| !current?.stripe_account_id) { | if (reReadErr) {
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const USER = { id: "user-q866", email: "q866@example.test" };
const ACCT = "acct_q866_event";
const NEW_ACCT = "acct_q868_created";
const RACED_ACCT = "acct_q868_concurrent";

const profileUpdates = () =>
  scenario.writes.filter((w) => w.table === "profiles" && w.op === "update");
const notificationInserts = () =>
  scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert");

// ─── Q866 ───
describe("Q866 — stripe-webhook account.updated cache write is scoped to the event's account", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_test_abc",
      STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
    });
    scenario.reads.profiles = {
      rows: [{
        user_id: USER.id,
        full_name: "Q866 Helpr",
        email_verified: true,
        stripe_identity_verified: false,
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
      }],
    };
    const account = {
      id: ACCT,
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      capabilities: { transfers: "active" },
      requirements: { currently_due: [], eventually_due: [], past_due: [], errors: [] },
    };
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_q866",
      type: "account.updated",
      data: { object: account },
    });
    // Q869: the handler caches the account as Stripe holds it now.
    stripeMock.accounts.retrieve.mockResolvedValue(account);
  });
  afterEach(() => resetEnv());

  async function deliver() {
    const fn = await loadEdgeFunction("stripe-webhook");
    return fn.fetch(fn.request({
      rawBody: "{}",
      headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" },
    }));
  }

  it("writes the cache scoped to user_id AND the event's account id, read back", async () => {
    const res = await deliver();

    expect(res.status).toBe(200);
    const writes = profileUpdates().filter(
      (w) => "stripe_payouts_enabled" in ((w.payload as Record<string, unknown>) ?? {}),
    );
    expect(writes.length, "inventory floor: the cache write ran").toBeGreaterThan(0);
    expect(writes).toHaveLength(1);
    expect(writes[0].filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "user_id", value: USER.id },
        { op: "eq", column: "stripe_account_id", value: ACCT },
      ]),
    );
    expect(writes[0].selectCols, "the cache write must read back its rows").toBe("id");
    // The linked path still sends the "verified" notice.
    expect(notificationInserts().length).toBeGreaterThan(0);
  });

  it("a stale event (zero rows: the profile no longer links this account) is acknowledged, no notice", async () => {
    scenario.writeSelectRows["profiles:update"] = [];

    const res = await deliver();

    expect(res.status).toBe(200);
    expect(profileUpdates()).toHaveLength(1);
    expect(notificationInserts()).toEqual([]);
  });
});

// ─── Q868 ───
describe("Q868 — stripe-connect getOrCreateAccount links the new id by compare-and-set", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_test_x",
    });
    scenario.authUser = USER;
    // No account on file at the first read; the compare-and-set's re-read
    // ("user_id, stripe_account_id") is answered separately per test.
    scenario.reads.profiles = { rows: [{ stripe_account_id: null, full_name: "Q868 Helpr" }] };
    stripeMock.accounts.create.mockResolvedValue({ id: NEW_ACCT });
    stripeMock.accountLinks.create.mockResolvedValue({ url: "https://connect.stripe.test/onboard" });
  });
  afterEach(() => resetEnv());

  async function onboard() {
    const fn = await loadEdgeFunction("stripe-connect");
    return fn.fetch(fn.request({
      headers: { Authorization: "Bearer good" },
      body: { action: "onboard", return_url: "https://louisianahelpr.com/profile" },
    }));
  }

  const linkWrites = () =>
    profileUpdates().filter((w) => "stripe_account_id" in ((w.payload as Record<string, unknown>) ?? {}));

  it("links the new id only while none is on file, read back", async () => {
    const res = await onboard();

    expect(res.status).toBe(200);
    const writes = linkWrites();
    expect(writes.length, "inventory floor: the link write ran").toBeGreaterThan(0);
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toEqual({ stripe_account_id: NEW_ACCT });
    expect(writes[0].filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "user_id", value: USER.id },
        { op: "is", column: "stripe_account_id", value: null },
      ]),
    );
    expect(writes[0].selectCols, "the link write must read back its rows").toBe("id");
    expect(stripeMock.accountLinks.create).toHaveBeenCalledWith(expect.objectContaining({ account: NEW_ACCT }));
  });

  it("zero rows (a concurrent link won): uses the id on file, never overwrites it", async () => {
    scenario.writeSelectRows["profiles:update"] = [];
    scenario.reads.profiles.selectOverrides = [
      { includes: "user_id, stripe_account_id", result: { rows: [{ user_id: USER.id, stripe_account_id: RACED_ACCT }] } },
    ];

    const res = await onboard();

    expect(res.status).toBe(200);
    expect(linkWrites()).toHaveLength(1);
    expect(stripeMock.accountLinks.create).toHaveBeenCalledWith(expect.objectContaining({ account: RACED_ACCT }));
    expect(stripeMock.accountLinks.create).not.toHaveBeenCalledWith(expect.objectContaining({ account: NEW_ACCT }));
    expect(await res.json()).toMatchObject({ account_id: RACED_ACCT });
  });

  it("zero rows and still no id on file: fails instead of reporting a link", async () => {
    scenario.writeSelectRows["profiles:update"] = [];
    scenario.reads.profiles.selectOverrides = [
      { includes: "user_id, stripe_account_id", result: { rows: [{ user_id: USER.id, stripe_account_id: null }] } },
    ];

    const res = await onboard();

    expect(res.status).toBe(500);
    expect(stripeMock.accountLinks.create).not.toHaveBeenCalled();
  });
});
