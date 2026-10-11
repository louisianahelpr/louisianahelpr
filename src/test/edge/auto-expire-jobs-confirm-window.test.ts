/**
 * `auto-expire-jobs` step 1 — the un-booking clock must not run before the
 * deadline the Helpr is shown.
 *
 * THE FIRST DEFECT (2026-09-21). Step 1 re-opened any job that was `accepted`,
 * unconfirmed and accepted more than 24 hours ago, with NO predicate on
 * `date_needed`, so a helper who accepted a job five days out was un-booked at
 * hour 24, days before the button that would have saved them appeared.
 *
 * THE SECOND (Q1647, 2026-10-11). The deadline it then used was "12 hours after
 * the window opens" (noon the day before), while the card and the SQL sweep
 * `sweep_confirm_reminders_and_repost` say "2 hours before the start" (owner,
 * 2026-10-08). One rule now: `confirmDeadlineMs(date_needed, start_time)` in
 * `_shared/confirmDeadline.ts`, which the card imports too
 * (src/test/confirmDeadlineOneRule.test.ts keeps the SQL on it).
 *
 * AND THE ANSWER WINDOW WINS. An accepted row with no `helper_confirmed_at` is
 * a hire the Helpr has not finished accepting; its `response_deadline` is the
 * clock their card counts down, and expire_unanswered_offers owns it. This
 * step never reopens a row whose answer window is still running.
 *
 * These run the REAL function source through the edge harness. The supabase
 * mock does not apply PostgREST filters, so every seeded row IS handed to the
 * function — the assertion is on the decision the function makes.
 *
 * The mutations target the SWEEP's decision, not the constant in
 * `_shared/confirmDeadline.ts`: this file imports that helper as its own
 * oracle, so moving it moves both sides at once and proves nothing.
 */
// @mutate supabase/functions/auto-expire-jobs/index.ts | return confirmDeadlineMs(j.date_needed, j.start_time ?? null) <= nowMs; | return true;
// @mutate supabase/functions/auto-expire-jobs/index.ts | if (j.response_deadline && new Date(j.response_deadline).getTime() > nowMs) return false; | void 0;
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import {
  CONFIRM_DEADLINE_HOURS_BEFORE_START,
  confirmDeadlineMs,
} from "../../../supabase/functions/_shared/confirmDeadline";

const CRON_SECRET = "cron-secret-expire";
const HOUR = 3_600_000;

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    CRON_SECRET,
  });
  return loadEdgeFunction("auto-expire-jobs");
}

function cronRequest(fn: EdgeHarness): Request {
  return fn.request({
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
    url: "https://edge.test/auto-expire-jobs",
  });
}

/** `YYYY-MM-DD` and `HH:MM` of an instant, as `date_needed`/`start_time` (America/Chicago) hold it. */
function centralSlot(ms: number): { date_needed: string; start_time: string } {
  const date_needed = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
  const start_time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
  return { date_needed, start_time };
}

/** A start `hours` from now, rounded down to the minute (the column has no seconds). */
function startIn(hours: number) {
  return centralSlot(Math.floor((Date.now() + hours * HOUR) / 60_000) * 60_000);
}

/**
 * Seed step 1's candidate read and neutralise every later step, so the only
 * write this test can produce is the re-open under examination.
 *
 * `accepted_at` is the discriminator: step 1 is the only read that asks for it,
 * and the override list is matched on the column list, first hit wins.
 */
function seedAcceptedJob(row: Record<string, unknown>) {
  scenario.reads.jobs = {
    rows: [],
    selectOverrides: [
      { includes: "accepted_at", result: { rows: [row] } },
      { includes: "helper_id", result: { rows: [row] } },
      { includes: "id, title, customer_id", result: { rows: [] } },
    ],
  };
  scenario.reads.applications = { rows: [{ id: "app-1" }] };
  scenario.reads.notifications = { rows: [] };
  scenario.rpc.expire_unanswered_offers = 0;
  scenario.rpc.expire_pending_direct_offers = 0;
}

function reopenWrites() {
  return scenario.writes.filter(
    (w) =>
      w.table === "jobs" &&
      w.op === "update" &&
      (w.payload as Record<string, unknown>)?.status === "open",
  );
}

const base = {
  title: "Paint the fence",
  customer_id: "poster-1",
  helper_id: "helper-1",
  accepted_at: new Date(Date.now() - 5 * 24 * HOUR).toISOString(),
  response_deadline: null,
};

describe("auto-expire-jobs · one confirm deadline (2 hours before the start)", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
  });

  it("does NOT un-book a job five days out", async () => {
    const fn = await load();
    seedAcceptedJob({ ...base, id: "job-farout", ...startIn(5 * 24) });
    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    expect(reopenWrites()).toHaveLength(0);
    expect(scenario.writes.filter((w) => w.table === "notifications")).toHaveLength(0);
  });

  it("does NOT un-book 4 hours before the start, long past the old noon-the-day-before rule (Q1647)", async () => {
    const fn = await load();
    // The old rule (12 hours after midnight the day before) had lapsed for
    // every job starting this soon; the deadline the card shows has not. Four
    // hours (not three) so a DST-ambiguous wall time cannot move it past.
    const slot = startIn(4);
    expect(confirmDeadlineMs(slot.date_needed, slot.start_time)).toBeGreaterThan(Date.now());
    seedAcceptedJob({ ...base, id: "job-in-time", ...slot });
    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    expect(reopenWrites()).toHaveLength(0);
  });

  it("DOES un-book once 2 hours before the start has passed, and says so", async () => {
    const fn = await load();
    // Half an hour out: 90 minutes past the deadline, more than a DST hour.
    const slot = startIn(0.5);
    expect(confirmDeadlineMs(slot.date_needed, slot.start_time)).toBeLessThanOrEqual(Date.now());
    seedAcceptedJob({ ...base, id: "job-lapsed", title: "Haul the debris", ...slot });
    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);

    const reopens = reopenWrites();
    expect(reopens).toHaveLength(1);
    expect((reopens[0].payload as Record<string, unknown>).helper_id).toBeNull();

    const helperNote = scenario.writes.find(
      (w) =>
        w.table === "notifications" &&
        (w.payload as Record<string, unknown>)?.user_id === "helper-1",
    );
    expect(helperNote).toBeDefined();
    const msg = String((helperNote!.payload as Record<string, unknown>).message);
    // These rows are accepts never completed: the copy names that.
    expect(msg).toContain("didn't finish accepting");
    expect(msg).not.toContain("didn't start");
    expect(msg).toContain(`${CONFIRM_DEADLINE_HOURS_BEFORE_START} hours before it started`);
  });

  it("leaves a hire whose answer window is still running to expire_unanswered_offers", async () => {
    const fn = await load();
    // Past the confirm deadline, but the poster gave the Helpr until the start
    // to answer ("1h left to accept" on their card).
    seedAcceptedJob({
      ...base,
      id: "job-answer-window",
      ...startIn(0.5),
      response_deadline: new Date(Date.now() + 1 * HOUR).toISOString(),
    });
    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    expect(reopenWrites()).toHaveLength(0);
  });
});
