/**
 * `stalled-completion-reminder` — the sweep that closes the "nobody ever marked
 * it done" trap, run as REAL source through the edge harness.
 *
 * The stage arithmetic is pinned by `stalledCompletionStage.test.ts`. What is
 * under test here is what the FUNCTION does with a stage:
 *
 *   1. both sides are told, every nudge — not just the Helpr, not just the
 *      person who posted it (owner, 2026-09-19: "nudge both");
 *   2. the escalation is a QUEUE ITEM plus an admin_alert, and NOT a row in
 *      admin_audit_log — no admin has acted yet, and every row there names an
 *      admin_id (scripts/audit/prod-seed.mjs refuses to fabricate one);
 *   3. NO MONEY MOVES, at any stage. This is the owner's hard constraint, so it
 *      is asserted on every run rather than reasoned about: the function must
 *      never write `jobs`, never touch a payout or refund ledger, and never
 *      call a release/refund RPC.
 *
 * The supabase mock does not apply PostgREST filters, so every seeded row is
 * handed to the function — which is the point: the assertions are on the
 * decision the function makes, not on a query string.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import {
  scheduledEndMs,
  STALLED_ESCALATE_AFTER_HOURS,
  STALLED_FIRST_AFTER_HOURS,
  STALLED_SECOND_AFTER_HOURS,
} from "../../../supabase/functions/_shared/stalledCompletion";
import { jobLocalStartMs } from "../../../supabase/functions/_shared/cancellationFee";

const CRON_SECRET = "cron-secret-stalled";
const HOUR = 3_600_000;
const POSTED_BY = "posted-by-1";
const WORKED_BY = "worked-by-1";
const ADMIN = "admin-1";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    CRON_SECRET,
  });
  return loadEdgeFunction("stalled-completion-reminder");
}

const cronRequest = (fn: EdgeHarness): Request =>
  fn.request({
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
    url: "https://edge.test/stalled-completion-reminder",
  });

/**
 * A job whose scheduled end was EXACTLY `hoursAgo` hours ago, plus the ledger
 * rows the function will read back.
 *
 * The anchor is `max(end of the job's local day, start_time + estimated_hours)`,
 * so the end is pinned by making the SECOND branch win: a 23:00 start is one
 * hour before the day's end, and any estimate longer than that hour dominates.
 * The estimate is then solved for the wanted instant, so the test controls the
 * clock exactly instead of to the nearest midnight.
 */
function seedStalled(hoursAgo: number, ledger: Record<string, unknown> | null) {
  const target = Date.now() - hoursAgo * HOUR;
  // Two days before the target, so the 23:00 start is comfortably earlier and
  // the solved estimate is always well over the one hour it must beat.
  const dateNeeded = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(target - 2 * 24 * HOUR));
  const startMs = jobLocalStartMs(dateNeeded, "23:00:00");
  const estimatedHours = (target - startMs) / HOUR;
  const end = scheduledEndMs(dateNeeded, "23:00:00", estimatedHours);
  expect(Math.abs(end - target)).toBeLessThan(1000);

  scenario.reads.jobs = {
    rows: [
      {
        id: "job-stalled",
        title: "Haul the debris",
        status: "in_progress",
        customer_id: POSTED_BY,
        helper_id: WORKED_BY,
        date_needed: dateNeeded,
        start_time: "23:00:00",
        estimated_hours: estimatedHours,
        helper_completed_at: null,
        poster_completed_at: null,
      },
    ],
  };
  scenario.reads.job_completion_nudges = { rows: ledger ? [ledger] : [] };
  scenario.reads.user_roles = { rows: [{ user_id: ADMIN }] };
  scenario.reads.notifications = { rows: [] };
  // The ledger claim must report a row, or the function treats the stage as
  // taken by another run and sends nothing.
  scenario.writeSelectRows.job_completion_nudges = [{ job_id: "job-stalled" }];
  scenario.writeSelectRows.notifications = [{ id: "notif-1" }];
  return { dateNeeded, end };
}

const notifs = () =>
  scenario.writes
    .filter((w) => w.table === "notifications" && w.op === "insert")
    .map((w) => w.payload as { user_id: string; title: string; message: string; type: string; link: string });

const ledgerWrites = () => scenario.writes.filter((w) => w.table === "job_completion_nudges");

/** Every way this function could move money, asserted absent on every run. */
function assertNoMoneyMoved() {
  const MONEY_TABLES = [
    "jobs",
    "payment_refunds",
    "payout_transfers",
    "payouts",
    "credit_ledger",
    "tips",
  ];
  const moved = scenario.writes.filter((w) => MONEY_TABLES.includes(w.table));
  expect(moved.map((w) => `${w.op} ${w.table}`)).toEqual([]);
  // …and no admin action was fabricated.
  expect(scenario.writes.filter((w) => w.table === "admin_audit_log")).toEqual([]);
  expect(scenario.writes.filter((w) => w.table === "admin_user_notes")).toEqual([]);
  expect((scenario.rpcCalls ?? []).map((c) => c.name)).toEqual([]);
}

describe("stalled-completion-reminder", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
    // `send-notification-email` is a cross-function fetch. Answer it the way
    // the real one does; leaving it unstubbed makes every run record an email
    // defect, and cron-result answers non-2xx on any defect — which would hide
    // the behaviour under test behind a 500.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
  });

  it("rejects an unauthenticated call", async () => {
    const fn = await load();
    const res = await fn.fetch(fn.request({ method: "POST", url: "https://edge.test/x" }));
    expect(res.status).toBe(401);
  });

  it("nudges BOTH parties on the first stage, and moves no money", async () => {
    const fn = await load();
    seedStalled(STALLED_FIRST_AFTER_HOURS + 1, null);

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ first: 1, second: 0, escalate: 0, errors: 0 });

    const sent = notifs();
    expect(sent.map((n) => n.user_id).sort()).toEqual([POSTED_BY, WORKED_BY].sort());
    // Each side is told the thing only THEY can act on.
    expect(sent.find((n) => n.user_id === WORKED_BY)!.message).toMatch(/Mark Job Complete/);
    expect(sent.find((n) => n.user_id === POSTED_BY)!.message).toMatch(/nobody has marked it done/i);
    // …and each on their own surface.
    expect(sent.find((n) => n.user_id === POSTED_BY)!.link).toBe("/my-posts?job=job-stalled");
    expect(sent.find((n) => n.user_id === WORKED_BY)!.link).toBe("/my-jobs?job=job-stalled");
    // The stage was claimed before anything was sent.
    expect(ledgerWrites()).toHaveLength(1);
    assertNoMoneyMoved();
  });

  it("sends nothing at all before the grace has run out", async () => {
    const fn = await load();
    seedStalled(STALLED_FIRST_AFTER_HOURS - 0.5, null);

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ processed: 1, sent: 0 });
    expect(notifs()).toEqual([]);
    expect(ledgerWrites()).toEqual([]);
  });

  it("escalates to a QUEUE ITEM — admin_alert plus a ledger stamp, never an audit-log row", async () => {
    const fn = await load();
    const hoursAgo = STALLED_ESCALATE_AFTER_HOURS + 2;
    seedStalled(hoursAgo, {
      job_id: "job-stalled",
      first_sent_at: new Date(Date.now() - (hoursAgo - STALLED_FIRST_AFTER_HOURS) * HOUR).toISOString(),
      second_sent_at: new Date(Date.now() - (hoursAgo - STALLED_SECOND_AFTER_HOURS) * HOUR).toISOString(),
      escalated_at: null,
    });

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ escalate: 1, errors: 0 });

    const sent = notifs();
    const adminAlert = sent.find((n) => n.type === "admin_alert");
    expect(adminAlert).toBeTruthy();
    expect(adminAlert!.user_id).toBe(ADMIN);
    expect(adminAlert!.link).toBe("/admin?job=job-stalled");
    expect(adminAlert!.message).toMatch(/Nothing moves automatically/i);
    // Both parties are told a person is looking, and that the money is parked.
    for (const who of [POSTED_BY, WORKED_BY]) {
      const n = sent.find((x) => x.user_id === who);
      expect(n, who).toBeTruthy();
      expect(n!.message).toMatch(/stays in escrow/i);
      expect(n!.message).toMatch(/nothing has been released or refunded/i);
    }
    // The queue item itself: escalated_at stamped, conditionally, on the ledger.
    const claim = ledgerWrites();
    expect(claim).toHaveLength(1);
    expect((claim[0].payload as Record<string, unknown>).escalated_at).toBeTruthy();
    expect(claim[0].filters.some((f) => f.column === "job_id")).toBe(true);
    assertNoMoneyMoved();
  });

  it("does nothing once the job has been escalated", async () => {
    const fn = await load();
    seedStalled(STALLED_ESCALATE_AFTER_HOURS * 4, {
      job_id: "job-stalled",
      first_sent_at: new Date(Date.now() - 100 * HOUR).toISOString(),
      second_sent_at: new Date(Date.now() - 90 * HOUR).toISOString(),
      escalated_at: new Date(Date.now() - 80 * HOUR).toISOString(),
    });

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 0 });
    expect(notifs()).toEqual([]);
    assertNoMoneyMoved();
  });

  it("skips a job the moment either side marks it done", async () => {
    const fn = await load();
    seedStalled(STALLED_ESCALATE_AFTER_HOURS + 5, null);
    (scenario.reads.jobs!.rows[0] as Record<string, unknown>).helper_completed_at =
      new Date(Date.now() - HOUR).toISOString();

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 0 });
    expect(notifs()).toEqual([]);
    assertNoMoneyMoved();
  });

  it("reports a defect (non-2xx) when the notification insert lands zero rows", async () => {
    // A run that swallows a failed send and still answers 200 is invisible to
    // sweep_cron_http_failures — the exact shape cron-result.ts exists for.
    const fn = await load();
    seedStalled(STALLED_FIRST_AFTER_HOURS + 1, null);
    scenario.writeSelectRows.notifications = [];

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).not.toBe(200);
    assertNoMoneyMoved();
  });
});
