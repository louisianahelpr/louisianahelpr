/**
 * Q2408 (review 11-04): on a week-window job the apply question asks about the first day and keeps "Other time"
 * inside the window; once the first day has come, "Yes, that works" is gone (accept would refuse it with
 * job_starts_too_soon) and the Helpr picks one of the days still ahead.
 *
 * Lead review 11-04 (final): on day 1 with its start still ahead, Yes stays (pre-filling today there is the job's own
 * day and time: suggestion_same_as_job); "today" is offered only while its start is 2+ hours ahead (suggestion_too_soon).
 *
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyTimeQuestion.tsx | windowed && !!job.date_needed && (job.date_needed < today | false && (job.date_needed < today
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyTimeQuestion.tsx | job.date_needed === today && !todayStillBookable(job.start_time) | job.date_needed === today
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyTimeQuestion.tsx |               max={windowed ? job.date_window_end! : addDays(today, 90)} |               max={addDays(today, 90)}
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyTimeQuestion.tsx | (todayStillBookable(job.start_time, new Date(), SUGGESTION_LEAD_MINUTES) ? today : addDays(today, 1)) | addDays(today, 1)
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyTimeQuestion.tsx | (todayStillBookable(job.start_time, new Date(), SUGGESTION_LEAD_MINUTES) ? today : addDays(today, 1)) | (todayStillBookable(job.start_time) ? today : addDays(today, 1))
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyTimeQuestion.tsx | const SUGGESTION_LEAD_MINUTES = 120; | const SUGGESTION_LEAD_MINUTES = 15;
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyTimeQuestion.tsx | return platformToday(later) === platformToday(now) && platformNowHHMM(later) < start; | return platformNowHHMM(later) < start;
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useState } from "react";
import { ApplyTimeQuestion, type ApplyTimeSuggestion } from "@/components/dashboard/applyConfirmDialog/ApplyTimeQuestion";
import type { EnrichedJob } from "@/components/dashboard/types";

const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const plus = (n: number) => ymd(new Date(Date.now() + n * 86400000));
let seen: ApplyTimeSuggestion | null = null;

function Host({ job }: { job: Partial<EnrichedJob> }) {
  const [v, setV] = useState<ApplyTimeSuggestion | null>(null);
  seen = v;
  return <ApplyTimeQuestion job={{ id: "j1", start_time: null, is_flexible_schedule: true, ...job } as EnrichedJob} value={v} onChange={setV} />;
}
afterEach(() => { cleanup(); seen = null; vi.useRealTimers(); });

describe("Q2408 the apply question on a window job", () => {
  // 16:00Z on 2037-11-06 is 10:00 AM in Chicago.
  const at10am = () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2037-11-06T16:00:00Z")); };
  it("before the window: asks about the first day, says any day works, Other time stays in the window", () => {
    render(<Host job={{ date_needed: plus(2), date_window_end: plus(8) }} />);
    expect(screen.getByTestId("apply-time-yes")).toBeTruthy();
    expect(screen.getByTestId("apply-time-window").textContent).toMatch(/^Any day .+ works for the poster/);
    screen.getByTestId("apply-time-suggest").click();
    return Promise.resolve().then(() => {
      const date = screen.getByTestId("apply-time-date") as HTMLInputElement;
      expect(date.max).toBe(plus(8));
      expect(date.min).toBe(plus(2));
    });
  });

  it("a past first day: no Yes; today is offered while its start is ahead (no start time: all day)", () => {
    at10am();
    render(<Host job={{ date_needed: "2037-11-05", date_window_end: "2037-11-10" }} />);
    expect(screen.queryByTestId("apply-time-yes")).toBeNull();
    expect(screen.getByText("Which day works for you?")).toBeTruthy();
    expect(seen?.date).toBe("2037-11-06");
    const date = screen.getByTestId("apply-time-date") as HTMLInputElement;
    expect(date.min).toBe("2037-11-06");
    expect(date.max).toBe("2037-11-10");
  });

  // Final review: day 1 hid Yes and pre-filled today at the job's own time, which apply refuses (suggestion_same_as_job).
  it("on day 1 with its 3 PM start still ahead: Yes stays and nothing is pre-filled", () => {
    at10am();
    render(<Host job={{ date_needed: "2037-11-06", date_window_end: "2037-11-12", start_time: "15:00:00", is_flexible_schedule: false }} />);
    expect(screen.getByTestId("apply-time-yes")).toBeTruthy();
    expect(screen.getByTestId("apply-time-window")).toBeTruthy();
    expect(seen).toBeNull();
  });

  it("on day 1 with its start 15 minutes away or less: no Yes, tomorrow is offered", () => {
    at10am();
    render(<Host job={{ date_needed: "2037-11-06", date_window_end: "2037-11-12", start_time: "10:10:00", is_flexible_schedule: false }} />);
    expect(screen.queryByTestId("apply-time-yes")).toBeNull();
    expect(seen?.date).toBe("2037-11-07");
  });

  // Final review: today was offered with a start 15 minutes ahead; hiring at it refuses less than 2 hours (suggestion_too_soon).
  it("mid-window, today's start 1.5 hours ahead: tomorrow is the first day offered", () => {
    at10am();
    render(<Host job={{ date_needed: "2037-11-05", date_window_end: "2037-11-09", start_time: "11:30:00", is_flexible_schedule: false }} />);
    expect(seen?.date).toBe("2037-11-07");
  });

  it("mid-window, today's start 2.5 hours ahead: today is offered", () => {
    at10am();
    render(<Host job={{ date_needed: "2037-11-05", date_window_end: "2037-11-09", start_time: "12:30:00", is_flexible_schedule: false }} />);
    expect(seen?.date).toBe("2037-11-06");
  });

  it("at 10:30 PM with no start time: today is over (2 hours on is past midnight), tomorrow is offered", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2037-11-07T04:30:00Z")); // 10:30 PM Nov 6 in Chicago
    render(<Host job={{ date_needed: "2037-11-05", date_window_end: "2037-11-09" }} />);
    expect(seen?.date).toBe("2037-11-07");
  });

  // Lead review 11-04: on the window's LAST day the picker was empty ("Which day works for you?" with nothing to pick).

  it("on the window's last day, before its 3 PM start: today is offered (the only day left)", () => {
    at10am();
    render(<Host job={{ date_needed: "2037-11-04", date_window_end: "2037-11-06", start_time: "15:00:00", is_flexible_schedule: false }} />);
    expect(seen?.date).toBe("2037-11-06");
    const date = screen.getByTestId("apply-time-date") as HTMLInputElement;
    expect(date.min).toBe("2037-11-06");
    expect(date.max).toBe("2037-11-06");
  });

  it("mid-window, today's start within 15 minutes: tomorrow is the first day offered", () => {
    at10am();
    render(<Host job={{ date_needed: "2037-11-05", date_window_end: "2037-11-09", start_time: "10:10:00", is_flexible_schedule: false }} />);
    expect(seen?.date).toBe("2037-11-07");
  });

  it("a one-day job is unchanged (Yes offered, no window line)", () => {
    render(<Host job={{ date_needed: plus(3) }} />);
    expect(screen.getByTestId("apply-time-yes")).toBeTruthy();
    expect(screen.queryByTestId("apply-time-window")).toBeNull();
  });
});
