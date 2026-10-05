// @mutate supabase/functions/money-reconciliation/index.ts | if ((hit as { gift_card_id?: unknown } \| null)?.gift_card_id != null) return false; | if (false) return false;
// @mutate supabase/functions/money-reconciliation/index.ts | if (job.dispute_status === "resolved" && !job.cancelled_at) continue; | if (false) continue;
/**
 * Unit tests for the `money-reconciliation` Supabase edge function — the
 * read-only alarm for money rows that disagree with what settlement derives.
 *
 * THE DEFECT THESE PIN
 *
 * Every scan was `.limit(SCAN_LIMIT)` with `SCAN_LIMIT = 5000`, guarded by
 * `if (rows.length >= SCAN_LIMIT) caps.push(...)`. That alarm was
 * UNSATISFIABLE. PostgREST enforces `db-max-rows = 1000` on this project and
 * an explicit larger `.limit()` does not raise it — measured against prod on
 * 2026-09-01, `notifications?select=id&limit=5000` on a 1,619-row table
 * returned exactly 1000 rows. So `rows.length` topped out at 1000, `1000 >=
 * 5000` was false on every run forever, and a reconciler that had audited at
 * most a fifth of the money reported "clean, no caps hit".
 *
 * A reconciler that certifies completeness over data it never read is worse
 * than no reconciler. The scans now page (`_shared/paginate.ts`, real, not
 * mocked) and compare what they read against the SERVER'S OWN exact count, and
 * a shortfall is a defect that reaches both Slack and the HTTP status.
 *
 * Runs the REAL function source through the edge harness, including the real
 * `_shared/cancellationFee.ts`, `_shared/helperFees.ts`, `_shared/escrowTiming.ts`
 * and `_shared/cron-result.ts`, so the comparisons under test are the ones
 * settlement actually performs.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { resetStripeMock } from "./mocks/stripe";
import { jobLocalDateISO } from "../helpers/jobLocalDate";

const CRON_SECRET = "cron-secret";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    // Prod has it. Without it the cancellation-fee ledger's Stripe side
    // (LOW-2) cannot run, which is a degraded run, not a clean one.
    STRIPE_SECRET_KEY: "sk_test_x",
    CRON_SECRET,
  });
  return loadEdgeFunction("money-reconciliation");
}

function cronRequest(fn: EdgeHarness, url = "https://edge.test/fn") {
  return fn.request({ url, headers: { Authorization: `Bearer ${CRON_SECRET}` } });
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

/** A clean, fully-settled completed job with a matching payout ledger row. */
function seedCleanLedger() {
  scenario.reads.jobs = {
    rows: [
      {
        id: "job-1",
        is_seed: false,
        status: "completed",
        payment_status: "released",
        budget: 100,
        date_needed: new Date(Date.now() - 5 * 86_400_000).toISOString(),
        cancelled_at: null,
        helper_id: "helper-1",
        cancellation_fee: 0,
        cancellation_fee_status: null,
        late_cancellation: false,
        platform_fee_amount: 12,
        helper_fee_percent: 12,
        is_group_job: false,
        helpers_needed: 1,
        has_active_dispute: false,
        dispute_status: null,
        poster_completed_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
        helper_completed_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
        payout_scheduled_at: null,
        updated_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
      },
    ],
  };
  scenario.reads.payout_transfers = {
    rows: [
      {
        job_id: "job-1",
        amount_cents: 8800,
        platform_fee_cents: 1200,
        status: "paid",
        stripe_transfer_id: "tr_1",
      },
    ],
  };
  scenario.reads.disputes = { rows: [] };
  scenario.reads.profiles = { rows: [] };
  // The gift-credit tree. Seeded empty on a clean ledger: the reconciler reads
  // it unconditionally and FAILS CLOSED on a read error (a dropped one would
  // read as "no gift defects", the false all-clear this whole function exists
  // to prevent), so an unseeded table is a 500, not a silent skip.
  scenario.reads.gift_cards = { rows: [] };
}

describe("money-reconciliation edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
  });

  it("rejects a request without the cron bearer", async () => {
    const fn = await loadConfigured();
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
  });

  it("is SILENT on a clean ledger — no Slack, 200, zero defects", async () => {
    const fn = await loadConfigured();
    seedCleanLedger();

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(200);
    expect(b.ok).toBe(true);
    expect(b.clean).toBe(true);
    expect(slackAlerts).toHaveLength(0);
  });

  it("reports what it read NEXT TO what the server says exists", async () => {
    // The whole remedy in one field. "0 findings" is only meaningful alongside
    // the number of rows the finding-free claim covers, and that number now
    // comes from the server rather than from a client-side limit.
    const fn = await loadConfigured();
    seedCleanLedger();
    scenario.reads.jobs = { ...scenario.reads.jobs, count: 1 };

    const b = await body(await fn.fetch(cronRequest(fn)));
    const scanned = b.scanned as Record<string, unknown>;

    expect(scanned.jobs).toBe(1);
    expect((scanned.server_totals as Record<string, unknown>).jobs).toBe(1);
    expect(Number(scanned.pages)).toBeGreaterThan(0);
  });

  it("TRUNCATION is a defect: a short jobs scan fails the run and pages Slack", async () => {
    // The case the old alarm could never see. The rows themselves say nothing
    // is wrong; only the server's count reveals that four fifths of the money
    // was never looked at.
    const fn = await loadConfigured();
    seedCleanLedger();
    scenario.reads.jobs = { ...scenario.reads.jobs, count: 1619 };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(b.ok).toBe(false);
    expect(b.clean).toBe(true); // no discrepancies found…
    expect(String(b.defectReasons)).toContain("truncated scan");
    expect(String(b.defectReasons)).toContain("read 1 of 1619 rows");
    // …but "clean" over an unknown fraction is not a clean run, so it speaks.
    expect(slackAlerts).toHaveLength(1);
    expect(String((slackAlerts[0] as { title: string }).title)).toContain("degraded");
  });

  it("PAGES past the 1000-row cap on the jobs scan", async () => {
    const fn = await loadConfigured();
    seedCleanLedger();
    const base = (scenario.reads.jobs.rows ?? [])[0];
    scenario.reads.jobs = {
      rows: Array.from({ length: 1200 }, (_, i) => ({ ...base, id: `job-${i}` })),
      count: 1200,
    };
    // Every job now claims a payout row; the ledger check needs one per job or
    // `released_without_payout_transfer` fires 1,200 times.
    scenario.reads.payout_transfers = {
      rows: Array.from({ length: 1200 }, (_, i) => ({
        job_id: `job-${i}`,
        amount_cents: 8800,
        platform_fee_cents: 1200,
        status: "paid",
        stripe_transfer_id: `tr_${i}`,
      })),
      count: 1200,
    };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    // An unpaged read stops at the first 1000-row window; the mock slices on
    // `.range()` exactly as PostgREST does, so 1200 IS the paging.
    expect((b.scanned as Record<string, unknown>).jobs).toBe(1200);
    expect(res.status).toBe(200);
    expect(b.clean).toBe(true);
  });

  it("still catches a real discrepancy — a released job with no payout row", async () => {
    const fn = await loadConfigured();
    seedCleanLedger();
    scenario.reads.payout_transfers = { rows: [] };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    const findings = b.findings as Array<{ check: string; severity: string }>;
    expect(findings.map((f) => f.check)).toContain("released_without_payout_transfer");
    expect(res.status).toBe(500);
    expect(slackAlerts).toHaveLength(1);
  });

  // ── A dispute decision is not a cancellation (docs/OPEN.md Q336) ──────
  // rpc_decide_dispute (poster wins) sets status 'cancelled' and
  // dispute_status 'resolved' but never cancelled_at; the $0 close then sets
  // payment_status 'cancelled'. Read as a cancellation, a committed Helpr and
  // a past date yield a 50% fee "owed" -> a critical page on a job that owes
  // nothing. A plain cancellation with the same fields still flags.
  describe("dispute-closed jobs (Q336)", () => {
    function cancelledJob(extra: Record<string, unknown>) {
      seedCleanLedger();
      scenario.reads.jobs = { rows: [{
        ...(scenario.reads.jobs as { rows: Record<string, unknown>[] }).rows[0],
        id: "job-d", status: "cancelled", payment_status: "cancelled",
        helper_confirmed_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
        platform_fee_amount: 0, poster_completed_at: null, helper_completed_at: null,
        date_needed: jobLocalDateISO(-5), start_time: null,
        ...extra,
      }] };
      scenario.reads.payout_transfers = { rows: [] };
    }
    it("a poster-wins $0 close raises no fee finding", async () => {
      const fn = await loadConfigured();
      cancelledJob({ dispute_status: "resolved", cancelled_at: null });
      const b = await body(await fn.fetch(cronRequest(fn)));
      expect(b.error).toBeUndefined();
      const checks = ((b.findings ?? []) as Array<{ check: string }>).map((f) => f.check);
      expect(checks.filter((c) => /cancellation|late_cancellation/.test(c))).toEqual([]);
    });
    it("the same job cancelled WITHOUT a dispute still flags the unmarked fee", async () => {
      const fn = await loadConfigured();
      cancelledJob({ dispute_status: null, cancelled_at: new Date(Date.now() - 4 * 86_400_000).toISOString() });
      const b = await body(await fn.fetch(cronRequest(fn)));
      expect(b.error).toBeUndefined();
      const checks = ((b.findings ?? []) as Array<{ check: string }>).map((f) => f.check);
      expect(checks).toContain("cancellation_fee_mismatch");
    });
  });

  // ── include_seed runs never page (docs/OPEN.md Q90) ─────────────────────
  // 2026-09-23 ~07:54Z: manual `?include_seed=1` verification runs found 17
  // discrepancies, every one on an is_seed job, and paged #ops-alerts at
  // critical (ops_alert_ledger c974c7b3). Seed findings are real output — they
  // prove the checks fire — but they belong in the digest, not the channel.
  describe("seed findings (?include_seed=1)", () => {
    const seedUrl = "https://edge.test/fn?include_seed=1";
    const seedOnly = () => {
      seedCleanLedger();
      const jobs = scenario.reads.jobs as { rows: Array<Record<string, unknown>> };
      jobs.rows[0].is_seed = true;
      scenario.reads.payout_transfers = { rows: [] };
    };

    it("a seed-only discrepancy goes to the digest: no page, no defect, still in the body", async () => {
      const fn = await loadConfigured();
      seedOnly();
      const res = await fn.fetch(cronRequest(fn, seedUrl));
      const b = await body(res);

      const paged = (slackAlerts as Array<{ seed?: boolean }>).filter((a) => !a.seed);
      expect(paged).toHaveLength(0);
      expect(slackAlerts).toHaveLength(1);
      expect((slackAlerts[0] as { seed?: boolean }).seed).toBe(true);
      expect(res.status).toBe(200);
      expect(b.findings).toEqual([]);
      const seedFindings = b.seed_findings as Array<{ check: string }>;
      expect(seedFindings.map((f) => f.check)).toContain("released_without_payout_transfer");
    });

    it("a REAL discrepancy on the same run still pages, naming only the real job", async () => {
      const fn = await loadConfigured();
      seedOnly();
      const jobs = scenario.reads.jobs as { rows: Array<Record<string, unknown>> };
      jobs.rows.push({ ...jobs.rows[0], id: "job-real", is_seed: false });
      const res = await fn.fetch(cronRequest(fn, seedUrl));
      const b = await body(res);

      const paged = (slackAlerts as Array<{ seed?: boolean; fields?: Record<string, string> }>).filter((a) => !a.seed);
      expect(paged).toHaveLength(1);
      expect(paged[0].fields?.released_without_payout_transfer).toContain("job-real");
      expect(paged[0].fields?.released_without_payout_transfer).not.toContain("job-1");
      expect(res.status).toBe(500);
      const findings = b.findings as Array<{ check: string; count: number }>;
      expect(findings.find((f) => f.check === "released_without_payout_transfer")?.count).toBe(1);
    });

    it("a REAL gift card spent then refunded still pages when redeemed against a SEED job", async () => {
      // gift_cards has no is_seed; the job it was redeemed on is not its owner.
      const fn = await loadConfigured();
      seedCleanLedger();
      const jobs = scenario.reads.jobs as { rows: Array<Record<string, unknown>> };
      jobs.rows[0].is_seed = true;
      scenario.reads.gift_cards = {
        rows: [
          { id: "gc-real", parent_credit_id: null, payment_status: "refunded", status: "redeemed", amount: 50, job_id: jobs.rows[0].id },
        ],
      };
      const res = await fn.fetch(cronRequest(fn, seedUrl));
      const b = await body(res);
      const names = (b.findings as Array<{ check: string }>).map((f) => f.check);
      expect(names).toContain("gift_revoked_after_being_spent");
      const seedNames = ((b.seed_findings ?? []) as Array<{ check: string }>).map((f) => f.check);
      expect(seedNames).not.toContain("gift_revoked_after_being_spent");
    });
  });

  // ── refunded_with_live_payout class check ─────────────────────────────────
  // A job flipped to payment_status='refunded' while a live (paid) payout_transfers
  // row still exists is the double-outflow: the poster was refunded and the Helpr
  // keeps the payout. Nothing else in the app sees it, because 'refunded' reads as
  // settled. This check is the only thing that catches it — proven red on a seed job.
  it("catches a refunded job that still carries a LIVE payout (refunded_with_live_payout)", async () => {
    const fn = await loadConfigured();
    seedCleanLedger();
    // Same job, but refunded AFTER the Helpr was paid — the transfer row is
    // still 'paid' and was never reversed.
    scenario.reads.jobs = {
      rows: [{ ...(scenario.reads.jobs.rows ?? [])[0], payment_status: "refunded" }],
    };
    // payout_transfers left as the clean 'paid' row from seedCleanLedger.
    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);
    const findings = b.findings as Array<{ check: string; severity: string }>;
    const hit = findings.find((f) => f.check === "refunded_with_live_payout");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("critical");
  });

  // A refunded job whose payout was REVERSED (money clawed back) is NOT the
  // hole — the reversal is exactly what makes the platform whole. Must stay clean.
  it("does NOT flag a refunded job whose payout was reversed", async () => {
    const fn = await loadConfigured();
    seedCleanLedger();
    scenario.reads.jobs = {
      rows: [{ ...(scenario.reads.jobs.rows ?? [])[0], payment_status: "refunded" }],
    };
    scenario.reads.payout_transfers = {
      rows: [
        {
          job_id: "job-1",
          amount_cents: 8800,
          platform_fee_cents: 1200,
          status: "reversed",
          stripe_transfer_id: "tr_1",
        },
      ],
    };
    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);
    const findings = b.findings as Array<{ check: string }>;
    expect(findings.map((f) => f.check)).not.toContain("refunded_with_live_payout");
    // A fully-clean ledger: reversed payout is the platform made whole again.
    expect(res.status).toBe(200);
    expect(b.clean).toBe(true);
  });

  it("a truncated DISPUTE cross-check skips the check instead of inventing criticals", async () => {
    // `dispute_flag_without_row` is a CRITICAL, and a short read makes flagged
    // jobs look like they have no dispute row. So a shortfall here would not
    // hide findings, it would MANUFACTURE them — the fastest way to teach
    // everyone to ignore this alarm.
    const fn = await loadConfigured();
    seedCleanLedger();
    scenario.reads.jobs = {
      rows: [{ ...(scenario.reads.jobs.rows ?? [])[0], has_active_dispute: true, dispute_status: "open" }],
    };
    scenario.reads.disputes = { rows: [], count: 5 };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    const findings = b.findings as Array<{ check: string }>;
    expect(findings.map((f) => f.check)).not.toContain("dispute_flag_without_row");
    expect(String(b.notes)).toContain("dispute cross-check skipped");
    expect(res.status).toBe(500);
  });

  // The two TIME-CREDIT tests that lived here (truncated-scan degradation and
  // the (user, created_at, id) re-sort after paging by id) were removed with
  // the check they covered: migration 20260901035602 dropped
  // public.time_credits, so the reconciler no longer reads it at all.

  it("a truncated PAYOUT LEDGER skips its checks instead of inventing criticals", async () => {
    // `paidJobIds` is built from whatever the scan returned, so every
    // `released` job whose transfer row fell outside a short read would be
    // reported as `released_without_payout_transfer` — "money supposedly left,
    // with no record of where", a CRITICAL. A critical that fires because a
    // scan came up short is how an alarm gets muted.
    const fn = await loadConfigured();
    seedCleanLedger();
    scenario.reads.payout_transfers = { ...scenario.reads.payout_transfers, count: 900 };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    const findings = b.findings as Array<{ check: string }>;
    expect(findings.map((f) => f.check)).not.toContain("released_without_payout_transfer");
    expect(findings.map((f) => f.check)).not.toContain("transfer_platform_fee_mismatch");
    expect(String(b.notes)).toContain("payout-ledger checks skipped");
    expect(res.status).toBe(500);
  });

  it("NEVER drops a read error — a failed jobs scan throws rather than reporting clean", async () => {
    const fn = await loadConfigured();
    seedCleanLedger();
    scenario.reads.jobs = { error: { message: "permission denied for table jobs" } };

    const res = await fn.fetch(cronRequest(fn));
    const b = await body(res);

    expect(res.status).toBe(500);
    expect(String(b.error)).toContain("jobs read failed");
    expect(String(b.error)).toContain("permission denied");
  });

  it("performs no writes — it reports, it never repairs", async () => {
    const fn = await loadConfigured();
    seedCleanLedger();
    scenario.reads.payout_transfers = { rows: [] }; // force a critical finding

    await fn.fetch(cronRequest(fn));

    expect(scenario.writes).toHaveLength(0);
  });

  // ── Gift-credit tree ───────────────────────────────────────────────────────
  //
  // This file used to say gift_cards needed no reconciliation because it
  // carries no cached balance, so "asserting on them would be theatre". True
  // while the table was empty; false the moment the feature shipped.
  //
  // The assertion is not a balance. A donation mints children through
  // `parent_credit_id` (redeem_gift_card's leftover, restore_gift_card_for_job's
  // replacement), and when the donation is refunded or charged back every
  // unspent node must be 'refunded' too. A node still reading 'paid' under a
  // 'refunded' ancestor is spendable money conjured out of a reversal — the
  // exact class closed in migration 20260922165121, kept closed here.
  // Q1212: since Q454 a refund returns the gift AFTER the job's terminal flip,
  // and a restore that fails (or is refused) pages once; nothing re-reported
  // it. A redeemed gift on a cancelled/refunded job, with no replacement row,
  // no live payout and no unexecuted decided dispute, is a gift still owed.
  describe("Q1212 a gift left unreturned after its job was refunded", () => {
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    function seedRefundedGiftJob() {
      seedCleanLedger();
      scenario.reads.jobs!.rows![0] = {
        ...scenario.reads.jobs!.rows![0], status: "cancelled", payment_status: "refunded",
        cancelled_at: old, updated_at: old, poster_completed_at: null, helper_completed_at: null,
      };
      scenario.reads.payout_transfers = { rows: [] };
      scenario.reads.gift_cards = {
        rows: [{ id: "gc-1", parent_credit_id: null, payment_status: "paid", status: "redeemed", amount: 100, job_id: "job-1", restored_from_job_id: null }],
      };
    }
    const names = (b: Record<string, unknown>) => (b.findings as Array<{ check: string }>).map((f) => f.check);

    // @mutate supabase/functions/money-reconciliation/index.ts | checks.giftNotReturned.add({ | void ({
    it("flags it", async () => {
      const fn = await loadConfigured();
      seedRefundedGiftJob();
      const b = await body(await fn.fetch(cronRequest(fn)));
      expect(names(b)).toContain("gift_not_returned_after_refund");
    });

    // @mutate supabase/functions/money-reconciliation/index.ts | if (restoredJobIds.has(g.job_id)) continue; |
    it("not when a replacement gift was minted for the job", async () => {
      const fn = await loadConfigured();
      seedRefundedGiftJob();
      scenario.reads.gift_cards!.rows!.push({ id: "gc-2", parent_credit_id: "gc-1", payment_status: "paid", status: "sent", amount: 100, job_id: null, restored_from_job_id: "job-1" });
      const b = await body(await fn.fetch(cronRequest(fn)));
      expect(names(b)).not.toContain("gift_not_returned_after_refund");
    });

    // @mutate supabase/functions/money-reconciliation/index.ts | if (giftPaidJobIds.has(g.job_id)) continue; |
    it("not when a live payout went to the Helpr (that job's gift is spent, not owed)", async () => {
      const fn = await loadConfigured();
      seedRefundedGiftJob();
      scenario.reads.payout_transfers = { rows: [{ job_id: "job-1", helper_id: "helper-1", amount_cents: 8800, platform_fee_cents: 1200, status: "paid", stripe_transfer_id: "tr_1" }] };
      const b = await body(await fn.fetch(cronRequest(fn)));
      expect(names(b)).not.toContain("gift_not_returned_after_refund");
    });

    // @mutate supabase/functions/money-reconciliation/index.ts | if (undecidedSplitJobIds.has(g.job_id)) continue; |
    it("not while a decided dispute on the job has not executed (the split returns it)", async () => {
      const fn = await loadConfigured();
      seedRefundedGiftJob();
      scenario.reads.disputes = { rows: [{ job_id: "job-1", status: "decided", execution_status: null }] };
      const b = await body(await fn.fetch(cronRequest(fn)));
      expect(names(b)).not.toContain("gift_not_returned_after_refund");
    });

    // Review of Q1212 (should-fix): a short gift read (the replacement row
    // past the page cap) must not manufacture this critical; the checks skip
    // and the run is degraded instead.
    // @mutate supabase/functions/money-reconciliation/index.ts | const gifts: GiftRow[] = giftCap ? [] : giftScan.rows; | const gifts: GiftRow[] = giftScan.rows;
    it("a TRUNCATED gift ledger skips the check (degraded), never a false critical", async () => {
      const fn = await loadConfigured();
      seedRefundedGiftJob();
      // The fixture's server count is two (the gift and its replacement) but it hands back one.
      scenario.reads.gift_cards = { ...scenario.reads.gift_cards!, count: 2 };
      const res = await fn.fetch(cronRequest(fn));
      const b = await body(res);
      expect(names(b)).not.toContain("gift_not_returned_after_refund");
      expect((b.notes as string[]).join(" ")).toMatch(/gift-card checks skipped/);
      expect(b.ok).toBe(false);
    });

    it("not inside the settle window (the restore runs right after the flip)", async () => {
      const fn = await loadConfigured();
      seedRefundedGiftJob();
      const now = new Date().toISOString();
      scenario.reads.jobs!.rows![0] = { ...scenario.reads.jobs!.rows![0], cancelled_at: now, updated_at: now };
      const b = await body(await fn.fetch(cronRequest(fn)));
      expect(names(b)).not.toContain("gift_not_returned_after_refund");
    });
  });

  // Review of Q1222/Q1223 (should-fix): money a payout hold kept back is
  // re-driven by process-scheduled-payouts. A row Stripe refused, or one whose
  // Helpr is clear but that is still unpaid a day later, has been dropped and
  // nothing else re-reports it.
  describe("Q1222/Q1223 held money that is not being re-driven", () => {
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const fresh = new Date(Date.now() - 600_000).toISOString();
    const names = (b: Record<string, unknown>) => (b.findings as Array<{ check: string }>).map((f) => f.check);
    // updated_at is FRESH on purpose: the re-drive touches it every hourly
    // attempt, so a check measured from it could never fire (second review).
    const tip = (over: Record<string, unknown> = {}) => ({
      tip_id: "tip-1", helper_id: "helper-1", status: "reversed", amount_cents: 1500, failure_reason: null,
      created_at: old, updated_at: fresh, first_repay_attempt_at: old, ...over,
    });
    const HOLD = { helper_id: "helper-1", reason: "review", held_at: null, denied_at: null };

    // @mutate supabase/functions/money-reconciliation/index.ts | checks.heldMoneyNotRedriven.add({ tip_id: r.tip_id, | void ({ tip_id: r.tip_id,
    it("flags a tip whose re-pay Stripe refused ('failed')", async () => {
      const fn = await loadConfigured();
      seedCleanLedger();
      scenario.reads.tip_hold_redrives = { rows: [tip({ status: "failed", failure_reason: "account closed" })] };
      scenario.reads.payout_holds = { rows: [HOLD] };
      const b = await body(await fn.fetch(cronRequest(fn)));
      expect(names(b)).toContain("held_money_not_redriven");
    });

    // @mutate supabase/functions/money-reconciliation/index.ts | : !holdRead.holds.has(r.helper_id) && stale(r.first_repay_attempt_at)); | : stale(r.first_repay_attempt_at));
    it("not while the Helpr is still on hold (the re-drive is waiting on purpose)", async () => {
      const fn = await loadConfigured();
      seedCleanLedger();
      scenario.reads.tip_hold_redrives = { rows: [tip()] };
      scenario.reads.payout_holds = { rows: [HOLD] };
      const b = await body(await fn.fetch(cronRequest(fn)));
      expect(names(b)).not.toContain("held_money_not_redriven");
    });

    // Second review (S-B): fires although every hourly attempt moved updated_at.
    // @mutate supabase/functions/money-reconciliation/index.ts | : !holdRead.holds.has(r.helper_id) && stale(r.first_repay_attempt_at)); | : !holdRead.holds.has(r.helper_id) && stale((r as { updated_at?: string \| null }).updated_at ?? null));
    it("flags a reversed tip whose Helpr is clear and whose first re-pay attempt was a day ago", async () => {
      const fn = await loadConfigured();
      seedCleanLedger();
      scenario.reads.tip_hold_redrives = { rows: [tip()] };
      const b = await body(await fn.fetch(cronRequest(fn)));
      expect(names(b)).toContain("held_money_not_redriven");
    });

    // @mutate supabase/functions/money-reconciliation/index.ts | return t !== null && t < stuckBefore; }; | return true; };
    it("not when the first attempt was recent, nor before any attempt", async () => {
      const fn = await loadConfigured();
      seedCleanLedger();
      scenario.reads.tip_hold_redrives = {
        rows: [tip({ first_repay_attempt_at: fresh }), tip({ tip_id: "tip-2", first_repay_attempt_at: null })],
      };
      const b = await body(await fn.fetch(cronRequest(fn)));
      expect(names(b)).not.toContain("held_money_not_redriven");
    });

    // @mutate supabase/functions/money-reconciliation/index.ts | ? stale(r.created_at) | ? false
    it("flags an 'owed' tip a day after it was paid (the webhook never finished the pull-back)", async () => {
      const fn = await loadConfigured();
      seedCleanLedger();
      scenario.reads.tip_hold_redrives = { rows: [tip({ status: "owed", first_repay_attempt_at: null })] };
      scenario.reads.payout_holds = { rows: [HOLD] };
      const b = await body(await fn.fetch(cronRequest(fn)));
      expect(names(b)).toContain("held_money_not_redriven");
    });

    // @mutate supabase/functions/money-reconciliation/index.ts | checks.heldMoneyNotRedriven.add({ clawback_id: r.id, | void ({ clawback_id: r.id,
    // @mutate supabase/functions/money-reconciliation/index.ts | if (!stale(r.held_repay_first_attempt_at)) continue; | if (!stale((r as { updated_at?: string \| null }).updated_at ?? null)) continue;
    it("flags a won chargeback's owed re-pay whose Helpr is clear and whose first attempt was a day ago", async () => {
      const fn = await loadConfigured();
      seedCleanLedger();
      scenario.reads.chargeback_clawbacks = {
        rows: [{ id: "cb-1", dispute_id: "dp_1", helper_id: "helper-1", status: "repay_failed", reversed_cents: 9000, failure_reason: "socket hang up", updated_at: fresh, held_repay_owed_at: old, held_repay_first_attempt_at: old }],
      };
      const b = await body(await fn.fetch(cronRequest(fn)));
      expect(names(b)).toContain("held_money_not_redriven");
    });

    it("before the migration is deployed it is a note, never a crash", async () => {
      const fn = await loadConfigured();
      seedCleanLedger();
      scenario.reads.tip_hold_redrives = { error: { message: "relation does not exist", code: "42P01" } };
      const b = await body(await fn.fetch(cronRequest(fn)));
      expect(names(b)).not.toContain("held_money_not_redriven");
      expect((b.notes as string[]).join(" ")).toMatch(/held-money re-drive check skipped for tip_hold_redrives/);
    });
  });

  describe("gift-credit tree", () => {
    it("flags a spendable child under a refunded donation", async () => {
      const fn = await loadConfigured();
      seedCleanLedger();
      scenario.reads.gift_cards = {
        rows: [
          { id: "gc-root", parent_credit_id: null, payment_status: "refunded", status: "redeemed", amount: 75, job_id: "job-1" },
          { id: "gc-child", parent_credit_id: "gc-root", payment_status: "paid", status: "sent", amount: 25, job_id: null },
        ],
      };
      const res = await fn.fetch(cronRequest(fn));
      const b = await body(res);
      const names = (b.findings as Array<{ check: string }>).map((f) => f.check);
      expect(names).toContain("gift_revoked_donation_has_spendable_child");
    });

    it("catches it through a GRANDchild too — the tree is walked, not peeked at", async () => {
      const fn = await loadConfigured();
      seedCleanLedger();
      scenario.reads.gift_cards = {
        rows: [
          { id: "gc-root", parent_credit_id: null, payment_status: "refunded", status: "redeemed", amount: 75, job_id: "job-1" },
          { id: "gc-mid", parent_credit_id: "gc-root", payment_status: "refunded", status: "redeemed", amount: 25, job_id: "job-2" },
          { id: "gc-leaf", parent_credit_id: "gc-mid", payment_status: "paid", status: "sent", amount: 10, job_id: null },
        ],
      };
      const res = await fn.fetch(cronRequest(fn));
      const b = await body(res);
      const names = (b.findings as Array<{ check: string }>).map((f) => f.check);
      expect(names).toContain("gift_revoked_donation_has_spendable_child");
    });

    it("stays quiet on a healthy tree", async () => {
      const fn = await loadConfigured();
      seedCleanLedger();
      scenario.reads.gift_cards = {
        rows: [
          { id: "gc-root", parent_credit_id: null, payment_status: "paid", status: "redeemed", amount: 75, job_id: "job-1" },
          { id: "gc-child", parent_credit_id: "gc-root", payment_status: "paid", status: "sent", amount: 25, job_id: null },
        ],
      };
      const res = await fn.fetch(cronRequest(fn));
      const b = await body(res);
      expect(b.clean).toBe(true);
    });

    it("does not hang on a cyclic parent chain", async () => {
      // parent_credit_id is a self-FK with nothing preventing a loop.
      const fn = await loadConfigured();
      seedCleanLedger();
      scenario.reads.gift_cards = {
        rows: [
          { id: "gc-a", parent_credit_id: "gc-b", payment_status: "paid", status: "sent", amount: 10, job_id: null },
          { id: "gc-b", parent_credit_id: "gc-a", payment_status: "paid", status: "sent", amount: 10, job_id: null },
        ],
      };
      const res = await fn.fetch(cronRequest(fn));
      expect([200, 500]).toContain(res.status);
    });
  });
});

// Proof this guard can fail: null out the jobs-scan truncation verdict and the
// reconciler goes back to reporting a clean 200 over a fifth of the money —
// exactly the unsatisfiable alarm this file was written to replace.
// @mutate supabase/functions/money-reconciliation/index.ts | const jobsCap = scanDefect("jobs", jobScan); | const jobsCap = null;

// @mutate supabase/functions/money-reconciliation/index.ts | if (g.payment_status === "paid" && hasRefundedAncestor(g)) { | if (false) {
