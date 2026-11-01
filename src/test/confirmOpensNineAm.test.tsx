/**
 * The day-before window for a 9:00 AM job (lead, 2026-10-21: "add a test with a 9 AM job"). The rule is the
 * owner-approved one (docs/JOB-LIFECYCLE.md row 5, 2026-10-08): confirming opens at MIDNIGHT THE DAY BEFORE,
 * Louisiana time, not 24 h before the start. For a Thu 9:00 AM job that is Wed 12:00 AM CT; the confirm is owed
 * until 2 h before the start, Thu 7:00 AM. Every surface that says when it opens reads confirmOpensMs, so this
 * pins the instant and the words both cards and the tracker print.
 */
// @mutate supabase/functions/_shared/confirmDeadline.ts |   return jobLocalMidnightMs(previousDay(dateNeeded)); |   return jobLocalMidnightMs(dateNeeded);
// @mutate src/components/tracker/jobProgressState.ts |  : `Confirm on ${day}, the day before`; |  : `Confirm the day before.`;
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { confirmDeadlineMs, confirmOpensMs } from "@/lib/jobDate";
import { jobProgress } from "@/components/tracker/jobProgressState";
import { JobConfirmation } from "@/components/JobConfirmation";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

// Tue 2037-10-20 10:00 AM CT; the job is Thu 2037-10-22 9:00 AM CT (2037: a fixed far-out day, jobDayFixtureTimezone).
const NOW = new Date("2037-10-20T15:00:00Z");
const DAY = "2037-10-22";
const CT = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

afterEach(() => vi.useRealTimers());

describe("a Thu 9:00 AM job's confirm window", () => {
  it("opens Wed 12:00 AM CT (midnight the day before) and is owed until Thu 7:00 AM CT", () => {
    expect(CT(confirmOpensMs(DAY))).toBe("Wed, Oct 21, 12:00 AM");
    expect(CT(confirmDeadlineMs(DAY, "09:00"))).toBe("Thu, Oct 22, 7:00 AM");
  });

  it("the tracker says when it opens, on both sides", () => {
    const job = { status: "accepted", helper_id: "h", helper_confirmed_at: "t", date_needed: DAY, start_time: "09:00" };
    expect(jobProgress(job, { viewer: "poster", otherFirst: "Yusef", now: NOW }).next).toBe("Yusef confirms on Wed, the day before");
    expect(jobProgress(job, { viewer: "helpr", otherFirst: "Ben", now: NOW }).next).toBe("Confirm on Wed, the day before");
  });

  it("the Helpr's inline confirm draws nothing before the window: no greyed button (the tracker line carries the moment)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    render(
      <JobConfirmation variant="inline" hideNotYetOpen jobId="j1" isOwner={false} isHelper posterConfirmedAt={null} helperConfirmedAt="t"
        helperDayofConfirmedAt={null} dateNeeded={DAY} startTime="09:00" jobStatus="accepted" helperOnTheWayAt={null} />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.body.textContent).toBe("");
  });
});
