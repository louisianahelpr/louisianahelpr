/**
 * Q2794 (lead decision 2026-11-14, by recommendation; lh-money-escrow SAFE-WITH-FOLLOWUPS): 32 real members kept a
 * payout account id that Stripe no longer has after it rejected the Helpr platform on 2026-10-23 (16 cleared one by
 * one, each a page; 16 still on file, every one answered "does not have access ... or does not exist" by the live
 * Stripe API on 2026-11-15). Migration 20261115033601 clears the 16 left in one reviewed sweep and records each
 * clear without paging.
 *
 * This guard holds:
 *   1. the sweep is narrow: exact ids, non-seed profiles, the link only where it still holds that id, the same four
 *      columns stripe-connect's own clear sets, one record-only row per clear, and no member id in a public repo
 *      (behaviour, with the real Slack/ledger triggers: src/test/pglite/payoutAccountsGoneSweep.pglite.mjs);
 *   2. a member the sweep cleared sets up payouts again cleanly: stripe-connect (the REAL source, through the edge
 *      harness; nothing reaches Stripe) creates a fresh account for the profile row the sweep leaves, links it in
 *      place of nothing, and its status answers the empty state without asking Stripe about a dead id.
 *
 * @mutate supabase/migrations/20261115033601_clear_payout_accounts_gone_with_platform_rejection.sql |        AND p.is_seed IS NOT TRUE |        AND true
 * @mutate supabase/migrations/20261115033601_clear_payout_accounts_gone_with_platform_rejection.sql |       AND stripe_account_id = r.stripe_account_id; |       ;
 * @mutate supabase/migrations/20261115033601_clear_payout_accounts_gone_with_platform_rejection.sql |       jsonb_build_object('source', 'stripe-connect', 'kind', 'connect-dead-account-close'), |       jsonb_build_object('source', 'stripe-connect', 'kind', 'stale-clear'),
 * @mutate supabase/migrations/20261115033601_clear_payout_accounts_gone_with_platform_rejection.sql |           stripe_identity_verified = false |           stripe_identity_verified = stripe_identity_verified
 * @mutate supabase/migrations/20261115033601_clear_payout_accounts_gone_with_platform_rejection.sql |     CONTINUE WHEN v_n = 0; |     CONTINUE WHEN false;
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "../helpers/blankNonCode";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const FILE = "20261115033601_clear_payout_accounts_gone_with_platform_rejection.sql";
const raw = readFileSync(join(__dirname, "..", "..", "..", "supabase", "migrations", FILE), "utf8");
const sql = blankSqlComments(raw).replace(/\s+/g, " ");

describe("the dead payout account sweep is narrow (migration 20261115033601)", () => {
  it("names exactly the 16 measured ids and no member id", () => {
    const ids = [...sql.matchAll(/'(acct_[A-Za-z0-9]+)'/g)].map((m) => m[1]);
    expect(ids.length).toBe(16);
    expect(new Set(ids).size).toBe(16);
    // The surviving member account and the test fixture's are never in it.
    expect(ids).not.toContain("acct_1UQDLA3KPlb4n0ev");
    expect(raw).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("clears only a non-seed profile still on a listed id, with stripe-connect's own four columns", () => {
    expect(sql).toContain("WHERE p.stripe_account_id = ANY (v_gone) AND p.is_seed IS NOT TRUE");
    expect(sql).toContain(
      "UPDATE public.profiles SET stripe_account_id = NULL, stripe_payouts_enabled = false, stripe_charges_enabled = false, stripe_identity_verified = false WHERE user_id = r.user_id AND stripe_account_id = r.stripe_account_id;",
    );
  });

  it("records a clear only when the update changed the row", () => {
    expect(sql).toMatch(/AND stripe_account_id = r\.stripe_account_id; GET DIAGNOSTICS v_n = ROW_COUNT; CONTINUE WHEN v_n = 0; INSERT INTO public\.error_logs/);
  });

  it("records each clear as a record-only row, never a page", () => {
    expect(sql).toContain("jsonb_build_object('source', 'stripe-connect', 'kind', 'connect-dead-account-close')");
    expect(sql).not.toMatch(/stale-clear/);
    expect(sql).not.toMatch(/net\.http_post|slack/i);
  });
});

const MEMBER = { id: "55555555-5555-4555-8555-555555555555", email: "member@example.test" };
const RETURN_URL = "https://louisianahelpr.com/profile";
/** The profile row the sweep leaves behind. */
const SWEPT = { stripe_account_id: null, stripe_payouts_enabled: false, stripe_charges_enabled: false, stripe_identity_verified: false, full_name: "Swept Member" };

async function call(body: Record<string, unknown>) {
  const fn = await loadEdgeFunction("stripe-connect");
  return fn.fetch(fn.request({ headers: { Authorization: "Bearer good" }, body }));
}

describe("a member the sweep cleared sets up payouts again cleanly", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_live_real_money",
      STRIPE_TEST_SECRET_KEY: "sk_test_sandbox",
    });
    scenario.authUser = MEMBER;
    scenario.reads.test_accounts = { rows: [] };
    scenario.reads.error_logs = { rows: [], count: 0 };
    scenario.reads.profiles = { rows: [{ ...SWEPT }] };
    scenario.rpc.feature_enabled_for_user = (a?: unknown) => ["payout_setup", "payout_after_hire"].includes((a as { p_key?: string } | undefined)?.p_key ?? "");
    scenario.rpc.payout_setup_hire_allowed = true;
    stripeMock.accounts.create.mockResolvedValue({ id: "acct_fresh" });
    stripeMock.accounts.retrieve.mockImplementation(async (id: string) => ({ id, type: "express", requirements: { disabled_reason: null } }));
    stripeMock.accountLinks.create.mockResolvedValue({ url: "https://connect.stripe.test/onboard" });
  });
  afterEach(() => resetEnv());

  it("onboard creates one fresh account, links it, and opens its onboarding", async () => {
    const res = await call({ action: "onboard", return_url: RETURN_URL });
    expect(res.status).toBe(200);
    expect(stripeMock.accounts.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.accounts.del).not.toHaveBeenCalled();
    const links = stripeMock.accountLinks.create.mock.calls.map((c) => (c[0] as { account?: string }).account);
    expect(links).toEqual(["acct_fresh"]);
    const linked = scenario.writes.filter((w) => w.table === "profiles" && (w.payload as { stripe_account_id?: string }).stripe_account_id === "acct_fresh");
    expect(linked.length).toBeGreaterThan(0);
    // Nothing about the swept member is recorded as a retirement: there was no account left to retire.
    expect(scenario.writes.filter((w) => w.table === "connect_account_retirements")).toEqual([]);
  });

  it("status answers the empty state and asks Stripe about no account", async () => {
    const res = await call({ action: "status" });
    expect(res.status).toBe(200);
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
  });
});
