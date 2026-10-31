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
// Q2362 (owner #3565, 2026-10-25): an expired dispute is HELD for Helpr support,
// never auto-paid to the Helpr, whoever filed it. Each line breaks one part of
// that and the suite goes red. (AM-001's two "no PI / PI not succeeded"
// registrations went with the Stripe reads they pinned: the sweep no longer
// reads Stripe at all.)
// @mutate supabase/functions/auto-resolve-disputes/index.ts |         .update({ dispute_status: "escalated" }) |         .update({ status: "completed", payment_status: "payout_pending", dispute_status: "auto_resolved" })
// @mutate supabase/functions/auto-resolve-disputes/index.ts |         .eq("payment_status", "escrow")\n        .lte("dispute_deadline", new Date().toISOString()); |         .lte("dispute_deadline", new Date().toISOString());
// @mutate supabase/functions/auto-resolve-disputes/index.ts |       escalatedAtDeadline.push(job.id); |
// @mutate supabase/functions/auto-resolve-disputes/index.ts |             title: "Dispute sent to Helpr support", |             title: "Dispute auto-resolved",
// @mutate supabase/functions/auto-resolve-disputes/index.ts |       if (!escalatedRows \|\| escalatedRows.length === 0) { |       if (!escalatedRows) {
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

  // ── 1. Q2362: nobody wins by silence; the escrow waits for support ─────
  //
  // Until Q2362 a POSTER-filed dispute nobody settled or escalated within 72h
  // was settled for the Helpr here (completed, payout_pending, auto_resolved,
  // record closed "helper"). Owner 2026-10-25 (#3565, option 1): it stays HELD
  // until Helpr support decides. The sweep escalates it and moves no money.
  describe("Q2362: an expired dispute is held for Helpr support, never paid out", () => {
    const inserted = () =>
      writesTo("notifications", "insert").flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload])) as Record<string, unknown>[];

    it("escalates a POSTER-filed expired dispute: no payout, no claim, no Stripe call, no record close", async () => {
      seedExpiredDispute(scenario, { disputed_by: "poster-1" });
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);

      expect(res.status).toBe(200);
      expect(body.resolved).toBe(0);
      expect(body.escalated_at_deadline).toBe(1);
      expect(body.escalated_at_deadline_ids).toEqual([JOB_ID]);
      expect(body.escalated_helper_filed).toBe(0);

      const jobWrites = writesTo("jobs");
      expect(jobWrites).toHaveLength(1);
      // EXACTLY the escalation: a payload that merely contained it would pass
      // with the payout keys back.
      expect(jobWrites[0].payload).toEqual({ dispute_status: "escalated" });
      expect(jobWrites[0].filters).toEqual(
        expect.arrayContaining([
          { op: "eq", column: "id", value: JOB_ID },
          { op: "eq", column: "status", value: "disputed" },
          { op: "eq", column: "payment_status", value: "escrow" },
          { op: "eq", column: "dispute_status", value: "open" },
        ]),
      );
      expect(jobWrites[0].selectCols).toBe("id");

      expect(rpcCalls("settle_dispute_record")).toHaveLength(0);
      expect(rpcCalls("claim_dispute_settlement")).toHaveLength(0);
      expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
      expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("a dispute with no filer recorded is held the same way", async () => {
      seedExpiredDispute(scenario, { disputed_by: null });
      const h = await load();
      const body = await json(await h.fetch(cronReq()));
      expect(body.escalated_at_deadline).toBe(1);
      expect(writesTo("jobs")[0].payload).toEqual({ dispute_status: "escalated" });
    });

    it("tells every admin (the money is held) and both parties (support decides)", async () => {
      seedExpiredDispute(scenario, { disputed_by: "poster-1" });
      const h = await load();
      await h.fetch(cronReq());
      const rows = inserted();
      const admins = rows.filter((r) => r.title === ESCALATED);
      expect(admins.map((r) => r.user_id).sort()).toEqual([ADMIN_A, ADMIN_B]);
      expect(String(admins[0].message)).toContain("disputed by the person who posted it");
      expect(String(admins[0].message)).toContain("NOT released");
      expect(admins[0].type).toBe("admin_alert");
      expect(admins[0].link).toBe(`/admin?view=disputes&job=${JOB_ID}`);

      const parties = rows.filter((r) => r.title === "Dispute sent to Helpr support");
      expect(parties.map((r) => r.user_id).sort()).toEqual(["helper-1", "poster-1"]);
      for (const p of parties) {
        expect(String(p.message)).toContain("Helpr support will decide");
        expect(String(p.message)).toContain("stays on hold");
        expect(String(p.message)).not.toMatch(/released to/i);
      }
      expect(parties.find((r) => r.user_id === "poster-1")?.link).toBe(`/posts?job=${JOB_ID}`);
      expect(parties.find((r) => r.user_id === "helper-1")?.link).toBe(`/jobs?job=${JOB_ID}`);
      // Nobody is told the dispute was "auto-resolved" any more.
      expect(rows.filter((r) => r.title === "Dispute auto-resolved")).toHaveLength(0);
    });

    it("leaves a job alone when its state changed since the read (zero rows): nobody is told it was escalated", async () => {
      seedExpiredDispute(scenario, { disputed_by: "poster-1" });
      scenario.writeSelectRows.jobs = [];
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(res.status).toBe(200);
      expect(body.escalated_at_deadline).toBe(0);
      expect(inserted()).toHaveLength(0);
    });

    it("a failed escalation write is a defect (500), and still moves no money", async () => {
      seedExpiredDispute(scenario, { disputed_by: "poster-1" });
      scenario.writeErrors = { jobs: { message: "boom" } };
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(res.status).toBe(500);
      expect((body.defectReasons as string[]).join(" ")).toMatch(/escalate expired dispute job-1: boom/);
      expect(body.escalated_at_deadline).toBe(0);
      expect(rpcCalls("settle_dispute_record")).toHaveLength(0);
    });

    it("a party notice that cannot be written is a defect, not a silent pass", async () => {
      seedExpiredDispute(scenario, { disputed_by: "poster-1" });
      scenario.writeErrors = { notifications: { message: "refused" } };
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(res.status).toBe(500);
      expect((body.defectReasons as string[]).join(" ")).toMatch(/expired-dispute party notice job-1: refused/);
    });

    it("an escalated dispute is never touched again (only the daily admin reminder)", async () => {
      seedExpiredDispute(scenario, { dispute_status: "escalated" });
      const h = await load();
      const body = await json(await h.fetch(cronReq()));
      expect(body.resolved).toBe(0);
      expect(body.escalated_at_deadline).toBe(0);
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
      expect(body.escalated_at_deadline_ids).toEqual([JOB_ID]);
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
      expect(String(admins[0].message)).toContain("disputed by the Helpr");
      expect(String(admins[0].message)).toContain("NOT released");
      // Addressed to admins only, so it must not sit in a party-facing
      // severity bucket (N-011).
      expect(admins[0].type).toBe("admin_alert");
    });

    it("a POSTER-filed dispute is held too, counted apart from the Helpr-filed ones (Q2362)", async () => {
      seedExpiredDispute(scenario, { disputed_by: "poster-1" });
      const h = await load();
      const body = await json(await h.fetch(cronReq()));
      expect(body.resolved).toBe(0);
      expect(body.escalated_helper_filed).toBe(0);
      expect(body.escalated_at_deadline).toBe(1);
      expect(writesTo("jobs")[0].payload).toEqual({ dispute_status: "escalated" });
      expect(rpcCalls("settle_dispute_record")).toHaveLength(0);
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

    // docs/OPEN.md Q728: a crew has no helper_id (Q407), so `disputed_by ===
    // helper_id` never matched a crew member's filing and one member's silence
    // auto-released the whole crew's pay.
    // @mutate supabase/functions/auto-resolve-disputes/index.ts | (job.is_group_job === true && job.disputed_by !== job.customer_id) | false
    it("a CREW MEMBER's dispute counts as the Helpr side's; the poster's on a crew is held as the poster's", async () => {
      seedExpiredDispute(scenario, { helper_id: null, is_group_job: true, disputed_by: "crew-member-2" });
      let h = await load();
      let body = await json(await h.fetch(cronReq()));
      expect(body.escalated_helper_filed).toBe(1);
      expect(body.resolved).toBe(0);
      expect(writesTo("jobs")[0].payload).toEqual({ dispute_status: "escalated" });

      resetSupabaseMock();
      resetStripeMock();
      resetSharedMocks();
      seedExpiredDispute(scenario, { helper_id: null, is_group_job: true, disputed_by: "poster-1" });
      h = await load();
      body = await json(await h.fetch(cronReq()));
      expect(body.escalated_helper_filed).toBe(0);
      expect(body.escalated_at_deadline).toBe(1);
      expect(body.resolved).toBe(0);
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

    // Q764 (lh-money-escrow review): execute-dispute-split refuses a held
    // Helpr's split before any leg moves and records PAYOUT_HOLD_SPLIT_ERROR.
    // That split waits on purpose; it must not page every tick while the hold
    // stands. Any OTHER failure still pages, and an unreadable hold exempts
    // nothing.
    // @mutate supabase/functions/auto-resolve-disputes/index.ts |                 stuck = stuck.filter((row) => !heldIds.has(row.id as string)); |                 void heldIds;
    // @mutate supabase/functions/auto-resolve-disputes/index.ts |               (row.execution_error as string).startsWith(PAYOUT_HOLD_SPLIT_ERROR) && |               true &&
    // @mutate supabase/functions/auto-resolve-disputes/index.ts |                 defects.record(`stuck split payout-hold read: ${holds.message}`); |                 stuck = []; void holds;
    describe("a split a payout hold is keeping back (Q764)", () => {
      const heldSplit = {
        id: DISPUTE_ID,
        job_id: "job-7",
        execution_status: "failed",
        execution_started_at: "2026-08-30T10:00:00Z",
        execution_error: "the Helpr's payouts are on hold",
      };
      const withHelper = () =>
        scenario.reads.jobs!.selectOverrides!.push({
          includes: "is_seed",
          result: { rows: [{ id: "job-7", is_seed: false, helper_id: "helper-7" }] },
        });

      it("is set aside while the Helpr is held: no defect, no admin page, answers 200", async () => {
        seedStuck(scenario, [heldSplit]);
        withHelper();
        scenario.reads.payout_holds = { rows: [{ helper_id: "helper-7", reason: "review", held_at: null, denied_at: null }] };
        const res = await (await load()).fetch(cronReq());
        const body = await json(res);
        expect(res.status).toBe(200);
        expect(body.stuck_splits).toEqual([]);
        expect(body.held_stuck_splits).toEqual([{ id: DISPUTE_ID, job_id: "job-7" }]);
        expect(writesTo("notifications", "insert")).toHaveLength(0);
      });

      it("pages again once the hold is released", async () => {
        seedStuck(scenario, [heldSplit]);
        withHelper();
        scenario.reads.payout_holds = { rows: [] };
        const res = await (await load()).fetch(cronReq());
        expect(res.status).toBe(500);
        expect((await json(res)).stuck_splits).toHaveLength(1);
      });

      it("a DIFFERENT failure on a held Helpr's split still pages", async () => {
        seedStuck(scenario, [{ ...heldSplit, execution_error: "transfer sent, refund rejected" }]);
        withHelper();
        scenario.reads.payout_holds = { rows: [{ helper_id: "helper-7", reason: "review", held_at: null, denied_at: null }] };
        const res = await (await load()).fetch(cronReq());
        expect(res.status).toBe(500);
        expect((await json(res)).stuck_splits).toHaveLength(1);
      });

      it("FAILS CLOSED: an unreadable hold exempts nothing", async () => {
        seedStuck(scenario, [heldSplit]);
        withHelper();
        scenario.reads.payout_holds = { error: { message: "connection reset", code: "08006" } };
        const res = await (await load()).fetch(cronReq());
        const body = await json(res);
        expect(res.status).toBe(500);
        expect(body.stuck_splits).toHaveLength(1);
        expect((body.defectReasons as string[]).join(" ")).toContain("payout-hold read");
      });
    });

    // Owner 2026-10-30: a split waiting on the Helpr's ID records the payout-hold error with NO
    // payout_holds row. It waits on purpose (nothing moved), so it never pages while the ID is outstanding.
    // @mutate supabase/functions/auto-resolve-disputes/index.ts |                   if (idWaiting.get(helper)) idHeldIds.add(row.id as string); |                   void helper;
    describe("a split waiting on the Helpr's ID", () => {
      const idSplit = {
        id: DISPUTE_ID,
        job_id: "job-7",
        execution_status: "failed",
        execution_started_at: "2026-08-30T10:00:00Z",
        execution_error: "the Helpr's payouts are on hold",
      };
      const withHelper = () => {
        scenario.reads.jobs!.selectOverrides!.push({
          includes: "is_seed",
          result: { rows: [{ id: "job-7", is_seed: false, helper_id: "helper-7" }] },
        });
        scenario.reads.payout_holds = { rows: [] };
      };

      it("is set aside while the ID is outstanding: no defect, no admin page, answers 200", async () => {
        seedStuck(scenario, [idSplit]);
        withHelper();
        scenario.rpc.payout_waits_on_identity = true;
        const res = await (await load()).fetch(cronReq());
        const body = await json(res);
        expect(res.status).toBe(200);
        expect(body.stuck_splits).toEqual([]);
        expect(body.held_stuck_splits).toEqual([{ id: DISPUTE_ID, job_id: "job-7" }]);
        expect(writesTo("notifications", "insert")).toHaveLength(0);
      });

      it("pages once the Helpr has verified", async () => {
        seedStuck(scenario, [idSplit]);
        withHelper();
        scenario.rpc.payout_waits_on_identity = false;
        const res = await (await load()).fetch(cronReq());
        expect(res.status).toBe(500);
        expect((await json(res)).stuck_splits).toHaveLength(1);
      });

      it("a DIFFERENT failure still pages while the ID is outstanding", async () => {
        seedStuck(scenario, [{ ...idSplit, execution_error: "transfer sent, refund rejected" }]);
        withHelper();
        scenario.rpc.payout_waits_on_identity = true;
        const res = await (await load()).fetch(cronReq());
        expect(res.status).toBe(500);
        expect((await json(res)).stuck_splits).toHaveLength(1);
      });

      it("FAILS CLOSED: an unreadable answer exempts nothing", async () => {
        seedStuck(scenario, [idSplit]);
        withHelper();
        scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), payout_waits_on_identity: { message: "connection reset", code: "08006" } };
        const res = await (await load()).fetch(cronReq());
        const body = await json(res);
        expect(res.status).toBe(500);
        expect(body.stuck_splits).toHaveLength(1);
        expect((body.defectReasons as string[]).join(" ")).toContain("ID check read");
      });
    });

    // Money review of the live gate (M2): execute-dispute-split holds a split
    // before any leg moves when Stripe does not say the Helpr's account is
    // payable and records CONNECT_HOLD_SPLIT_ERROR. Nothing moved, so it is
    // set aside (body only), never paged "half-moved"; an unexplained
    // "could not verify" still pages.
    // @mutate supabase/functions/auto-resolve-disputes/index.ts |               stuck = stuck.filter((row) => !connectHeldIds.has(row.id as string)); |               void connectHeldIds;
    describe("a split the live payout gate held before any leg moved", () => {
      const gateHeldSplit = {
        id: DISPUTE_ID,
        job_id: "job-7",
        execution_status: "failed",
        execution_started_at: "2026-08-30T10:00:00Z",
        execution_error: "nothing moved: Stripe does not say the Helpr's payout account is payable (helper Connect account was rejected by Stripe)",
      };
      const withHelper = () =>
        scenario.reads.jobs!.selectOverrides!.push({
          includes: "is_seed",
          result: { rows: [{ id: "job-7", is_seed: false, helper_id: "helper-7" }] },
        });

      it("is set aside: no defect, no admin page, answers 200", async () => {
        seedStuck(scenario, [gateHeldSplit]);
        withHelper();
        const res = await (await load()).fetch(cronReq());
        const body = await json(res);
        expect(res.status).toBe(200);
        expect(body.stuck_splits).toEqual([]);
        expect(body.held_stuck_splits).toEqual([{ id: DISPUTE_ID, job_id: "job-7" }]);
        expect(writesTo("notifications", "insert")).toHaveLength(0);
      });

      it("a split that could not verify the account still pages", async () => {
        seedStuck(scenario, [{ ...gateHeldSplit, execution_error: "could not verify the Helpr's Connect account" }]);
        withHelper();
        const res = await (await load()).fetch(cronReq());
        expect(res.status).toBe(500);
        expect((await json(res)).stuck_splits).toHaveLength(1);
      });
    });

    // Q1491 (lh-money-escrow review of the rebuild, #1): a JOB payout hold
    // (job_payout_holds, an underfunded gift-card job) stops the split before
    // any leg moves, recorded as PAYOUT_JOB_HOLD_SPLIT_ERROR. Same rule as the
    // Helpr hold: set aside while the job is held, paged once it is not, and
    // an unreadable job-hold read exempts nothing.
    // @mutate supabase/functions/auto-resolve-disputes/index.ts |                 stuck = stuck.filter((row) => !jobHeldIds.has(row.id as string)); |                 void jobHeldIds;
    // @mutate supabase/functions/auto-resolve-disputes/index.ts |                 defects.record(`stuck split job-payout-hold read: ${jobHolds.message}`); |                 stuck = []; void jobHolds;
    describe("a split a JOB payout hold is keeping back (Q1491)", () => {
      const jobHeldSplit = {
        id: DISPUTE_ID,
        job_id: "job-7",
        execution_status: "failed",
        execution_started_at: "2026-08-30T10:00:00Z",
        execution_error: "this job's payout is on hold (job_payout_holds)",
      };
      const withJob = () =>
        scenario.reads.jobs!.selectOverrides!.push({
          includes: "is_seed",
          result: { rows: [{ id: "job-7", is_seed: false, helper_id: "helper-7" }] },
        });

      it("is set aside while the job is held: no defect, no admin page, answers 200", async () => {
        seedStuck(scenario, [jobHeldSplit]);
        withJob();
        scenario.reads.job_payout_holds = { rows: [{ job_id: "job-7" }] };
        const res = await (await load()).fetch(cronReq());
        const body = await json(res);
        expect(res.status).toBe(200);
        expect(body.stuck_splits).toEqual([]);
        expect(body.held_stuck_splits).toEqual([{ id: DISPUTE_ID, job_id: "job-7" }]);
        expect(writesTo("notifications", "insert")).toHaveLength(0);
      });

      it("pages again once the job hold is released", async () => {
        seedStuck(scenario, [jobHeldSplit]);
        withJob();
        scenario.reads.job_payout_holds = { rows: [] };
        const res = await (await load()).fetch(cronReq());
        expect(res.status).toBe(500);
        expect((await json(res)).stuck_splits).toHaveLength(1);
      });

      it("FAILS CLOSED: an unreadable job hold exempts nothing", async () => {
        seedStuck(scenario, [jobHeldSplit]);
        withJob();
        scenario.reads.job_payout_holds = { error: { message: "connection reset", code: "08006" } };
        const res = await (await load()).fetch(cronReq());
        const body = await json(res);
        expect(res.status).toBe(500);
        expect(body.stuck_splits).toHaveLength(1);
        expect((body.defectReasons as string[]).join(" ")).toContain("job-payout-hold read");
      });
    });

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

  // ── 4. What is left of the per-job path never moves money ────────────────
  //
  // Q2362 removed the settlement (the claim, the Stripe reads, the flip to
  // payout_pending, the record close and the Q891 test-mode skips that guarded
  // those Stripe reads). What remains: an escalated dispute gets the daily
  // reminder, a non-escrow one gets the unsettleable reminder, every other
  // expired one is escalated. None of them may be silent, and none claims.
  describe("every expired dispute reaches a person, and none is settled", () => {
    const claimCalls = () => rpcCalls("claim_dispute_settlement");
    const UNSETTLEABLE = "Dispute stuck — escrow cannot auto-settle";
    const unsettleableNotes = () =>
      writesTo("notifications", "insert").flatMap((w) => w.payload as Array<{ title: string }>).filter((n) => n.title === UNSETTLEABLE);

    it("a dispute re-opened inside the payout hold (payout_pending) is never escalated or silently re-skipped: admins are told", async () => {
      seedExpiredDispute(scenario, { payment_status: "payout_pending" });
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(claimCalls()).toHaveLength(0);
      expect(writesTo("jobs")).toHaveLength(0);
      expect(unsettleableNotes()).toHaveLength(2);
      expect(body.claim_skipped).toEqual([{ job_id: JOB_ID, verdict: "payment_payout_pending" }]);
    });

    it("a HELPER-filed dispute re-opened inside the payout hold is not skipped silently: admins are told (round 3, M4)", async () => {
      seedExpiredDispute(scenario, { disputed_by: "helper-1", payment_status: "payout_pending" });
      scenario.writeSelectRows.jobs = [];
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(claimCalls()).toHaveLength(0);
      expect(unsettleableNotes()).toHaveLength(2);
      expect(body.claim_skipped).toEqual([{ job_id: JOB_ID, verdict: "payment_payout_pending" }]);
    });

    type State = [name: string, setup: () => void];
    const states: State[] = [
      ["escalated", () => seedExpiredDispute(scenario, { dispute_status: "escalated" })],
      ["payout_pending", () => seedExpiredDispute(scenario, { payment_status: "payout_pending" })],
      ["refunded", () => seedExpiredDispute(scenario, { payment_status: "refunded" })],
      ["helper-filed", () => seedExpiredDispute(scenario, { disputed_by: "helper-1" })],
      ["poster-filed", () => seedExpiredDispute(scenario, { disputed_by: "poster-1" })],
      ["no filer", () => seedExpiredDispute(scenario, { disputed_by: null })],
      ["crew member filed", () => seedExpiredDispute(scenario, { helper_id: null, is_group_job: true, disputed_by: "crew-member-2" })],
      ["no PI, no session", () => seedExpiredDispute(scenario, { stripe_payment_intent_id: null, stripe_session_id: null })],
      ["escalation write fails", () => {
        seedExpiredDispute(scenario);
        scenario.writeErrors = { jobs: { message: "x" } };
      }],
    ];

    it("inventories the states (floor)", () => {
      expect(states.length).toBeGreaterThan(8);
    });

    it.each(states)("state '%s' is never silent, never settled, never claimed", async (_name, setup) => {
      setup();
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = await json(res);
      expect(body.resolved).toBe(0);
      expect(claimCalls()).toHaveLength(0);
      expect(rpcCalls("settle_dispute_record")).toHaveLength(0);
      for (const w of writesTo("jobs")) expect(w.payload).toEqual({ dispute_status: "escalated" });
      const defect = res.status !== 200;
      const told = writesTo("notifications", "insert").length > 0;
      expect({ defect, told }).not.toEqual({ defect: false, told: false });
    });
  });
});
