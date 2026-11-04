/**
 * Q2408 (review 11-04): on a week-window job the apply question asks about the first day and keeps "Other time"
 * inside the window; once the first day has come, "Yes, that works" is gone (accept would refuse it with
 * job_starts_too_soon) and the Helpr picks one of the days still ahead.
 *
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyTimeQuestion.tsx |   const firstDayGone = windowed && !!job.date_needed && job.date_needed <= today; |   const firstDayGone = false;
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyTimeQuestion.tsx |               max={windowed ? job.date_window_end! : addDays(today, 90)} |               max={addDays(today, 90)}
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyTimeQuestion.tsx | (todayStillBookable(job.start_time) ? today : addDays(today, 1)) | addDays(today, 1)
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyTimeQuestion.tsx |   if (!startTime) return true; |   if (!startTime) return false;
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

  it("once the first day has come: no Yes; today is offered while its start is ahead (no start time: all day)", () => {
    render(<Host job={{ date_needed: plus(0), date_window_end: plus(6) }} />);
    expect(screen.queryByTestId("apply-time-yes")).toBeNull();
    expect(screen.getByText("Which day works for you?")).toBeTruthy();
    expect(seen?.date).toBe(plus(0));
    const date = screen.getByTestId("apply-time-date") as HTMLInputElement;
    expect(date.min).toBe(plus(0));
    expect(date.max).toBe(plus(6));
  });

  // Lead review 11-04: on the window's LAST day the picker was empty ("Which day works for you?" with nothing to pick).
  // 16:00Z on 2026-11-06 is 10:00 AM in Chicago.
  const at10am = () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-06T16:00:00Z")); };

  it("on the window's last day, before its 3 PM start: today is offered (the only day left)", () => {
    at10am();
    render(<Host job={{ date_needed: "2026-11-04", date_window_end: "2026-11-06", start_time: "15:00:00", is_flexible_schedule: false }} />);
    expect(seen?.date).toBe("2026-11-06");
    const date = screen.getByTestId("apply-time-date") as HTMLInputElement;
    expect(date.min).toBe("2026-11-06");
    expect(date.max).toBe("2026-11-06");
  });

  it("mid-window, today's start within 15 minutes: tomorrow is the first day offered", () => {
    at10am();
    render(<Host job={{ date_needed: "2026-11-05", date_window_end: "2026-11-09", start_time: "10:10:00", is_flexible_schedule: false }} />);
    expect(seen?.date).toBe("2026-11-07");
  });

  it("a one-day job is unchanged (Yes offered, no window line)", () => {
    render(<Host job={{ date_needed: plus(3) }} />);
    expect(screen.getByTestId("apply-time-yes")).toBeTruthy();
    expect(screen.queryByTestId("apply-time-window")).toBeNull();
  });
});
