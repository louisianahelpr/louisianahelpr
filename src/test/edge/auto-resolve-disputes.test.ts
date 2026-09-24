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
 *
 * PROVEN ABLE TO FAIL 2026-09-21. The mutation targets defect 3's own blind
 * spot — the "green because it measured nothing" shape. A split row claimed
 * with a NULL `execution_started_at` is MORE alarming than an old one, so the
 * age filter counts it as stuck; flipping that one branch to `return false`
 * silently drops exactly the rows nobody is watching (prod's own stuck split,
 * dispute c7a12050, carries `execution_started_at: null`) and the sweep then
 * answers a cheerful 200 with `stuck_splits: []`. Red: 3 failed, 51 passed.
 */
// @mutate supabase/functions/auto-resolve-disputes/index.ts | if (!startedAt) return true; | if (!startedAt) return false;
// AM-001 (proven red 2026-09-23): the two "leave it for an admin" branches must tell one.
// @mutate supabase/functions/auto-resolve-disputes/index.ts | await remindUnsettleable(job, "no_payment_intent", "it has no Stripe payment on record"); |
// @mutate supabase/functions/auto-resolve-disputes/index.ts | await remindUnsettleable(job, `pi_${pi.status}`, `its Stripe payment is "${pi.status}", not succeeded`); |
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
/** The two reminder titles. Both are part of the dedupe key, not just the link. */
const ESCALATED = "Escalated dispute overdue";
const STUCK = "Dispute split did not settle";
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

  // ── 1b. The filer cannot win by silence ──────────────────────────────────
  //
  // `rpc_open_dispute` authorises EITHER party (verified against prod:
  // `IF _uid <> _customer AND _uid <> _helper THEN RAISE`), and filing freezes
  // the job. This sweep settled every non-escalated expired dispute with
  // `_outcome: "helper"` and wrote `status: "completed"` regardless of who
  // opened it — so a helper could dispute an `in_progress` job, say nothing
  // for 72 hours, and be handed the full escrow on a job the poster never
  // approved. The poster's only defence was to escalate.
  describe("a helper-filed dispute is never auto-paid to the helper", () => {
    /** Same expired dispute, but the HELPER is the one who filed it. */
    const seedHelperFiled = (s: SupabaseScenario) =>
      seedExpiredDispute(s, { disputed_by: "helper-1" });

    it("escalates to an admin instead of releasing the escrow", async () => {
      seedHelperFiled(scenario);
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);

      expect(res.status).toBe(200);
      // The money did NOT move, and the run says so both ways.
      expect(body.resolved).toBe(0);
      expect(body.ids).toEqual([]);
      expect(body.escalated_helper_filed).toBe(1);
      expect(body.escalated_helper_filed_ids).toEqual([JOB_ID]);

      // Exactly one write to `jobs`, and it is the escalation — not a payout.
      const jobWrites = writesTo("jobs");
      expect(jobWrites).toHaveLength(1);
      expect(jobWrites[0].payload).toEqual({ dispute_status: "escalated" });
      // Asserting the ABSENCE of the payout keys is the point of the test: a
      // payload merely "containing" dispute_status would still pass if the
      // release fields came back.
      expect(jobWrites[0].payload).not.toHaveProperty("payment_status");
      expect(jobWrites[0].payload).not.toHaveProperty("status");
      expect(jobWrites[0].payload).not.toHaveProperty("payout_scheduled_at");

      // Same chargeback-race guard the release path uses, plus the row-count
      // check — a null error on a zero-row update must not read as "escalated".
      expect(jobWrites[0].filters).toEqual(
        expect.arrayContaining([{ op: "eq", column: "payment_status", value: "escrow" }]),
      );
      expect(jobWrites[0].selectCols).toBe("id");

      // The record is NOT settled: settle_dispute_record writes payout_split
      // and is terminal, so closing it here would stamp "Helpr 100%" on a
      // dispute no human has decided.
      expect(rpcCalls("settle_dispute_record")).toHaveLength(0);
    });

    it("tells the admins, since nothing else will", async () => {
      seedHelperFiled(scenario);
      const h = await load();
      await h.fetch(cronReq());

      const notified = writesTo("notifications", "insert");
      const rows = notified.flatMap((w) =>
        Array.isArray(w.payload) ? w.payload : [w.payload],
      ) as Record<string, unknown>[];
      const admins = rows.filter((r) => r.title === ESCALATED);
      expect(admins.map((r) => r.user_id).sort()).toEqual([ADMIN_A, ADMIN_B]);
      // The message has to say the escrow was withheld — an admin reading
      // "dispute overdue" would reasonably assume it had already settled.
      expect(String(admins[0].message)).toContain("NOT auto-released");
      // Addressed to admins only, so it must not sit in a party-facing
      // severity bucket (N-011).
      expect(admins[0].type).toBe("admin_alert");
    });

    it("still auto-releases a POSTER-filed dispute — the default is unchanged", async () => {
      // The counterparty's silence is what loses them the dispute. A poster who
      // raised a complaint and then went quiet for 72 hours still forfeits.
      seedExpiredDispute(scenario, { disputed_by: "poster-1" });
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);

      expect(body.resolved).toBe(1);
      expect(body.escalated_helper_filed).toBe(0);
      expect(writesTo("jobs")[0].payload).toMatchObject({
        status: "completed",
        payment_status: "payout_pending",
        dispute_status: "auto_resolved",
      });
      expect(rpcCalls("settle_dispute_record")).toHaveLength(1);
    });

    it("does not escalate a job with no helper on it", async () => {
      // `disputed_by === helper_id` must not match null === null on an
      // ownerless job (account deletion nulls helper_id), which would divert
      // an ordinary poster-filed dispute to an admin forever.
      seedExpiredDispute(scenario, { disputed_by: null, helper_id: null });
      const h = await load();
      const res = await h.fetch(cronReq());
      expect((await json(res)).escalated_helper_filed).toBe(0);
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
        { user_id: ADMIN_A, title: ESCALATED, link: `/admin?view=disputes&job=${JOB_ID}` },
      ]);
      const h = await load();
      await h.fetch(cronReq());

      const payload = writesTo("notifications", "insert")[0].payload as Array<Record<string, unknown>>;
      expect(payload.map((p) => p.user_id)).toEqual([ADMIN_B]);
    });

    it("a reminder of a DIFFERENT kind never suppresses this one", async () => {
      // The two reminder kinds share a job-scoped link, so a key of
      // user|link alone would let the escalation reminder (sent first) swallow
      // the "money may be half-moved" alarm for 24 hours — suppressing the
      // more urgent of the two. `title` is in the key for exactly this.
      seedEscalated(scenario, [
        { user_id: ADMIN_A, title: STUCK, link: `/admin?view=disputes&job=${JOB_ID}` },
        { user_id: ADMIN_B, title: STUCK, link: `/admin?view=disputes&job=${JOB_ID}` },
      ]);
      const h = await load();
      await h.fetch(cronReq());
      const payload = writesTo("notifications", "insert")[0].payload as Array<Record<string, unknown>>;
      expect(payload.map((p) => p.user_id).sort()).toEqual([ADMIN_A, ADMIN_B]);
      expect(payload[0].title).toBe(ESCALATED);
    });

    it("sends nothing at all when every admin was already reminded", async () => {
      seedEscalated(scenario, [
        { user_id: ADMIN_A, title: ESCALATED, link: `/admin?view=disputes&job=${JOB_ID}` },
        { user_id: ADMIN_B, title: ESCALATED, link: `/admin?view=disputes&job=${JOB_ID}` },
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
        Array.from({ length: 500 }, (_, i) => ({ user_id: `admin-${i}`, title: ESCALATED, link: "/x" })),
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
        payment_status: "payout_pending",
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
        payment_status: "escrow",
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

    it("closes a REFUNDED job's record as poster — never as helper", async () => {
      // settle_dispute_record writes payout_split and is terminal. A sweep that
      // assumed "helper" would stamp "poster 0% · Helpr 100%" onto every job an
      // admin had REFUNDED to the poster, permanently, in the surface both
      // parties read to see what was decided.
      seedOrphan(scenario, {
        id: "job-9",
        status: "cancelled",
        payment_status: "refunded",
        dispute_status: "resolved",
        dispute_resolved_at: "2026-08-30T00:00:00Z",
      });
      const h = await load();
      const body = await json(await h.fetch(cronReq()));
      expect(body.dispute_records_swept).toBe(1);
      expect(rpcCalls("settle_dispute_record")[0].args).toMatchObject({
        _job_id: "job-9",
        _outcome: "poster",
      });
    });

    it("refuses to close a record when the job's MONEY state does not say which way it went", async () => {
      // payment_status is the only column here no party can write. Everything
      // else that looks settled is party-writable, so an unsettled payment
      // state means "leave it open", never "guess".
      seedOrphan(scenario, {
        id: "job-9",
        status: "completed",
        payment_status: "escrow",
        dispute_status: "resolved",
        dispute_resolved_at: "2026-08-30T00:00:00Z",
      });
      const h = await load();
      const res = await h.fetch(cronReq());
      expect((await json(res)).dispute_records_swept).toBe(0);
      expect(rpcCalls("settle_dispute_record")).toHaveLength(0);
      expect(res.status).toBe(200);
    });

    it("a party cannot forge a settled-looking job to close their own live dispute", async () => {
      // The denial-of-service this gate exists for. jobs.status and
      // dispute_status are on the assigned helper's allow-list
      // (20260828020000:446,458) and dispute_resolved_at is deliberately absent
      // from locked_everyone (20260826040000:369), so the side LOSING a dispute
      // can PATCH all three. If the sweep trusted them, one request would close
      // their own open dispute as decided + executed — after which
      // rpc_decide_dispute raises "already decided" and execute-dispute-split
      // returns 409, with no recovery short of manual SQL.
      seedOrphan(scenario, {
        id: "job-9",
        status: "completed",          // forged
        payment_status: "escrow",     // NOT forgeable — escrow is still held
        dispute_status: "resolved",   // forged
        dispute_resolved_at: "2026-08-30T00:00:00Z", // forged
      });
      const h = await load();
      await h.fetch(cronReq());
      expect(rpcCalls("settle_dispute_record")).toHaveLength(0);
    });

    it("reports a defect when the sweep's own close fails", async () => {
      seedOrphan(scenario, {
        id: "job-9",
        status: "cancelled",
        payment_status: "refunded",
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
        rows: [{ user_id: ADMIN_A, title: STUCK, link: "/admin?view=disputes&job=job-7" }],
      };
      const h = await load();
      const res = await h.fetch(cronReq());
      expect(writesTo("notifications", "insert")).toHaveLength(0);
      // Still a defect — the money is still half-moved. Only the SPAM stops.
      expect(res.status).toBe(500);
    });

    // Prod 2026-09-14: dispute c7a12050 on is_seed job bb2c3732 was decided with
    // execution_status 'pending' by the seed and never executed. It alone made
    // every run answer 500 ("1 defect") and paged every admin.
    const seedSplit = {
      id: DISPUTE_ID,
      job_id: "seed-job",
      execution_status: "pending",
      execution_started_at: null,
      execution_error: null,
    };

    it("skips a stuck split on an is_seed job: no defect, no admin page, answers 200", async () => {
      seedStuck(scenario, [seedSplit]);
      scenario.reads.jobs!.selectOverrides!.push({
        includes: "is_seed",
        result: { rows: [{ id: "seed-job", is_seed: true }] },
      });
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body.stuck_splits).toEqual([]);
      expect(body.seed_stuck_splits_skipped).toBe(1);
      expect(writesTo("notifications", "insert")).toHaveLength(0);
    });

    it("still pages a real split sitting next to a seed one", async () => {
      seedStuck(scenario, [seedSplit, { ...seedSplit, id: "real-dispute", job_id: "job-7" }]);
      scenario.reads.jobs!.selectOverrides!.push({
        includes: "is_seed",
        result: { rows: [{ id: "seed-job", is_seed: true }, { id: "job-7", is_seed: false }] },
      });
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(res.status).toBe(500);
      expect(body.stuck_splits).toEqual([{ id: "real-dispute", job_id: "job-7", execution_status: "pending" }]);
    });

    it("treats every split as real when the seed flag cannot be read", async () => {
      seedStuck(scenario, [seedSplit]);
      scenario.reads.jobs!.selectOverrides!.push({
        includes: "is_seed",
        result: { error: { message: "boom" } },
      });
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(res.status).toBe(500);
      expect(body.stuck_splits).toHaveLength(1);
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

  // ── 4. The sweep takes the settlement claim ──────────────────────────────
  //
  // The 72h flip to completed/payout_pending was guarded only on
  // `payment_status = 'escrow'`. An admin Quick Refund runs its Stripe refund
  // BEFORE its own guarded flip, and during that window the job still reads
  // disputed/escrow — so the sweep won the flip, the admin's flip matched zero
  // rows, and release-payout paid the Helpr 24h later ON TOP of the refund.
  // The fix is the same claim create-payment and execute-dispute-split take
  // (claim_dispute_settlement, 20260915034822), as action 'sweep'.
  describe("settlement claim", () => {
    const claimCalls = () => rpcCalls("claim_dispute_settlement");
    const releaseCalls = () => rpcCalls("release_dispute_settlement_claim");
    const noSettlement = () => {
      expect(writesTo("jobs")).toHaveLength(0);
      expect(rpcCalls("settle_dispute_record")).toHaveLength(0);
      expect(writesTo("notifications", "insert")).toHaveLength(0);
    };

    it("claims the job as 'sweep' and hands the claim back by token after settling", async () => {
      seedExpiredDispute(scenario);
      scenario.rpc.claim_dispute_settlement = { verdict: "claimed", token: "sweep-token-1" };
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body.resolved).toBe(1);
      expect(claimCalls()).toHaveLength(1);
      expect(claimCalls()[0].args).toEqual({ _job_id: JOB_ID, _action: "sweep", _admin_id: null });
      expect(releaseCalls()).toHaveLength(1);
      expect(releaseCalls()[0].args).toEqual({ _job_id: JOB_ID, _token: "sweep-token-1" });
    });

    it("THE RACE: a Quick Refund in flight holds the claim — the sweep does not flip, close or notify", async () => {
      seedExpiredDispute(scenario);
      scenario.rpc.claim_dispute_settlement = { verdict: "held_by_refund" };
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      noSettlement();
      expect(body.resolved).toBe(0);
      // Not a defect: an admin settling the job is the designed outcome, and
      // the next tick re-reads it.
      expect(res.status).toBe(200);
      expect(body.claim_skipped).toEqual([{ job_id: JOB_ID, verdict: "held_by_refund" }]);
      // It never held the claim, so it releases nothing.
      expect(releaseCalls()).toHaveLength(0);
    });

    it.each(["held_by_release", "held_by_split", "joined"])(
      "skips the job when the claim answers %s",
      async (verdict) => {
        seedExpiredDispute(scenario);
        scenario.rpc.claim_dispute_settlement = { verdict };
        const h = await load();
        const body = await json(await h.fetch(cronReq()));
        noSettlement();
        expect(body.resolved).toBe(0);
        expect(releaseCalls()).toHaveLength(0);
      },
    );

    it("skips a job that is no longer disputed by the time it claims", async () => {
      seedExpiredDispute(scenario);
      scenario.rpc.claim_dispute_settlement = { verdict: "not_disputed" };
      const h = await load();
      const body = await json(await h.fetch(cronReq()));
      noSettlement();
      expect(body.resolved).toBe(0);
    });

    it("fails CLOSED when the claim RPC errors (e.g. not deployed): no flip, and the run reports a defect", async () => {
      seedExpiredDispute(scenario);
      scenario.rpcErrors = { claim_dispute_settlement: { message: "Could not find the function", code: "PGRST202" } };
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      noSettlement();
      expect(res.status).toBe(500);
      expect(String((body.defectReasons as string[])[0])).toMatch(/settlement claim .*PGRST202/);
    });

    it("refuses on a live refund ledger row — the escrow already went to the poster — and releases the claim", async () => {
      seedExpiredDispute(scenario);
      scenario.rpc.claim_dispute_settlement = { verdict: "claimed", token: "sweep-token-2" };
      scenario.reads.payment_refunds = { rows: [{ id: "refund-row-1" }] };
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      noSettlement();
      expect(res.status).toBe(500);
      expect(String((body.defectReasons as string[]).join(" "))).toMatch(/refund ledger/);
      expect(releaseCalls()).toEqual([
        expect.objectContaining({ args: { _job_id: JOB_ID, _token: "sweep-token-2" } }),
      ]);
    });

    it("fails CLOSED when the refund ledger cannot be read, and releases the claim", async () => {
      seedExpiredDispute(scenario);
      scenario.rpc.claim_dispute_settlement = { verdict: "claimed", token: "sweep-token-3" };
      scenario.reads.payment_refunds = { error: { message: "read blew up" } };
      const h = await load();
      const res = await h.fetch(cronReq());
      noSettlement();
      expect(res.status).toBe(500);
      expect(releaseCalls()).toHaveLength(1);
    });

    it("releases the claim even when its own flip matched zero rows", async () => {
      seedExpiredDispute(scenario);
      scenario.rpc.claim_dispute_settlement = { verdict: "claimed", token: "sweep-token-4" };
      scenario.writeSelectRows.jobs = [];
      const h = await load();
      const body = await json(await h.fetch(cronReq()));
      expect(body.resolved).toBe(0);
      expect(releaseCalls()).toHaveLength(1);
    });

    it("never settles over a DEAD holder: a claim won by expiring one (over_expired) skips, pages via defect, and is released", async () => {
      seedExpiredDispute(scenario);
      scenario.rpc.claim_dispute_settlement = { verdict: "claimed", token: "sweep-token-5", over_expired: true };
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      noSettlement();
      expect(res.status).toBe(500);
      expect(String((body.defectReasons as string[]).join(" "))).toMatch(/expired holder/);
      expect(releaseCalls()).toEqual([expect.objectContaining({ args: { _job_id: JOB_ID, _token: "sweep-token-5" } })]);
    });

    it("asks Stripe inside the claim: a refunded charge with NO ledger row still blocks the payout", async () => {
      // recordRefund swallows its own write failure, so an empty ledger is not
      // proof. The charge's amount_refunded is.
      seedExpiredDispute(scenario);
      scenario.rpc.claim_dispute_settlement = { verdict: "claimed", token: "sweep-token-6" };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_1", status: "succeeded", latest_charge: { id: "ch_1", amount_refunded: 9500, disputed: false },
      });
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      noSettlement();
      expect(res.status).toBe(500);
      expect(String((body.defectReasons as string[]).join(" "))).toMatch(/refunded \(9500¢\)/);
      expect(releaseCalls()).toHaveLength(1);
    });

    it("fails CLOSED when the in-claim Stripe check errors", async () => {
      seedExpiredDispute(scenario);
      scenario.rpc.claim_dispute_settlement = { verdict: "claimed", token: "sweep-token-7" };
      stripeMock.paymentIntents.retrieve
        .mockResolvedValueOnce({ id: "pi_1", status: "succeeded" })
        .mockRejectedValueOnce(new Error("stripe down"));
      const h = await load();
      const res = await h.fetch(cronReq());
      noSettlement();
      expect(res.status).toBe(500);
      expect(releaseCalls()).toHaveLength(1);
    });

    it("a failed flip after the claim is a defect, not a log line", async () => {
      seedExpiredDispute(scenario);
      scenario.writeErrors.jobs = { message: "write refused" };
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(res.status).toBe(500);
      expect(String((body.defectReasons as string[]).join(" "))).toMatch(/resolve flip job-1: write refused/);
    });

    const UNSETTLEABLE = "Dispute stuck — escrow cannot auto-settle";
    const unsettleableNotes = () =>
      writesTo("notifications", "insert").flatMap((w) => w.payload as Array<{ title: string }>).filter((n) => n.title === UNSETTLEABLE);

    it.each([
      ["not_settleable", false],
      ["split_pending", false],
      ["stuck_release", true],
    ])("a claim answering %s can never clear by waiting: admins are reminded (defect: %s)", async (verdict, isDefect) => {
      seedExpiredDispute(scenario);
      scenario.rpc.claim_dispute_settlement = { verdict };
      const h = await load();
      const res = await h.fetch(cronReq());
      expect(writesTo("jobs")).toHaveLength(0);
      expect(unsettleableNotes()).toHaveLength(2);
      expect(res.status).toBe(isDefect ? 500 : 200);
    });

    it("a dispute re-opened inside the payout hold (payout_pending) is never claimed or silently re-skipped: admins are told", async () => {
      seedExpiredDispute(scenario, { payment_status: "payout_pending" });
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(claimCalls()).toHaveLength(0);
      expect(writesTo("jobs")).toHaveLength(0);
      expect(unsettleableNotes()).toHaveLength(2);
      expect(body.claim_skipped).toEqual([{ job_id: JOB_ID, verdict: "payment_payout_pending" }]);
    });

    it("a chargeback that was WON (charge.disputed stays true, nothing refunded) does not block the payout forever", async () => {
      seedExpiredDispute(scenario);
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_1", status: "succeeded", latest_charge: { id: "ch_1", amount_refunded: 0, disputed: true },
      });
      const h = await load();
      const body = await json(await h.fetch(cronReq()));
      expect(body.resolved).toBe(1);
    });

    it("a HELPER-filed dispute re-opened inside the payout hold is not skipped silently: admins are told (round 3, M4)", async () => {
      // The helper-filed escalation is pinned to payment_status='escrow', and it
      // ran BEFORE the payout-hold reminder — so a helper-filed
      // disputed/payout_pending job matched zero rows, logged "payment_status
      // changed since read" and was skipped on every tick, forever, with nobody
      // told.
      seedExpiredDispute(scenario, { disputed_by: "helper-1", payment_status: "payout_pending" });
      scenario.writeSelectRows.jobs = [];
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(claimCalls()).toHaveLength(0);
      expect(unsettleableNotes()).toHaveLength(2);
      expect(body.claim_skipped).toEqual([{ job_id: JOB_ID, verdict: "payment_payout_pending" }]);
    });

    it("retries a failed claim release once (round 3, M2)", async () => {
      seedExpiredDispute(scenario);
      scenario.rpc.claim_dispute_settlement = { verdict: "claimed", token: "sweep-token-r" };
      scenario.rpcErrors = { release_dispute_settlement_claim: { message: "connection reset", code: "08006" } };
      const h = await load();
      await h.fetch(cronReq());
      expect(releaseCalls()).toHaveLength(2);
    });

    // ── AM-001: no past-deadline dispute is left in escrow SILENTLY ─────────
    //
    // The "no payment intent" and "PI not succeeded" branches logged a
    // console.error and `continue`d: escrow held, no admin reminder, no defect,
    // the run answered 200. On prod two is_seed disputes sat 10-11 days past
    // their deadline through ~40 ticks with nobody told.
    //
    // The CLASS invariant, over every skip state this sweep has: a dispute the
    // run did not resolve must be (a) a defect, (b) an admin reminder, or (c) a
    // claim_skipped verdict naming ANOTHER actor already moving the money
    // (held_by_* / joined / not_disputed). Anything else is the silent skip.
    const OTHER_ACTOR = /^(held_by_|joined$|not_disputed$)/;
    type Skip = [name: string, setup: () => void];
    const skipStates: Skip[] = [
      ["escalated", () => seedExpiredDispute(scenario, { dispute_status: "escalated" })],
      ["payout_pending", () => seedExpiredDispute(scenario, { payment_status: "payout_pending" })],
      ["helper-filed", () => seedExpiredDispute(scenario, { disputed_by: "helper-1" })],
      ["no PI, no session", () => seedExpiredDispute(scenario, { stripe_payment_intent_id: null, stripe_session_id: null })],
      ["no PI, session without one", () => {
        seedExpiredDispute(scenario, { stripe_payment_intent_id: null });
        stripeMock.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_1", payment_intent: null });
      }],
      ...(["requires_payment_method", "requires_capture", "processing", "canceled"] as const).map(
        (status): Skip => [`PI ${status}`, () => {
          seedExpiredDispute(scenario);
          stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status });
        }],
      ),
      ["PI retrieve throws", () => {
        seedExpiredDispute(scenario);
        stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error("stripe down"));
      }],
      ...["held_by_refund", "held_by_release", "held_by_split", "joined", "not_disputed", "not_settleable", "split_pending", "stuck_release"].map(
        (verdict): Skip => [`claim ${verdict}`, () => {
          seedExpiredDispute(scenario);
          scenario.rpc.claim_dispute_settlement = { verdict };
        }],
      ),
      ["claim rpc error", () => {
        seedExpiredDispute(scenario);
        scenario.rpcErrors = { claim_dispute_settlement: { message: "x", code: "PGRST202" } };
      }],
      ["refund ledger row", () => {
        seedExpiredDispute(scenario);
        scenario.rpc.claim_dispute_settlement = { verdict: "claimed", token: "t" };
        scenario.reads.payment_refunds = { rows: [{ id: "r1" }] };
      }],
    ];

    it("inventories the skip states (floor)", () => {
      expect(skipStates.length).toBeGreaterThan(18);
    });

    it.each(skipStates)("skip state '%s' is never silent", async (_name, setup) => {
      setup();
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      if (body.resolved === 1) return;
      const defect = res.status !== 200;
      const told = writesTo("notifications", "insert").length > 0;
      const otherActor = ((body.claim_skipped ?? []) as Array<{ verdict: string }>).some((s) =>
        OTHER_ACTOR.test(s.verdict),
      );
      expect({ defect, told, otherActor }).not.toEqual({ defect: false, told: false, otherActor: false });
    });

    it.each([
      ["no payment intent", { stripe_payment_intent_id: null, stripe_session_id: null }, null, "no_payment_intent"],
      ["PI not succeeded", {}, "requires_payment_method", "pi_requires_payment_method"],
    ] as const)("%s: admins get the unsettleable reminder and the run reports it", async (_n, overrides, piStatus, verdict) => {
      seedExpiredDispute(scenario, overrides);
      if (piStatus) stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: piStatus });
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(claimCalls()).toHaveLength(0);
      expect(writesTo("jobs")).toHaveLength(0);
      const notes = unsettleableNotes() as Array<{ title: string; user_id?: string; link?: string; message?: string }>;
      expect(notes.map((n) => n.user_id).sort()).toEqual([ADMIN_A, ADMIN_B]);
      expect(notes[0].link).toBe(`/admin?view=disputes&job=${JOB_ID}`);
      expect(String(notes[0].message)).toContain("escrow is still held");
      expect(body.claim_skipped).toEqual([{ job_id: JOB_ID, verdict }]);
      // Left for a person by design — not a defect, so no 500 every tick.
      expect(res.status).toBe(200);
    });

    it("never claims a helper-filed dispute it only escalates (no money step)", async () => {
      seedExpiredDispute(scenario, { disputed_by: "helper-1" });
      const h = await load();
      await h.fetch(cronReq());
      expect(claimCalls()).toHaveLength(0);
    });
  });
});
