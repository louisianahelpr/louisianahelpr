/**
 * Unit tests for the `helpr-pass-wallet` Supabase edge function — specifically
 * its entitlement gate, which had the NULL-expiry inversion (SC-014).
 *
 * `subscription_expires_at` being NULL on a paid tier means "no scheduled
 * end", and every other gate in the codebase reads it that way: the fee
 * resolvers, instant-payout, and the SQL of `public.early_access_cutoff`,
 * which states it outright — "Only a STAMPED PAST date lapses: a NULL expiry
 * is an active grant". This function read the opposite,
 * `subExp ? subExp > new Date() : false`, so an Elite member on a comped or
 * lifetime grant — precisely the accounts that carry a null expiry — was
 * refused their own perk with a 402 telling them to buy the tier they already
 * held.
 *
 * That is why the assertion below is on the ENDPOINT and not on the helper.
 * `profileHasPerk` is already proven by tierPerks.parity.test.ts; what was
 * broken here was one function's private re-derivation of a convention it did
 * not own, and only a test that runs the real source can see that.
 *
 * Runs the REAL function source through the edge harness; only Supabase, the
 * shared helpers and the Deno runtime are doubled.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock } from "./mocks/stripe";
import { TIER_ORDER, tiersGrantingPerk } from "../../../supabase/functions/_shared/tierPerks";

const USER_ID = "user-pass-1";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  return loadEdgeFunction("helpr-pass-wallet");
}

function call(fn: EdgeHarness) {
  return fn.request({ headers: { Authorization: "Bearer user-jwt" }, body: {} });
}

/** A profile on `tier`, with the given raw `subscription_expires_at`. */
function seed(tier: string, expiresAt: string | null) {
  scenario.authUser = { id: USER_ID, email: "pass@test.dev" };
  scenario.reads.profiles = {
    rows: [
      {
        full_name: "Test Helpr",
        avatar_url: null,
        subscription_tier: tier,
        subscription_expires_at: expiresAt,
        idv_status: "verified",
        license_status: null,
        insurance_status: null,
      },
    ],
  };
  scenario.reads.reviews = { rows: [] };
}

const YEAR_OUT = () => new Date(Date.now() + 365 * 86_400_000).toISOString();
const YEAR_AGO = () => new Date(Date.now() - 365 * 86_400_000).toISOString();

/** The one tier that grants the pass today — derived, not typed. */
const ENTITLED = tiersGrantingPerk("helprPass");

describe("helpr-pass-wallet — the entitlement gate", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
  });

  // PAST THE GATE is 501, not 200: Apple Wallet signing certificates are not
  // configured yet and the function says so in as many words (index.ts:195).
  // 501 is therefore the correct assertion for "entitled" — asserting 200
  // would be asserting a feature that has not shipped, and would go red for
  // the wrong reason the day the certificates land. What matters here is only
  // that the request is not turned away at the paywall.
  const PAST_THE_GATE = 501;

  it("lets a NULL expiry through the gate — a comped grant is ACTIVE", async () => {
    // THE REGRESSION. Before the fix this branch answered 402
    // "Helpr Pass is an Elite perk." to a member holding Elite.
    seed(ENTITLED[0], null);
    const res = await (await load()).fetch(call(await load()));
    expect(res.status).not.toBe(402);
    expect(res.status).toBe(PAST_THE_GATE);
  });

  it("lets a future expiry through the gate", async () => {
    seed(ENTITLED[0], YEAR_OUT());
    const res = await (await load()).fetch(call(await load()));
    expect(res.status).not.toBe(402);
    expect(res.status).toBe(PAST_THE_GATE);
  });

  it("refuses a PAST expiry — a lapsed member is not entitled", async () => {
    // The half that was always right, and must stay right: the fix must not
    // turn "null means active" into "expiry is ignored".
    seed(ENTITLED[0], YEAR_AGO());
    const res = await (await load()).fetch(call(await load()));
    expect(res.status).toBe(402);
  });

  it("refuses every tier that does not grant the perk, expiry notwithstanding", async () => {
    for (const tier of TIER_ORDER.filter((t) => !ENTITLED.includes(t))) {
      seed(tier, null);
      const res = await (await load()).fetch(call(await load()));
      expect(res.status, `${tier} must not receive a Helpr Pass`).toBe(402);
    }
  });

  it("names the entitled tier in the refusal, derived from the same table", async () => {
    // The gate and the sentence explaining it come from one source, so the
    // 403/402 copy can never tell someone to buy a plan they already hold —
    // which is exactly what instant-payout was doing to Plus members.
    seed("free", null);
    const res = await (await load()).fetch(call(await load()));
    const body = JSON.parse(await res.text());
    expect(body.required_tier).toBe(ENTITLED[0]);
    expect(body.error).toContain("Helpr Pass");
  });
});
