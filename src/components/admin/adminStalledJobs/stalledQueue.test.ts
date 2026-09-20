/**
 * The stalled-job queue's arithmetic and its one promise.
 *
 * Nothing here renders. These are the facts the screen asserts to a person
 * deciding about held escrow: how stuck a job is, which stage fired when, and
 * that "the function isn't deployed" is never mistaken for "nothing is stuck".
 */
import { describe, it, expect } from "vitest";
import {
  awaitingHuman,
  hoursStuck,
  isMissingRpc,
  stageLadder,
  stuckLabel,
  STALLED_NO_MONEY_NOTE,
  type StalledQueueRow,
} from "./stalledQueue";
import {
  STALLED_FIRST_AFTER_HOURS,
  STALLED_SECOND_AFTER_HOURS,
  STALLED_ESCALATE_AFTER_HOURS,
  scheduledEndMs,
} from "../../../../supabase/functions/_shared/stalledCompletion";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const row = (over: Partial<StalledQueueRow> = {}): StalledQueueRow => ({
  job_id: "11111111-1111-4111-8111-111111111111",
  title: "Move a fridge",
  customer_id: "poster-1",
  helper_id: "helper-1",
  budget: 120,
  date_needed: jobLocalDateISO(-5),
  start_time: "09:00:00",
  estimated_hours: 3,
  status: "in_progress",
  payment_status: "escrow",
  first_sent_at: "2026-09-16T14:00:00Z",
  second_sent_at: "2026-09-17T14:00:00Z",
  escalated_at: "2026-09-18T14:00:00Z",
  resolved_at: null,
  ...over,
});

const END = scheduledEndMs("2026-09-15", "09:00:00", 3);

describe("hoursStuck / stuckLabel", () => {
  it("measures from the SAME scheduled end the sweep used", () => {
    const now = new Date(END + 50 * 3_600_000);
    expect(hoursStuck(row(), now)).toBeCloseTo(50, 6);
    expect(stuckLabel(row(), now)).toBe("2d 2h past the scheduled end");
  });

  it("renders sub-day spans in plain hours", () => {
    expect(stuckLabel(row(), new Date(END + 5 * 3_600_000))).toBe("5h past the scheduled end");
  });

  it("says so rather than printing NaN when the poster was deleted and the date went with them", () => {
    // CLAUDE.md: a job can outlive its poster; deletion nulls its columns.
    expect(stuckLabel(row({ date_needed: null }))).toBe("No scheduled end on record");
  });
});

describe("stageLadder", () => {
  it("names the three thresholds from the sweep's own constants, in order", () => {
    expect(stageLadder(row()).map((s) => s.atHours)).toEqual([
      STALLED_FIRST_AFTER_HOURS,
      STALLED_SECOND_AFTER_HOURS,
      STALLED_ESCALATE_AFTER_HOURS,
    ]);
  });

  it("reports a stage that never fired as unsent rather than inventing a time", () => {
    const ladder = stageLadder(row({ second_sent_at: null }));
    expect(ladder[1].sentAt).toBeNull();
    expect(ladder[2].sentAt).toBe("2026-09-18T14:00:00Z");
  });
});

describe("awaitingHuman", () => {
  it("keeps escalated-and-unresolved only", () => {
    const open = row();
    const done = row({ job_id: "b", resolved_at: "2026-09-19T00:00:00Z" });
    const never = row({ job_id: "c", escalated_at: null });
    expect(awaitingHuman([open, done, never]).map((r) => r.job_id)).toEqual([open.job_id]);
  });
});

describe("isMissingRpc", () => {
  it("recognises the deploy-lag window in every spelling PostgREST uses", () => {
    expect(isMissingRpc({ code: "PGRST202", message: "Could not find the function" })).toBe(true);
    expect(isMissingRpc({ code: "42883", message: "function does not exist" })).toBe(true);
    expect(isMissingRpc({ message: "Could not find the function public.admin_stalled_job_queue" })).toBe(true);
  });

  it("does NOT swallow a real failure — those must reach the error state", () => {
    expect(isMissingRpc(null)).toBe(false);
    expect(isMissingRpc({ code: "42501", message: "permission denied for function" })).toBe(false);
    expect(isMissingRpc({ code: "PGRST301", message: "JWT expired" })).toBe(false);
  });
});

describe("the promise this screen makes", () => {
  it("states that it moves no money", () => {
    expect(STALLED_NO_MONEY_NOTE).toMatch(/moves money/i);
    expect(STALLED_NO_MONEY_NOTE).toMatch(/records that a person looked/i);
  });
});
