/**
 * `auto-expire-jobs` step 1 — the un-booking clock must not run before the
 * helper could answer.
 *
 * THE DEFECT. Step 1 re-opened any job that was `accepted`, unconfirmed and
 * accepted more than 24 hours ago, with NO predicate on `date_needed`. But
 * `JobConfirmation` renders no confirm control until the job is inside 24
 * hours. A helper who accepted a job five days out was therefore un-booked at
 * hour 24 — four days before the button that would have saved them appeared —
 * and notified "You didn't start … within 24 hours", which was not something
 * they were ever permitted to do.
 *
 * THE RULE (one number, enforced and displayed): the confirmation window opens
 * at midnight the day before the job in America/Chicago and closes
 * CONFIRM_WINDOW_HOURS later — so, for a job accepted in advance, noon the day
 * before. `_shared/confirmDeadline.ts` is the single definition; the card
 * imports the same function.
 *
 * These run the REAL function source through the edge harness. The supabase
 * mock does not apply PostgREST filters, so the far-out job IS handed to the
 * function — which is exactly the point: the assertion is on the decision the
 * function makes, not on a query string.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import {
  CONFIRM_WINDOW_HOURS,
  confirmOpensMs,
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

/** `YYYY-MM-DD` for a day offset, as `date_needed` (America/Chicago) holds it. */
function dateNeededInDays(days: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + days * 24 * HOUR));
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
      // The PRE-FIX step-1 read (`id, title, customer_id, helper_id`) has to
      // land on this row too, or "fails before" is a false pass: without this
      // entry the old column list fell through to the step-2 override and the
      // sweep simply saw no candidates.
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

describe("auto-expire-jobs · confirmation window", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
  });

  it("does NOT un-book a helper on a job whose confirm window has not opened", async () => {
    const fn = await load();
    // Accepted five days ago, job is five days out: the confirm control does
    // not exist yet, so there is nothing this helper failed to do.
    seedAcceptedJob({
      id: "job-farout",
      title: "Paint the fence",
      customer_id: "poster-1",
      helper_id: "helper-1",
      date_needed: dateNeededInDays(5),
      accepted_at: new Date(Date.now() - 5 * 24 * HOUR).toISOString(),
    });

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);

    expect(reopenWrites()).toHaveLength(0);
    // And nobody was told they missed a deadline that had not started.
    expect(scenario.writes.filter((w) => w.table === "notifications")).toHaveLength(0);
  });

  it("does NOT un-book inside the window but before the deadline", async () => {
    const fn = await load();
    const dateNeeded = dateNeededInDays(1);
    // One hour after the window opened: 11 of the 12 hours remain.
    const accepted = new Date(confirmOpensMs(dateNeeded) - 3 * 24 * HOUR).toISOString();
    seedAcceptedJob({
      id: "job-in-window",
      title: "Mow the lawn",
      customer_id: "poster-1",
      helper_id: "helper-1",
      date_needed: dateNeeded,
      accepted_at: accepted,
    });

    // Only meaningful while "now" really is inside the window; the window for a
    // job dated tomorrow is open from midnight today to noon today.
    const nowMs = Date.now();
    const opens = confirmOpensMs(dateNeeded);
    const deadline = opens + CONFIRM_WINDOW_HOURS * HOUR;
    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);

    if (nowMs < deadline) {
      expect(reopenWrites()).toHaveLength(0);
    } else {
      // Past noon local: the deadline has genuinely lapsed and it must expire.
      expect(reopenWrites()).toHaveLength(1);
    }
    expect(nowMs).toBeGreaterThan(opens - 24 * HOUR);
  });

  it("DOES un-book once the confirm deadline has lapsed", async () => {
    const fn = await load();
    // The job is today, so the window opened at midnight yesterday and closed
    // at noon yesterday — unambiguously in the past at every hour of today.
    seedAcceptedJob({
      id: "job-lapsed",
      title: "Haul the debris",
      customer_id: "poster-1",
      helper_id: "helper-1",
      date_needed: dateNeededInDays(0),
      accepted_at: new Date(Date.now() - 6 * 24 * HOUR).toISOString(),
    });

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);

    const reopens = reopenWrites();
    expect(reopens).toHaveLength(1);
    expect((reopens[0].payload as Record<string, unknown>).helper_id).toBeNull();

    // And the copy no longer blames them for not STARTING.
    const helperNote = scenario.writes.find(
      (w) =>
        w.table === "notifications" &&
        (w.payload as Record<string, unknown>)?.user_id === "helper-1",
    );
    expect(helperNote).toBeDefined();
    const msg = String((helperNote!.payload as Record<string, unknown>).message);
    expect(msg).toContain("didn't confirm");
    expect(msg).not.toContain("didn't start");
    expect(msg).toContain(String(CONFIRM_WINDOW_HOURS));
  });

  it("gives a helper who accepts inside the window the full grace period", async () => {
    const fn = await load();
    // Job is today (window opened at midnight yesterday, closed at noon
    // yesterday) but the helper only accepted an hour ago. A deadline that
    // already expired before they were involved is not a window — the clock
    // runs from their acceptance.
    seedAcceptedJob({
      id: "job-late-accept",
      title: "Move a couch",
      customer_id: "poster-1",
      helper_id: "helper-1",
      date_needed: dateNeededInDays(0),
      accepted_at: new Date(Date.now() - 1 * HOUR).toISOString(),
    });

    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    expect(reopenWrites()).toHaveLength(0);
  });
});
