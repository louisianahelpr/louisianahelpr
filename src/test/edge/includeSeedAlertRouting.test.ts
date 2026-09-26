// @mutate supabase/functions/auto-release-payment/index.ts | seed: seedJobIds.has(job.id), | seed: false,
// @mutate supabase/functions/auto-release-payment/index.ts | if (seedJobIds.has(jobId)) seedDefects.push(reason); | if (false) seedDefects.push(reason);
// @mutate supabase/functions/process-scheduled-payouts/index.ts | if (seedJobIds.has(jobId)) seedDefects.push(reason); | if (false) seedDefects.push(reason);
// @mutate supabase/functions/process-scheduled-payouts/index.ts | kind: "payout_failed",\n          seed: seedJobIds.has(job.id),\n          severity: "critical",\n          title: "Scheduled payout failed", | kind: "payout_failed",\n          seed: false,\n          severity: "critical",\n          title: "Scheduled payout failed",
// @mutate supabase/functions/subscription-reconciliation/index.ts | return typeof id === "string" && seedUserIds.has(id); | return false;
// @mutate supabase/functions/process-scheduled-payouts/index.ts | (jobs ?? []).filter((j) => j.is_seed === true) | (jobs ?? []).filter((j) => j.is_seed !== false)
// @mutate supabase/functions/subscription-reconciliation/index.ts | notes.some((n) => n !== dryRunNote) | notes.length
// @mutate supabase/functions/process-scheduled-payouts/index.ts | const { ids: adminIds } = job.is_seed === true\n          ? { ids: [] as string[] } | const { ids: adminIds } = false\n          ? { ids: [] as string[] }
// @mutate supabase/functions/process-scheduled-payouts/index.ts | const { ids: adminIds } = job.is_seed === true\n              ? { ids: [] as string[] } | const { ids: adminIds } = job.is_seed !== false\n              ? { ids: [] as string[] }
// @mutate supabase/functions/subscription-reconciliation/index.ts | (seedProfile.has(id) ? `${id} (seed profile)` : id) | id
/**
 * docs/OPEN.md Q91: an `?include_seed=1` run of a money cron never pages
 * #ops-alerts for fixture data — and still pages for a real subject on the
 * same run.
 *
 * THE BUG. auto-release-payment, process-scheduled-payouts and
 * subscription-reconciliation read `include_seed` and alerted (Slack + the
 * HTTP-500 defect channel `sweep_cron_http_failures` watches) with no `seed`
 * flag, so a manual run against fixtures paged exactly like a real failure.
 * money-reconciliation had the same bug (Q90, a7522133e).
 *
 * THE RULE (32676b116's lesson). A hit is SEED only by the is_seed of the
 * entity it is ABOUT — the job for a payout, the profile for an entitlement.
 * Never by association (a subscription shared by two seed profiles is still a
 * subscription whose own seed-ness is unknown), and unknown => real => page.
 *
 * WHAT MUST NOT CHANGE. These functions move money. Routing is the only thing
 * that differs between a seed subject and a real one: every test below that
 * compares the two asserts the SAME results, the same writes and the same
 * Stripe calls, and only the alert routing / defect count differs.
 *
 * Runs the REAL function sources through the edge harness.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { PRO_ONE_TIME_AMOUNT_CENTS, PRO_PRICE_MAP, PRO_RECURRING_AMOUNT_CENTS } from "../../../supabase/functions/_shared/proTiers";

const CRON_SECRET = "cron-secret-seed-routing";
type Alert = { seed?: boolean; title?: string; severity?: string; fields?: Record<string, unknown>; message?: string };
const alerts = () => slackAlerts as Alert[];
const paging = () => alerts().filter((a) => !a.seed);
const digest = () => alerts().filter((a) => a.seed === true);

async function json(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

function cron(fn: EdgeHarness, url: string): Request {
  return fn.request({ method: "POST", url, headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} });
}

/** Writes with their payloads, stripped of anything that names the job — for seed-vs-real parity. */
function writeShape() {
  return scenario.writes.map((w) => ({ table: w.table, op: w.op, cols: Object.keys((w.payload as object) ?? {}).sort() }));
}

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("auto-release-payment ?include_seed=1", () => {
  const URL_SEED = "https://edge.test/auto-release-payment?include_seed=1";

  async function load(auto = "0") {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_test_abc",
      CRON_SECRET,
      RELEASE_PAYOUT_AUTO: auto,
    });
    return loadEdgeFunction("auto-release-payment");
  }

  /** One due escrow job whose capture check THROWS -> verify_failed, a defect. */
  function seedVerifyFailing(isSeed: boolean | undefined) {
    const row: Record<string, unknown> = {
      id: "job-1",
      title: "Clean gutters",
      helper_id: "helper-1",
      customer_id: "poster-1",
      budget: 100,
      platform_fee_amount: 12,
      urgent_fee: 0,
      helper_fee_percent: 12,
      poster_completed_at: null,
      helper_completed_at: new Date(Date.now() - 48 * 3600e3).toISOString(),
      stripe_session_id: "cs_1",
      stripe_payment_intent_id: "pi_1",
      status: "in_progress",
      is_group_job: false,
      helpers_needed: 1,
    };
    if (isSeed !== undefined) row.is_seed = isSeed;
    scenario.reads.jobs = {
      rows: [row],
      selectOverrides: [
        { includes: "revision_acceptance_deadline", result: { rows: [] } },
        { includes: "revision_deadline", result: { rows: [] } },
      ],
    };
    scenario.reads.gift_cards = { rows: [] };
    scenario.reads.profiles = { rows: [] };
    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error("stripe down"));
  }

  it("a SEED job's defect goes to the digest: 200, nothing pages, reported as seed", async () => {
    seedVerifyFailing(true);
    const fn = await load();
    const res = await fn.fetch(cron(fn, URL_SEED));
    const b = await json(res);
    expect((b.results as Array<{ status: string }>)[0].status).toBe("verify_failed");
    expect(res.status).toBe(200);
    expect(b.defects).toBe(0);
    expect(paging()).toHaveLength(0);
    expect(digest()).toHaveLength(1);
    expect(JSON.stringify(b.seedDefects)).toContain("job-1");
  });

  it("a REAL job on the same kind of run still pages via the defect channel (500)", async () => {
    seedVerifyFailing(false);
    const fn = await load();
    const res = await fn.fetch(cron(fn, URL_SEED));
    expect(res.status).toBe(500);
    expect(digest()).toHaveLength(0);
  });

  it("unknown is_seed is REAL", async () => {
    seedVerifyFailing(undefined);
    const fn = await load();
    const res = await fn.fetch(cron(fn, URL_SEED));
    expect(res.status).toBe(500);
    expect(digest()).toHaveLength(0);
  });

  it("seed vs real: identical results, writes and Stripe calls — only routing differs", async () => {
    const run = async (isSeed: boolean) => {
      resetSupabaseMock();
      resetStripeMock();
      resetSharedMocks();
      seedVerifyFailing(isSeed);
      // A capture that SUCCEEDS, so the release write and notifications run too.
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" });
      const fn = await load();
      const b = await json(await fn.fetch(cron(fn, URL_SEED)));
      return { results: b.results, released: b.released, writes: writeShape(), stripe: stripeMock.paymentIntents.retrieve.mock.calls };
    };
    const seed = await run(true);
    const real = await run(false);
    expect(seed.released).toBe(1);
    expect(seed).toEqual(real);
  });

  /** Phase 2: one matured payout that release-payout refuses on its 5th attempt. */
  function seedGiveUp(isSeed: boolean) {
    scenario.reads.jobs = {
      rows: [],
      selectOverrides: [
        {
          includes: "payout_scheduled_at",
          result: {
            rows: [{
              id: "job-p", title: "Paint fence", helper_id: "helper-1", budget: 100, urgent_fee: 0,
              is_group_job: false, helpers_needed: 1, payout_scheduled_at: new Date(0).toISOString(), is_seed: isSeed,
            }],
          },
        },
      ],
    };
    scenario.reads.profiles = { rows: [] };
    scenario.reads.gift_cards = { rows: [] };
    scenario.reads.payout_transfers = { rows: [1, 2, 3, 4].map(() => ({ job_id: "job-p" })) };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "helper has not completed Stripe Connect onboarding" }), { status: 409 })));
  }

  it("the give-up page for a SEED job is digest-only", async () => {
    seedGiveUp(true);
    const fn = await load("1");
    const res = await fn.fetch(cron(fn, URL_SEED));
    const b = await json(res);
    expect((b.payoutResults as Array<{ gave_up?: boolean }>)[0].gave_up).toBe(true);
    const giveUp = alerts().filter((a) => a.title === "Payout given up after repeated failures");
    expect(giveUp).toHaveLength(1);
    expect(giveUp[0].seed).toBe(true);
    expect(paging()).toHaveLength(0);
    expect(res.status).toBe(200);
  });

  it("the give-up page for a REAL job still pages", async () => {
    seedGiveUp(false);
    const fn = await load("1");
    await fn.fetch(cron(fn, URL_SEED));
    const giveUp = alerts().filter((a) => a.title === "Payout given up after repeated failures");
    expect(giveUp).toHaveLength(1);
    expect(giveUp[0].seed).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("process-scheduled-payouts ?include_seed=1", () => {
  const URL_SEED = "https://edge.test/process-scheduled-payouts?include_seed=1";

  async function load() {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_test_abc",
      CRON_SECRET,
    });
    return loadEdgeFunction("process-scheduled-payouts");
  }

  /** One payable job whose Stripe transfer THROWS -> transfer_failed + a page. */
  function seedTransferFailing(isSeed: boolean | undefined) {
    const job: Record<string, unknown> = {
      id: "job-1", title: "Mow the lawn", helper_id: "helper-1", customer_id: "poster-1",
      budget: 100, platform_fee_amount: 10, helper_fee_percent: 10, urgent_fee: 0,
      stripe_session_id: "cs_1", stripe_payment_intent_id: "pi_1", status: "completed",
      is_group_job: false, helpers_needed: 1, sales_tax_rate: 0,
    };
    if (isSeed !== undefined) job.is_seed = isSeed;
    scenario.reads.jobs = { rows: [job] };
    scenario.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
    scenario.reads.profiles = {
      rows: [{ stripe_account_id: "acct_helper", onboarding_fee_paid: true, subscription_tier: "pro", subscription_expires_at: null }],
    };
    scenario.reads.payout_transfers = { rows: [] };
    scenario.reads.user_roles = { rows: [] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1", status: "succeeded", latest_charge: "ch_1", amount: 11200, amount_received: 11200,
    });
    stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("insufficient funds"), { type: "StripeError" }));
  }

  it("a SEED job's failed transfer is digest-only and not a defect", async () => {
    seedTransferFailing(true);
    const fn = await load();
    const res = await fn.fetch(cron(fn, URL_SEED));
    const b = await json(res);
    expect((b.results as Array<{ status: string }>)[0].status).toBe("transfer_failed");
    expect(paging()).toHaveLength(0);
    expect(digest().some((a) => a.title === "Scheduled payout failed")).toBe(true);
    expect(res.status).toBe(200);
    expect(b.defects).toBe(0);
    expect(JSON.stringify(b.seedDefects)).toContain("job-1");
  });

  it("a REAL job's failed transfer still pages and is a defect (500)", async () => {
    seedTransferFailing(false);
    const fn = await load();
    const res = await fn.fetch(cron(fn, URL_SEED));
    expect(res.status).toBe(500);
    expect(paging().some((a) => a.title === "Scheduled payout failed")).toBe(true);
    expect(digest()).toHaveLength(0);
  });

  it("unknown is_seed is REAL", async () => {
    seedTransferFailing(undefined);
    const fn = await load();
    const res = await fn.fetch(cron(fn, URL_SEED));
    expect(res.status).toBe(500);
    expect(digest()).toHaveLength(0);
  });

  // docs/OPEN.md Q93 (a): the admins' in-app inbox is a channel too.
  const adminInbox = () => scenario.writes.filter((w) => w.table === "notifications" && JSON.stringify(w.payload).includes("admin-1"));

  it("Q93: a SEED job's failed transfer puts nothing in the admins' in-app inbox; a REAL one does", async () => {
    seedTransferFailing(true);
    scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
    let fn = await load();
    await fn.fetch(cron(fn, URL_SEED));
    expect(adminInbox(), "a seed job reached /admin notifications").toHaveLength(0);

    resetSupabaseMock();
    resetSharedMocks();
    seedTransferFailing(false);
    scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
    fn = await load();
    await fn.fetch(cron(fn, URL_SEED));
    expect(adminInbox().length, "the real job's admin alert is gone too: the fixture proves nothing").toBeGreaterThan(0);
  });

  it("Q93: a SEED job whose charge was not captured puts nothing in the admins' inbox; unknown is_seed does", async () => {
    for (const [isSeed, want] of [[true, 0], [undefined, 1]] as const) {
      resetSupabaseMock();
      resetStripeMock();
      resetSharedMocks();
      seedTransferFailing(isSeed);
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "requires_capture", latest_charge: "ch_1", amount: 11200, amount_received: 0 });
      scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
      const fn = await load();
      const b = await json(await fn.fetch(cron(fn, URL_SEED)));
      expect((b.results as Array<{ status: string }>)[0].status).toBe("pi_not_succeeded_requires_capture");
      expect(adminInbox(), `is_seed=${String(isSeed)}`).toHaveLength(want);
    }
  });

  it("seed vs real: the same transfer is attempted with the same arguments", async () => {
    const run = async (isSeed: boolean) => {
      resetSupabaseMock();
      resetStripeMock();
      resetSharedMocks();
      seedTransferFailing(isSeed);
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_1" });
      scenario.writeSelectRows.jobs = [{ id: "job-1" }];
      const fn = await load();
      const b = await json(await fn.fetch(cron(fn, URL_SEED)));
      return { results: b.results, processed: b.processed, writes: writeShape(), transfers: stripeMock.transfers.create.mock.calls };
    };
    const seed = await run(true);
    const real = await run(false);
    expect(seed.transfers).toHaveLength(1);
    expect(seed).toEqual(real);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("subscription-reconciliation ?include_seed=1", () => {
  const URL_SEED = "https://edge.test/subscription-reconciliation?include_seed=1&dry_run=1";

  async function load() {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_test_abc",
      CRON_SECRET,
    });
    // Every Price says what the app says, so the price check is clean.
    const amountFor = new Map<string, number>();
    const expected = { ...PRO_RECURRING_AMOUNT_CENTS, one_time: PRO_ONE_TIME_AMOUNT_CENTS };
    for (const cycle of ["monthly", "annual", "one_time"] as const) {
      for (const [tier, cents] of Object.entries(expected[cycle])) {
        const id = PRO_PRICE_MAP[cycle][tier as keyof typeof PRO_RECURRING_AMOUNT_CENTS.monthly];
        if (id) amountFor.set(id, cents as number);
      }
    }
    (stripeMock as unknown as { prices: unknown }).prices = {
      retrieve: vi.fn(async (id: string) => ({ id, unit_amount: amountFor.get(id), active: true })),
    };
    return loadEdgeFunction("subscription-reconciliation");
  }

  /** A paid tier with NO expiry and no live subscription: a critical finding. */
  const neverLapsing = (userId: string, isSeed: boolean | undefined, sub: string | null = null) => {
    const p: Record<string, unknown> = {
      user_id: userId, email: `${userId}@example.test`, subscription_tier: "pro", subscription_expires_at: null,
      stripe_customer_id: null, stripe_subscription_id: sub, subscription_billing_cycle: "monthly",
      subscription_cancel_at_period_end: false, subscription_source: "stripe",
    };
    if (isSeed !== undefined) p.is_seed = isSeed;
    return p;
  };

  it("a SEED profile's drift is digest-only: 200, nothing pages, reported as seed_findings", async () => {
    scenario.reads.profiles = { rows: [neverLapsing("u-seed", true)] };
    const fn = await load();
    const res = await fn.fetch(cron(fn, URL_SEED));
    const b = await json(res);
    expect(b.findings).toEqual([]);
    expect(JSON.stringify(b.seed_findings)).toContain("u-seed");
    expect(paging()).toHaveLength(0);
    expect(digest()).toHaveLength(1);
    expect(res.status).toBe(200);
  });

  it("a REAL profile on the same run still pages, naming only the real profile", async () => {
    scenario.reads.profiles = { rows: [neverLapsing("u-seed", true), neverLapsing("u-real", false)] };
    const fn = await load();
    const res = await fn.fetch(cron(fn, URL_SEED));
    const b = await json(res);
    expect(res.status).toBe(500);
    const findings = b.findings as Array<{ sample: unknown[] }>;
    expect(findings).toHaveLength(1);
    expect(JSON.stringify(findings)).toContain("u-real");
    expect(JSON.stringify(findings)).not.toContain("u-seed");
    expect(paging()).toHaveLength(1);
    expect(digest()).toHaveLength(1);
  });

  it("unknown is_seed is REAL", async () => {
    scenario.reads.profiles = { rows: [neverLapsing("u-x", undefined)] };
    const fn = await load();
    const res = await fn.fetch(cron(fn, URL_SEED));
    expect(res.status).toBe(500);
    expect(paging()).toHaveLength(1);
    expect(digest()).toHaveLength(0);
  });

  it("never seed by association: a subscription id shared by two SEED profiles still pages", async () => {
    // The subject of duplicate_subscription_id is the SUBSCRIPTION; it carries
    // no is_seed of its own, so its seed-ness is unknown => real.
    scenario.reads.profiles = {
      rows: [
        { ...neverLapsing("u-s1", true, "sub_dup"), subscription_expires_at: new Date(Date.now() + 9e8).toISOString() },
        { ...neverLapsing("u-s2", true, "sub_dup"), subscription_expires_at: new Date(Date.now() + 9e8).toISOString() },
      ],
    };
    const fn = await load();
    const b = await json(await fn.fetch(cron(fn, URL_SEED)));
    expect(JSON.stringify(b.findings)).toContain("duplicate_subscription_id");
    expect(paging()).toHaveLength(1);
  });

  it("a clean DRY run posts nothing — the dry-run note is a mode, not a degradation", async () => {
    // Without this, fixing the seed routing would turn a seed-only dry run
    // into a "ran degraded" page (its findings no longer set `worst`).
    scenario.reads.profiles = { rows: [] };
    const fn = await load();
    const res = await fn.fetch(cron(fn, URL_SEED));
    expect(res.status).toBe(200);
    expect(alerts()).toHaveLength(0);
  });

  it("Q93 (b): a failed repair WRITE on a seed profile stays a defect, and its text says seed profile", async () => {
    // Repair mode (no dry_run), and the profile UPDATE returns an empty list.
    scenario.reads.profiles = { rows: [neverLapsing("u-seed", true)] };
    scenario.writeSelectRows.profiles = [];
    const fn = await load();
    const res = await fn.fetch(cron(fn, "https://edge.test/subscription-reconciliation?include_seed=1"));
    const text = JSON.stringify(await json(res));
    expect(res.status, "a broken write on a seed profile was muted").toBe(500);
    expect(text).toContain("repair failed — u-seed (seed profile): repair matched 0 rows");
  });

  it("Q93 (b): the same failure on a REAL profile carries no seed label", async () => {
    scenario.reads.profiles = { rows: [neverLapsing("u-real", false)] };
    scenario.writeSelectRows.profiles = [];
    const fn = await load();
    const res = await fn.fetch(cron(fn, "https://edge.test/subscription-reconciliation?include_seed=1"));
    const text = JSON.stringify(await json(res));
    expect(res.status).toBe(500);
    expect(text).toContain("repair failed — u-real: repair matched 0 rows");
  });

  it("seed vs real: the same repairs are computed", async () => {
    const run = async (isSeed: boolean) => {
      resetSupabaseMock();
      resetSharedMocks();
      scenario.reads.profiles = { rows: [neverLapsing("u-1", isSeed)] };
      const fn = await load();
      const b = await json(await fn.fetch(cron(fn, URL_SEED)));
      return { repairs_computed: b.repairs_computed, writes: writeShape() };
    };
    const seed = await run(true);
    expect(seed.repairs_computed).toBe(1);
    expect(seed).toEqual(await run(false));
  });
});
