/*
 * Q1816 (core-loop-canary #4151): scripts/stripe-test-detach-cards.mjs detaches the saved cards piling up on the
 * TEST accounts' Stripe TEST wallet customers ("Customer has maximum number of payment methods attached"). It
 * must never touch live mode or a real member: test-mode secret key only, customers only from OUR database and
 * only for test/is_seed accounts, never a Stripe customer list, and it stops on any livemode object.
 *
 * @mutate scripts/stripe-test-detach-cards.mjs | if (!key.startsWith("sk_test_")) { | if (false) {
 * @mutate scripts/stripe-test-detach-cards.mjs | return candidates.filter((w) => allowed.has(w.user_id)) | return candidates.filter((w) => true)
 * @mutate scripts/stripe-test-detach-cards.mjs | const live = pms.find((pm) => pm.livemode !== false); | const live = undefined;
 * @mutate scripts/stripe-test-detach-cards.mjs | .slice(keepNewest); | .slice(0);
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error — plain .mjs script, no declarations
import { refuseKey, testWalletCustomers, detachSavedCards, DEFAULT_KEEP_NEWEST } from "../../scripts/stripe-test-detach-cards.mjs";

const ROOT = resolve(__dirname, "..", "..");
const SCRIPT = resolve(ROOT, "scripts/stripe-test-detach-cards.mjs");

type Pm = { id: string; created: number; livemode: boolean };
function mockStripe(byCustomer: Record<string, Pm[]>, pageSize = 2) {
  const calls: string[] = [];
  const detached: string[] = [];
  return {
    calls,
    detached,
    listPaymentMethods: async (customer: string, after?: string) => {
      calls.push(`list ${customer}${after ? ` after ${after}` : ""}`);
      const all = byCustomer[customer] ?? [];
      const start = after ? all.findIndex((p) => p.id === after) + 1 : 0;
      const data = all.slice(start, start + pageSize);
      return { data, has_more: start + pageSize < all.length };
    },
    detach: async (pm: string) => {
      calls.push(`detach ${pm}`);
      detached.push(pm);
      return { id: pm, livemode: false };
    },
  };
}

describe("TEST-mode saved-card cleanup never touches live mode or a real member", () => {
  it("refuses a live, restricted or missing key", () => {
    expect(refuseKey("sk_live_planted")).toMatch(/not a test-mode secret key/);
    expect(refuseKey("rk_live_planted")).toMatch(/not a test-mode secret key/);
    expect(refuseKey("rk_test_planted")).toMatch(/not a test-mode secret key/);
    expect(refuseKey("pk_test_planted")).toMatch(/not a test-mode secret key/);
    expect(refuseKey(undefined)).toMatch(/not set/);
    expect(refuseKey("")).toMatch(/not set/);
    expect(refuseKey("sk_test_ok")).toBeNull();
  });

  it("a planted sk_live_ key exits 1 before any network call", () => {
    const r = spawnSync(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH, STRIPE_TEST_SECRET_KEY: "sk_live_planted", SUPABASE_SERVICE_ROLE_KEY: "x",
        // a dead loopback port: any request would fail with a DIFFERENT message
        SUPABASE_URL: "http://127.0.0.1:9", LH_STRIPE_API_BASE: "http://127.0.0.1:9" },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not a test-mode secret key \(sk_test_\); refusing, nothing was detached/);
    expect(r.stderr).not.toMatch(/PostgREST|Stripe (GET|POST)/);
  });

  it("reads customers only from stripe_customers (test mode) for test or is_seed accounts", async () => {
    const urls: string[] = [];
    const rows: Record<string, unknown[]> = {
      stripe_customers: [
        { user_id: "u-test", stripe_customer_id: "cus_TEST1", wallet_mode: "test" },
        { user_id: "u-seed", stripe_customer_id: "cus_SEED1", wallet_mode: "test" },
        { user_id: "u-real", stripe_customer_id: "cus_REAL1", wallet_mode: "test" },
        { user_id: "u-live", stripe_customer_id: "cus_LIVE1", wallet_mode: "live" },
      ],
      test_accounts: [{ user_id: "u-test" }],
      profiles: [{ user_id: "u-seed" }],
    };
    const fetchImpl = async (url: string) => {
      urls.push(url);
      const table = new URL(url).pathname.split("/").pop()!;
      return new Response(JSON.stringify(rows[table] ?? []), { status: 200 });
    };
    const got = await testWalletCustomers({ supabaseUrl: "http://db.local", serviceKey: "svc", fetchImpl });
    expect(got).toEqual([{ userId: "u-test", customer: "cus_TEST1" }, { userId: "u-seed", customer: "cus_SEED1" }]);
    expect(urls[0]).toMatch(/\/rest\/v1\/stripe_customers\?.*wallet_mode=eq\.test/);
    expect(urls.some((u) => /profiles\?.*is_seed=eq\.true/.test(u))).toBe(true);
    expect(urls.every((u) => u.startsWith("http://db.local/rest/v1/"))).toBe(true);
  });

  it("a failed database read throws with PostgREST's words (nothing detached)", async () => {
    const fetchImpl = async () => new Response('{"message":"permission denied"}', { status: 401 });
    await expect(testWalletCustomers({ supabaseUrl: "http://db.local", serviceKey: "svc", fetchImpl }))
      .rejects.toThrow(/PostgREST GET stripe_customers 401: .*permission denied/);
  });

  it("keeps the newest cards, detaches the rest, across pages", async () => {
    const pms: Pm[] = Array.from({ length: 7 }, (_, i) => ({ id: `pm_${i}`, created: 1000 + i, livemode: false }));
    const stripe = mockStripe({ cus_A: pms, cus_B: [] });
    const n = await detachSavedCards({ stripe, customers: [{ customer: "cus_A" }, { customer: "cus_B" }], log: () => {} });
    expect(DEFAULT_KEEP_NEWEST).toBe(3);
    expect(n).toBe(4);
    expect(stripe.detached.sort()).toEqual(["pm_0", "pm_1", "pm_2", "pm_3"]);
    expect(stripe.calls.filter((c) => c.startsWith("list cus_A")).length).toBe(4); // 7 cards, pages of 2
  });

  it("stops on a live-mode payment method without detaching anything of that customer", async () => {
    const stripe = mockStripe({ cus_A: [
      { id: "pm_t1", created: 1, livemode: false }, { id: "pm_t2", created: 2, livemode: false },
      { id: "pm_t3", created: 3, livemode: false }, { id: "pm_t4", created: 4, livemode: false },
      { id: "pm_live", created: 5, livemode: true },
    ] });
    await expect(detachSavedCards({ stripe, customers: [{ customer: "cus_A" }], log: () => {} })).rejects.toThrow(/not test mode/);
    expect(stripe.detached).toEqual([]);
  });

  it("never lists Stripe customers; the workflows run it before the money journeys with the existing TEST secret", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).not.toMatch(/["'`]\/v1\/customers(\?|["'`])/);
    expect(src).not.toMatch(/customers\.list|\/v1\/customers\/search/);
    for (const [wf, runStep] of [
      ["core-loop-canary.yml", "npx playwright test --project=canary"],
      ["e2e-journeys.yml", "npx playwright test --project=journeys "],
      ["e2e-journeys.yml", "npx playwright test --project=journeys-webkit"],
    ] as const) {
      const text = readFileSync(resolve(ROOT, ".github/workflows", wf), "utf8");
      const run = text.indexOf(runStep);
      expect(run, `${wf}: ${runStep}`).toBeGreaterThan(0);
      const jobStart = text.lastIndexOf("\n  ", text.lastIndexOf("runs-on:", run));
      const job = text.slice(jobStart, run);
      const step = job.lastIndexOf("node scripts/stripe-test-detach-cards.mjs");
      expect(step, `${wf}: the cleanup runs before ${runStep}`).toBeGreaterThan(0);
      expect(job.lastIndexOf("SUPABASE_SERVICE_ROLE_KEY=", step) > 0 || job.lastIndexOf("./.github/actions/service-role-key", step) > 0,
        `${wf}: the service-role key is set before the cleanup`).toBe(true);
      expect(job.slice(job.lastIndexOf("- name:", step), step)).toMatch(/STRIPE_TEST_SECRET_KEY: \$\{\{ secrets\.STRIPE_TEST_SECRET_KEY \}\}/);
    }
  });
});
