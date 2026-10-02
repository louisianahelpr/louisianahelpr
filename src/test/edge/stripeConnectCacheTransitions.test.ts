/**
 * Q863 / Q867 / Q873 — stripe-connect, the paths that move a helper's payout
 * link or its cached gate.
 *
 * Q863 a breaker on mass clears: a wrong STRIPE_SECRET_KEY makes every
 *   account look gone, and each helper's Payment visit would clear their own
 *   link. Every clear is recorded in error_logs (tags.kind 'stale-clear');
 *   with 5 recorded in the last hour, further clears are refused and ops is
 *   paged. A count that fails or comes back null also refuses (fail closed).
 * Q867 a create whose idempotency key replays a DEAD account (deleted by a
 *   reset or a Q859 clear inside Stripe's 24h window) is re-keyed with the
 *   dead id instead of re-linking it; three dead replays in a row fail.
 * Q873 `status` moves the cache by compare-and-set on the flags it read, and
 *   the one write that moves it INTO enabled sends "Payout account verified"
 *   (prod's live endpoint gets no Connect events, Q876, so `status` is usually
 *   the only writer that sees the transition).
 *
 * Runs the REAL function source through the edge harness.
 *
 * @mutate supabase/functions/stripe-connect/index.ts | if (recentClears >= STALE_CLEAR_HOURLY_CAP) { | if (false) {
 * @mutate supabase/functions/stripe-connect/index.ts | if (countErr \|\| recentClears === null \|\| recentClears === undefined) { | if (countErr) {
 * @mutate supabase/functions/stripe-connect/index.ts | if (countErr \|\| recentClears === null | if (recentClears === null
 * @mutate supabase/functions/stripe-connect/index.ts | .eq("tags->>kind", STALE_CLEAR_KIND)\n      .gte("created_at", sinceIso); | .eq("tags->>kind", STALE_CLEAR_KIND);
 * @mutate supabase/functions/stripe-connect/index.ts | tags: { source: "stripe-connect", kind: STALE_CLEAR_KIND }, | tags: { source: "stripe-connect" },
 * @mutate supabase/functions/stripe-connect/index.ts | oncePerDayKey: "stripe-connect-stale-clear-cap",\n      });\n      return "failed"; | oncePerDayKey: "stripe-connect-stale-clear-cap",\n      });
 * @mutate supabase/functions/stripe-connect/index.ts | if (check?.deleted === true) usable = false; |
 * @mutate supabase/functions/stripe-connect/index.ts | if (!isUnusableConnectAccountError(checkErr)) throw checkErr;\n            usable = false; |
 * @mutate supabase/functions/stripe-connect/index.ts | idempotencyKey = `stripe-connect-create-${user.id}-after-${created.id}`; |
 * @mutate supabase/functions/stripe-connect/index.ts | if (!account) {\n          throw new Error("Could not create your payout account | if (false) {\n          throw new Error("Could not create your payout account
 * @mutate supabase/functions/stripe-connect/index.ts | .eq("stripe_charges_enabled", profile.stripe_charges_enabled === true)\n | \n
 * @mutate supabase/functions/stripe-connect/index.ts | .eq("stripe_payouts_enabled", profile.stripe_payouts_enabled === true)\n        .select("id"); | .select("id");
 * @mutate supabase/functions/stripe-connect/index.ts | } else if ((cacheRows?.length ?? 0) === 1 && nowCharges && nowPayouts && !wasEnabled) { | } else if (nowCharges && nowPayouts && !wasEnabled) {
 * @mutate supabase/functions/stripe-connect/index.ts | } else if ((cacheRows?.length ?? 0) === 1 && nowCharges && nowPayouts && !wasEnabled) { | } else if ((cacheRows?.length ?? 0) === 1 && nowCharges && nowPayouts) {
 * @mutate supabase/functions/stripe-connect/index.ts | } else if ((cacheRows?.length ?? 0) === 1 && nowCharges && nowPayouts && !wasEnabled) { | } else if (false) {
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, postSlackOpsAlert } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const USER = { id: "user-q863", email: "q863@example.test" };
const ACCT = "acct_q863_live";
const DEAD = "acct_q867_dead";
const FRESH = "acct_q867_fresh";
const NO_REQS = { currently_due: [], eventually_due: [], past_due: [], errors: [] };
const ENABLED = {
  id: ACCT,
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  capabilities: { transfers: "active" },
  requirements: NO_REQS,
};
const RESTRICTED = {
  ...ENABLED,
  charges_enabled: false,
  payouts_enabled: false,
  capabilities: { transfers: "inactive" },
  requirements: { ...NO_REQS, currently_due: ["individual.verification.document"] },
};

const stripeErr = (message: string, extra: Record<string, unknown>) =>
  Object.assign(new Error(message), extra);
const accountGone = (id: string) =>
  stripeErr(`No such account: '${id}'`, { statusCode: 404, code: "resource_missing", type: "StripeInvalidRequestError" });

const profileUpdates = () => scenario.writes.filter((w) => w.table === "profiles" && w.op === "update");
const clears = () =>
  profileUpdates().filter((w) => (w.payload as Record<string, unknown>)?.stripe_account_id === null);
const staleClearLogs = () => scenario.writes.filter((w) => w.table === "error_logs" && w.op === "insert");
const noticeTitles = () =>
  scenario.writes
    .filter((w) => w.table === "notifications" && w.op === "insert")
    .flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload]))
    .map((p) => (p as { title?: string }).title);

async function call(body: Record<string, unknown>) {
  const fn = await loadEdgeFunction("stripe-connect");
  return fn.fetch(fn.request({ headers: { Authorization: "Bearer good" }, body }));
}

function baseEnv() {
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
}

// ─── Q863 ───
describe("Q863 — stripe-connect stops clearing payout links after 5 in an hour", () => {
  beforeEach(() => {
    baseEnv();
    scenario.reads.profiles = { rows: [{ stripe_account_id: ACCT }] };
    // The delete 404s on the ACCOUNT and the confirm probe agrees: a real clear.
    stripeMock.accounts.deleteExternalAccount.mockRejectedValue(accountGone(ACCT));
    stripeMock.accounts.retrieve.mockRejectedValue(accountGone(ACCT));
  });
  afterEach(() => resetEnv());

  const removeMethod = () => call({ action: "delete_payout_method", method_id: "ba_any" });

  it("under the cap: clears, and records the clear the breaker counts", async () => {
    scenario.reads.error_logs = { rows: [], count: 4 };

    const res = await removeMethod();

    expect(res.status).toBe(409);
    expect(clears(), "inventory floor: the clear ran").toHaveLength(1);
    const logs = staleClearLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].payload).toMatchObject({
      user_id: USER.id,
      severity: "info",
      tags: { source: "stripe-connect", kind: "stale-clear" },
      context: { account_id: ACCT },
    });
    // The count is this hour's stale-clears from this function.
    const countRead = scenario.readQueries.find((q) => q.table === "error_logs");
    expect(countRead?.filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "tags->>source", value: "stripe-connect" },
        { op: "eq", column: "tags->>kind", value: "stale-clear" },
        expect.objectContaining({ op: "gte", column: "created_at" }),
      ]),
    );
    expect(postSlackOpsAlert).not.toHaveBeenCalled();
  });

  it("at the cap: refuses the clear, records nothing, pages ops", async () => {
    scenario.reads.error_logs = { rows: [], count: 5 };

    const res = await removeMethod();

    expect(res.status).toBe(500);
    expect(clears(), "a 6th clear in an hour went through").toEqual([]);
    expect(staleClearLogs()).toEqual([]);
    expect(postSlackOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "money_at_risk", severity: "critical", oncePerDayKey: "stripe-connect-stale-clear-cap" }),
    );
  });

  it("a count that comes back null refuses the clear (fail closed)", async () => {
    scenario.reads.error_logs = { rows: [] };

    const res = await removeMethod();

    expect(res.status).toBe(500);
    expect(clears()).toEqual([]);
  });

  it("a count that errors refuses the clear (fail closed)", async () => {
    scenario.reads.error_logs = { rows: [], error: { message: "permission denied for table error_logs" } };

    const res = await removeMethod();

    expect(res.status).toBe(500);
    expect(clears()).toEqual([]);
    expect(await res.text()).not.toContain("permission denied");
  });
});

// ─── Q867 ───
describe("Q867 — a create that replays a dead account is re-keyed, never re-linked", () => {
  beforeEach(() => {
    baseEnv();
    scenario.reads.profiles = { rows: [{ stripe_account_id: null, full_name: "Q867 Helpr" }] };
    stripeMock.accountLinks.create.mockResolvedValue({ url: "https://connect.stripe.test/onboard" });
  });
  afterEach(() => resetEnv());

  const onboard = () => call({ action: "onboard", return_url: "https://louisianahelpr.com/profile" });
  const linked = () =>
    profileUpdates()
      .map((w) => (w.payload as Record<string, unknown>)?.stripe_account_id)
      .filter((id) => id !== undefined);

  it("a replay that 404s is re-keyed with the dead id; the fresh account is linked", async () => {
    stripeMock.accounts.create
      .mockResolvedValueOnce({ id: DEAD })
      .mockResolvedValueOnce({ id: FRESH });
    stripeMock.accounts.retrieve.mockImplementation(async (id: string) => {
      if (id === DEAD) throw accountGone(DEAD);
      return { id };
    });

    const res = await onboard();

    expect(res.status).toBe(200);
    const keys = stripeMock.accounts.create.mock.calls.map((c) => (c[1] as { idempotencyKey: string }).idempotencyKey);
    expect(keys, "inventory floor: create ran").toHaveLength(2);
    expect(keys).toEqual([`stripe-connect-create-${USER.id}`, `stripe-connect-create-${USER.id}-after-${DEAD}`]);
    expect(linked()).toEqual([FRESH]);
    expect(stripeMock.accountLinks.create).toHaveBeenCalledWith(expect.objectContaining({ account: FRESH }));
  });

  it("a replay Stripe answers as deleted:true is treated the same way", async () => {
    stripeMock.accounts.create
      .mockResolvedValueOnce({ id: DEAD })
      .mockResolvedValueOnce({ id: FRESH });
    stripeMock.accounts.retrieve.mockImplementation(async (id: string) =>
      id === DEAD ? { id, deleted: true } : { id });

    const res = await onboard();

    expect(res.status).toBe(200);
    expect(linked()).toEqual([FRESH]);
  });

  it("three dead replays in a row fail and link nothing", async () => {
    stripeMock.accounts.create.mockResolvedValue({ id: DEAD });
    stripeMock.accounts.retrieve.mockRejectedValue(accountGone(DEAD));

    const res = await onboard();

    expect(res.status).toBe(500);
    expect(stripeMock.accounts.create).toHaveBeenCalledTimes(3);
    expect(linked()).toEqual([]);
    expect(stripeMock.accountLinks.create).not.toHaveBeenCalled();
  });

  it("a probe that fails for another reason is not read as dead (no re-key)", async () => {
    stripeMock.accounts.create.mockResolvedValue({ id: FRESH });
    stripeMock.accounts.retrieve.mockRejectedValue(stripeErr("Too many requests", { statusCode: 429 }));

    const res = await onboard();

    expect(res.status).toBe(500);
    expect(stripeMock.accounts.create).toHaveBeenCalledTimes(1);
    expect(linked()).toEqual([]);
  });
});

// ─── Q873 ───
describe("Q873 — status moves the cache by compare-and-set and sends the verified notice on the transition", () => {
  const onFile = (flags: { identity: boolean; charges: boolean; payouts: boolean }) => {
    scenario.reads.profiles = {
      rows: [{
        stripe_account_id: ACCT,
        stripe_identity_verified: flags.identity,
        stripe_charges_enabled: flags.charges,
        stripe_payouts_enabled: flags.payouts,
      }],
    };
  };
  const cacheWrites = () =>
    profileUpdates().filter((w) => "stripe_payouts_enabled" in ((w.payload as Record<string, unknown>) ?? {}));

  beforeEach(() => {
    baseEnv();
    onFile({ identity: false, charges: false, payouts: false });
  });
  afterEach(() => resetEnv());

  const status = () => call({ action: "status" });

  it("the write that moves the cache INTO enabled sends one verified notice; the CAS names all three flags", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);

    const res = await status();

    expect(res.status).toBe(200);
    const writes = cacheWrites();
    expect(writes.length, "inventory floor: the cache write ran").toBeGreaterThan(0);
    expect(writes).toHaveLength(1);
    expect(writes[0].filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "user_id", value: USER.id },
        { op: "eq", column: "stripe_account_id", value: ACCT },
        { op: "eq", column: "stripe_identity_verified", value: false },
        { op: "eq", column: "stripe_charges_enabled", value: false },
        { op: "eq", column: "stripe_payouts_enabled", value: false },
      ]),
    );
    expect(writes[0].selectCols).toBe("id");
    expect(noticeTitles()).toEqual(["Payout account verified"]);
  });

  it("zero rows (another writer moved it first) sends no notice", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);
    scenario.writeSelectRows["profiles:update"] = [];

    const res = await status();

    expect(res.status).toBe(200);
    expect(cacheWrites()).toHaveLength(1);
    expect(noticeTitles()).toEqual([]);
  });

  it("an already-enabled cache sends no second notice", async () => {
    onFile({ identity: true, charges: true, payouts: true });
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);

    const res = await status();

    expect(res.status).toBe(200);
    expect(noticeTitles()).toEqual([]);
  });

  it("a restricted account sends no verified notice", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(RESTRICTED);

    const res = await status();

    expect(res.status).toBe(200);
    expect(noticeTitles()).toEqual([]);
  });
});
