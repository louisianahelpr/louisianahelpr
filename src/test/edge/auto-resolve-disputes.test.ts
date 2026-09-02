/**
 * Unit tests for the `auto-resolve-disputes` Supabase edge function.
 *
 * This cron decides who keeps the escrow when a dispute goes unanswered, so it
 * is a money path with no user in the loop. Three defects it used to carry, all
 * pinned here:
 *
 *  1. IT NEVER WROTE `public.disputes`. It flipped the JOB to completed /
 *     payout_pending / dispute_status='auto_resolved' and left the dispute
 *     RECORD `status='open'` forever. Because `disputes_one_open_per_job_idx`
 *     (20260901032007) allows exactly one open dispute per job, that stale row
 *     became the only dispute the job could ever have — and
 *     `rpc_open_dispute`'s existing-dispute branch re-freezes a settled job off
 *     the back of it.
 *
 *  2. THE ESCALATED REMINDER HAD NO DEDUPE. One overdue escalated dispute
 *     notified every admin on every tick. Verified in production 2026-09-01:
 *     168 "Escalated dispute overdue" rows for ONE seed job across 13 admins,
 *     growing 52/day since 2026-08-29 (cron: every 6 hours).
 *
 *  3. NOTHING SWEPT `execution_status IN ('executing','failed')`. A dispute
 *     split that transferred the helper's leg and then failed the poster's
 *     refund sat half-settled with no reader anywhere in the repo — including
 *     the partial index 20260824230000 created for exactly that question.
 *
 * Runs the REAL function source via the edge harness.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock, type SupabaseScenario } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-xyz";
const JOB_ID = "job-1";
const DISPUTE_ID = "dispute-1";
const ADMIN_A = "admin-a";
const ADMIN_B = "admin-b";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
  });
  return loadEdgeFunction("auto-resolve-disputes");
}

const cronReq = () =>
  new Request("https://x/functions/v1/auto-resolve-disputes", {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });

async function json(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

/** The expired-dispute read: `.select(... dispute_deadline ...)` on `jobs`. */
function expiredJobsRead(rows: Record<string, unknown>[]) {
  return { includes: "dispute_deadline", result: { rows } };
}

/** The orphan sweep's job read: `.select("id, status, dispute_status, dispute_resolved_at")`. */
function sweepJobsRead(rows: Record<string, unknown>[]) {
  return { includes: "dispute_resolved_at", result: { rows } };
}

/**
 * `disputes` is read twice. The stuck-split read asks for `execution_status`,
 * the orphan read only for `id, job_id` — and "id, job_id" is a PREFIX of the
 * stuck read's column list, so the execution_status override MUST come first or
 * `find()` hands the stuck read the orphan rows.
 */
function disputesReads(
  stuck: Record<string, unknown>[],
  orphans: Record<string, unknown>[],
) {
  return [
    { includes: "execution_status", result: { rows: stuck } },
    { includes: "job_id", result: { rows: orphans } },
  ];
}

/** One dispute past its 72h deadline, funded, ready to auto-resolve. */
function seedExpiredDispute(s: SupabaseScenario, jobOverrides: Record<string, unknown> = {}) {
  s.reads.jobs = {
    selectOverrides: [
      expiredJobsRead([
        {
          id: JOB_ID,
          title: "Replace the ceiling fan in the den",
          helper_id: "helper-1",
          customer_id: "poster-1",
          budget: 150,
          dispute_reason: "Fan wobbles",
          disputed_at: "2026-08-21T15:30:00Z",
          dispute_deadline: "2026-08-24T15:30:00Z",
          dispute_status: "open",
          payment_status: "escrow",
          stripe_payment_intent_id: "pi_1",
          stripe_session_id: "cs_1",
          ...jobOverrides,
        },
      ]),
      sweepJobsRead([]),
    ],
  };
  s.reads.user_roles = { rows: [{ user_id: ADMIN_A }, { user_id: ADMIN_B }] };
  s.reads.notifications = { rows: [] };
  s.reads.disputes = { selectOverrides: disputesReads([], []) };
  s.writeSelectRows.jobs = [{ id: JOB_ID }];
  s.writeSelectRows.notifications = [{ id: "n1" }];
  s.rpc.settle_dispute_record = DISPUTE_ID;
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" });
}

const writesTo = (table: string, op = "update") =>
  scenario.writes.filter((w) => w.table === table && w.op === op);
const rpcCalls = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);

describe("auto-resolve-disputes", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  it("rejects a caller with neither the cron secret nor the service key", async () => {
    const h = await load();
    const res = await h.fetch(
      new Request("https://x/functions/v1/auto-resolve-disputes", {
        method: "POST",
        headers: { Authorization: "Bearer not-the-secret" },
      }),
    );
    expect(res.status).toBe(401);
  });

  // ── 1. The dispute RECORD transitions, not just the job ──────────────────
  describe("closes the dispute record", () => {
    it("settles the job AND closes public.disputes in the same run", async () => {
      seedExpiredDispute(scenario);
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);

      expect(res.status).toBe(200);
      expect(body.resolved).toBe(1);
      expect(body.ids).toEqual([JOB_ID]);

      // BEFORE: the job write is the one that was already there.
      const jobUpdate = writesTo("jobs")[0];
      expect(jobUpdate.payload).toMatchObject({
        status: "completed",
        payment_status: "payout_pending",
        dispute_status: "auto_resolved",
      });
      // Optimistic-concurrency guard against a chargeback race — not regressed.
      expect(jobUpdate.filters).toEqual(
        expect.arrayContaining([{ op: "eq", column: "payment_status", value: "escrow" }]),
      );
      expect(jobUpdate.selectCols).toBe("id");

      // AFTER: the record is closed through the single writer.
      const settle = rpcCalls("settle_dispute_record");
      expect(settle).toHaveLength(1);
      expect(settle[0].args).toMatchObject({
        _job_id: JOB_ID,
        _outcome: "helper",
        _decided_by: null,
      });
      expect(String((settle[0].args as Record<string, unknown>)._decision_text)).toContain(
        "72-hour deadline",
      );
    });

    it("never fabricates a settled amount it does not know", async () => {
      // The transfer happens later in release-payout, so this cron has no
      // transfer id and no cents. A 0 written into a money column is a claim,
      // and the wrong one.
      seedExpiredDispute(scenario);
      const h = await load();
      await h.fetch(cronReq());
      expect(rpcCalls("settle_dispute_record")[0].args).toMatchObject({
        _helper_cents: null,
        _refund_cents: null,
        _transfer_id: null,
        _refund_id: null,
      });
    });

    it("does NOT close the record when the job claim lost the race", async () => {
      // A chargeback webhook flipped payment_status between the read and the
      // write, so the conditional update matched zero rows. Nothing was
      // settled, so nothing may be closed.
      seedExpiredDispute(scenario);
      scenario.writeSelectRows.jobs = [];
      const h = await load();
      const body = await json(await h.fetch(cronReq()));
      expect(body.resolved).toBe(0);
      expect(rpcCalls("settle_dispute_record")).toHaveLength(0);
    });

    it("does NOT close the record when the escrow charge never succeeded", async () => {
      seedExpiredDispute(scenario);
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "requires_payment_method" });
      const h = await load();
      const body = await json(await h.fetch(cronReq()));
      expect(body.resolved).toBe(0);
      expect(writesTo("jobs")).toHaveLength(0);
      expect(rpcCalls("settle_dispute_record")).toHaveLength(0);
    });

    it("reports a defect — never a silent pass — when the record close fails", async () => {
      seedExpiredDispute(scenario);
      scenario.rpcErrors = { settle_dispute_record: { message: "boom", code: "PGRST202" } };
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      // The job IS settled (money is correct); the record is not, and the run
      // says so out loud rather than answering 200.
      expect(body.resolved).toBe(1);
      expect(res.status).toBe(500);
      expect(body.defects).toBe(1);
      expect(String((body.defectReasons as string[])[0])).toContain("settle dispute record");
    });

    it("an escalated dispute is never auto-resolved and never closed", async () => {
      seedExpiredDispute(scenario, { dispute_status: "escalated" });
      const h = await load();
      const body = await json(await h.fetch(cronReq()));
      expect(body.resolved).toBe(0);
      expect(writesTo("jobs")).toHaveLength(0);
      expect(rpcCalls("settle_dispute_record")).toHaveLength(0);
    });
  });

  // ── 2. Reminder dedupe ───────────────────────────────────────────────────
  describe("escalated-dispute reminders", () => {
    function seedEscalated(s: SupabaseScenario, alreadySent: Record<string, unknown>[] = []) {
      seedExpiredDispute(s, { dispute_status: "escalated" });
      s.reads.notifications = { rows: alreadySent };
    }

    it("notifies every admin once, on a job-scoped link", async () => {
      seedEscalated(scenario);
      const h = await load();
      await h.fetch(cronReq());

      const inserts = writesTo("notifications", "insert");
      expect(inserts).toHaveLength(1);
      const payload = inserts[0].payload as Array<Record<string, unknown>>;
      expect(payload.map((p) => p.user_id).sort()).toEqual([ADMIN_A, ADMIN_B]);
      // Job-scoped: two overdue escalations must still produce two reminders,
      // and `?view=` is the only param Admin.tsx reads.
      expect(payload[0].link).toBe(`/admin?view=disputes&job=${JOB_ID}`);
      expect(payload[0].title).toBe("Escalated dispute overdue");
      // A null error on a policy-refused insert reads as success without this.
      expect(inserts[0].selectCols).toBe("id");
    });

    it("does NOT re-notify an admin already reminded about that job today", async () => {
      seedEscalated(scenario, [
        { user_id: ADMIN_A, link: `/admin?view=disputes&job=${JOB_ID}` },
      ]);
      const h = await load();
      await h.fetch(cronReq());

      const payload = writesTo("notifications", "insert")[0].payload as Array<Record<string, unknown>>;
      expect(payload.map((p) => p.user_id)).toEqual([ADMIN_B]);
    });

    it("sends nothing at all when every admin was already reminded", async () => {
      seedEscalated(scenario, [
        { user_id: ADMIN_A, link: `/admin?view=disputes&job=${JOB_ID}` },
        { user_id: ADMIN_B, link: `/admin?view=disputes&job=${JOB_ID}` },
      ]);
      const h = await load();
      const res = await h.fetch(cronReq());
      expect(writesTo("notifications", "insert")).toHaveLength(0);
      // Suppressing a duplicate is the DESIGNED outcome, not a defect.
      expect(res.status).toBe(200);
    });

    it("fails closed — suppresses reminders and records a defect — when it cannot tell what was sent", async () => {
      seedEscalated(scenario);
      scenario.reads.notifications = { error: { message: "read failed" } };
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(writesTo("notifications", "insert")).toHaveLength(0);
      expect(res.status).toBe(500);
      expect(String((body.defectReasons as string[]).join(" "))).toContain("recent reminder read");
    });

    it("treats a TRUNCATED dedupe read like a failed one — suppresses and reports", async () => {
      // A capped read looks like a complete answer, and its missing rows read
      // as "never reminded" — which is exactly how the flood restarts.
      seedEscalated(
        scenario,
        Array.from({ length: 500 }, (_, i) => ({ user_id: `admin-${i}`, link: "/x" })),
      );
      const h = await load();
      const res = await h.fetch(cronReq());
      expect(writesTo("notifications", "insert")).toHaveLength(0);
      expect(res.status).toBe(500);
      expect(String(((await json(res)).defectReasons as string[]).join(" "))).toContain(
        "dedupe set is incomplete",
      );
    });

    it("records a defect when the reminder insert itself is refused", async () => {
      seedEscalated(scenario);
      scenario.writeErrors.notifications = { message: "RLS denied" };
      const h = await load();
      const res = await h.fetch(cronReq());
      expect(res.status).toBe(500);
      expect(String(((await json(res)).defectReasons as string[]).join(" "))).toContain(
        "escalation reminder",
      );
    });

    it("records a defect when the reminder insert matches zero rows", async () => {
      seedEscalated(scenario);
      scenario.writeSelectRows.notifications = [];
      const h = await load();
      const res = await h.fetch(cronReq());
      expect(res.status).toBe(500);
      expect(String(((await json(res)).defectReasons as string[]).join(" "))).toContain(
        "0 rows",
      );
    });
  });

  // ── 3. Sweeps ────────────────────────────────────────────────────────────
  describe("orphaned dispute-record sweep", () => {
    function seedOrphan(s: SupabaseScenario, job: Record<string, unknown>) {
      s.reads.jobs = { selectOverrides: [expiredJobsRead([]), sweepJobsRead([job])] };
      s.reads.user_roles = { rows: [{ user_id: ADMIN_A }] };
      s.reads.notifications = { rows: [] };
      s.reads.disputes = {
        selectOverrides: disputesReads([], [{ id: DISPUTE_ID, job_id: "job-9" }]),
      };
      s.rpc.settle_dispute_record = DISPUTE_ID;
    }

    it("closes a record left open on a job whose dispute is already settled", async () => {
      seedOrphan(scenario, {
        id: "job-9",
        status: "completed",
        dispute_status: "auto_resolved",
        dispute_resolved_at: "2026-08-30T00:00:00Z",
      });
      const h = await load();
      const body = await json(await h.fetch(cronReq()));
      expect(body.dispute_records_swept).toBe(1);
      expect(body.swept_dispute_ids).toEqual([DISPUTE_ID]);
      expect(rpcCalls("settle_dispute_record")[0].args).toMatchObject({ _job_id: "job-9" });
    });

    it("leaves a record alone while its job is still genuinely disputed", async () => {
      seedOrphan(scenario, {
        id: "job-9",
        status: "disputed",
        dispute_status: "open",
        dispute_resolved_at: null,
      });
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(body.dispute_records_swept).toBe(0);
      expect(rpcCalls("settle_dispute_record")).toHaveLength(0);
      expect(res.status).toBe(200);
    });

    it("reports a defect when the sweep's own close fails", async () => {
      seedOrphan(scenario, {
        id: "job-9",
        status: "cancelled",
        dispute_status: "resolved",
        dispute_resolved_at: "2026-08-30T00:00:00Z",
      });
      scenario.rpcErrors = { settle_dispute_record: { message: "nope" } };
      const h = await load();
      const res = await h.fetch(cronReq());
      expect(res.status).toBe(500);
      expect((await json(res)).dispute_records_swept).toBe(0);
    });
  });

  describe("stuck dispute-split sweep", () => {
    function seedStuck(s: SupabaseScenario, rows: Record<string, unknown>[]) {
      s.reads.jobs = { selectOverrides: [expiredJobsRead([]), sweepJobsRead([])] };
      s.reads.user_roles = { rows: [{ user_id: ADMIN_A }] };
      s.reads.notifications = { rows: [] };
      s.reads.disputes = { selectOverrides: disputesReads(rows, []) };
      s.writeSelectRows.notifications = [{ id: "n1" }];
    }

    it("raises the alarm twice — a defect AND a deduped admin notification", async () => {
      seedStuck(scenario, [
        {
          id: DISPUTE_ID,
          job_id: "job-7",
          execution_status: "failed",
          execution_started_at: "2026-08-30T10:00:00Z",
          execution_error: "transfer sent, refund rejected",
        },
      ]);
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);

      // Half-moved money must page every tick until a human clears it.
      expect(res.status).toBe(500);
      expect(body.stuck_splits).toEqual([
        { id: DISPUTE_ID, job_id: "job-7", execution_status: "failed" },
      ]);
      const reason = (body.defectReasons as string[]).join(" ");
      expect(reason).toContain("stuck dispute split");
      expect(reason).toContain("transfer sent, refund rejected");

      const payload = writesTo("notifications", "insert")[0].payload as Array<Record<string, unknown>>;
      expect(payload[0].title).toBe("Dispute split did not settle");
      expect(payload[0].link).toBe("/admin?view=disputes&job=job-7");
    });

    it("never auto-retries the split — moving half-settled money needs a person", async () => {
      seedStuck(scenario, [
        {
          id: DISPUTE_ID,
          job_id: "job-7",
          execution_status: "executing",
          execution_started_at: "2026-08-30T10:00:00Z",
          execution_error: null,
        },
      ]);
      const h = await load();
      await h.fetch(cronReq());
      // No claim, no state change, no Stripe call of any kind.
      expect(writesTo("disputes")).toHaveLength(0);
      expect(rpcCalls("settle_dispute_record")).toHaveLength(0);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("does not re-notify an admin already told about that split today", async () => {
      seedStuck(scenario, [
        {
          id: DISPUTE_ID,
          job_id: "job-7",
          execution_status: "failed",
          execution_started_at: "2026-08-30T10:00:00Z",
          execution_error: null,
        },
      ]);
      scenario.reads.notifications = {
        rows: [{ user_id: ADMIN_A, link: "/admin?view=disputes&job=job-7" }],
      };
      const h = await load();
      const res = await h.fetch(cronReq());
      expect(writesTo("notifications", "insert")).toHaveLength(0);
      // Still a defect — the money is still half-moved. Only the SPAM stops.
      expect(res.status).toBe(500);
    });

    it("a clean run reports zero stuck splits and answers 200", async () => {
      seedStuck(scenario, []);
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body.stuck_splits).toEqual([]);
      expect(body.dispute_records_swept).toBe(0);
    });
  });
});
