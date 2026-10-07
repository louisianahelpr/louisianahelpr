/**
 * Q1424 (client half): the client countdowns, proved by MOVING THE CLOCK —
 * 1 ms before, at, and after each boundary, and across both 2026 DST Sundays
 * in Central time (2026-03-08, 23 h; 2026-11-01, 25 h).
 *
 * One countdown component serves every deadline surface the time inventory
 * named: DeadlineCountdown renders OfferedActions' response deadline,
 * SubmittedStep's 24 h auto-complete, DisputedStep / DisputedSection's
 * dispute_deadline and PostedJobCard's / RevisionStep's revision deadlines;
 * JobCountdown is the "Job starts in" pill; offerClock decides when an offer
 * has gone. (The Browse / My Posts expiry chip's re-render is useExpiryClock,
 * proved with fake timers in src/components/job-card/expiredOfferLeavesNeedsYou.test.tsx.)
 *
 * DEFECT found here and fixed: JobCountdown counted a flexible-time job down
 * to "midnight + 24 h", so on the spring-forward Sunday it ran an hour LATE
 * and on the fall-back Sunday an hour EARLY. It now ends at the next Central
 * midnight (jobDayEndMs).
 *
 * @mutate src/components/job-card/JobCountdown.tsx |         return end === null ? null : new Date(end - 1_000); |         const m = jobStartDateTime(dateNeeded, null); return m ? new Date(m.getTime() + 86_400_000 - 1_000) : null;
 * @mutate src/components/job-card/DeadlineCountdown.tsx |   const isExpired = diffMs <= 0; |   const isExpired = diffMs < 0;
 * @mutate src/components/job-card/offerClock.ts |   const isExpired = (!!hardDeadline && new Date(hardDeadline).getTime() <= now) |   const isExpired = (!!hardDeadline && new Date(hardDeadline).getTime() < now)
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import DeadlineCountdown from "@/components/job-card/DeadlineCountdown";
import { JobCountdown } from "@/components/job-card/JobCountdown";
import { offerClock } from "@/components/job-card/offerClock";
import { jobDayEndMs } from "@/lib/jobDate";

const at = (iso: string, deltaMs = 0) => new Date(Date.parse(iso) + deltaMs);
function freeze(when: Date) {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(when);
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DeadlineCountdown (offer, auto-complete, dispute and revision deadlines)", () => {
  const T = "2026-10-08T17:00:00.000Z";
  const show = () =>
    render(<DeadlineCountdown deadline={T} expiredText="Response deadline expired" consequenceText="left to answer" />);

  it("1 ms before: still counting (0m), not expired", () => {
    freeze(at(T, -1));
    show();
    expect(screen.queryByText(/Response deadline expired/)).toBeNull();
    expect(document.body.textContent).toMatch(/0m/);
  });

  it("at the deadline and 1 ms after: expired", () => {
    freeze(at(T));
    show();
    expect(screen.getByText(/Response deadline expired/)).toBeTruthy();
    cleanup();
    freeze(at(T, 1));
    show();
    expect(screen.getByText(/Response deadline expired/)).toBeTruthy();
  });

  it("left open across the deadline, the minute tick flips it without a re-render from outside", () => {
    freeze(at(T, -90_000));
    show();
    expect(document.body.textContent).toMatch(/1m/);
    expect(screen.queryByText(/Response deadline expired/)).toBeNull();
    act(() => { vi.advanceTimersByTime(60_000); }); // T - 30 s
    expect(screen.queryByText(/Response deadline expired/)).toBeNull();
    act(() => { vi.advanceTimersByTime(60_000); }); // T + 30 s
    expect(screen.getByText(/Response deadline expired/)).toBeTruthy();
  });
});

describe("JobCountdown across the DST Sundays (Central)", () => {
  // 8:00 AM Central on each Sunday: CDT (UTC-5) after spring-forward, CST
  // (UTC-6) after fall-back.
  const cases = [
    { name: "spring-forward Sunday 2026-03-08, 8:00 AM CDT", date: "2026-03-08", time: "08:00", start: "2026-03-08T13:00:00.000Z" },
    { name: "fall-back Sunday 2026-11-01, 8:00 AM CST", date: "2026-11-01", time: "08:00", start: "2026-11-01T14:00:00.000Z" },
  ];
  for (const c of cases) {
    it(`${c.name}: 1 ms before counts, at the start has arrived`, () => {
      freeze(at(c.start, -1));
      render(<JobCountdown dateNeeded={c.date} startTime={c.time} label="Job starts in" />);
      expect(screen.getByText(/Job starts in: 0m/)).toBeTruthy();
      cleanup();
      freeze(at(c.start));
      render(<JobCountdown dateNeeded={c.date} startTime={c.time} label="Job starts in" />);
      expect(screen.getByText(/Job time has arrived/)).toBeTruthy();
    });
  }

  // A flexible job (no start time) runs to one second before the next
  // Central midnight: 23:59:59 local on a 23 h and on a 25 h day alike.
  const flexible = [
    { name: "spring-forward Sunday (23 h day)", date: "2026-03-08", end: "2026-03-09T04:59:59.000Z" },
    { name: "fall-back Sunday (25 h day)", date: "2026-11-01", end: "2026-11-02T05:59:59.000Z" },
    { name: "an ordinary day", date: "2026-10-08", end: "2026-10-09T04:59:59.000Z" },
  ];
  for (const c of flexible) {
    it(`flexible time on ${c.name}: ends at 11:59:59 PM Central`, () => {
      freeze(at(c.end, -1));
      render(<JobCountdown dateNeeded={c.date} startTime={null} label="Job ends in" />);
      expect(screen.getByText(/Job ends in: 0m/)).toBeTruthy();
      cleanup();
      freeze(at(c.end));
      render(<JobCountdown dateNeeded={c.date} startTime={null} label="Job ends in" />);
      expect(screen.getByText(/Job time has arrived/)).toBeTruthy();
    });
  }

  it("jobDayEndMs is the next Central midnight on both DST Sundays", () => {
    expect(new Date(jobDayEndMs("2026-03-08")!).toISOString()).toBe("2026-03-09T05:00:00.000Z");
    expect(new Date(jobDayEndMs("2026-11-01")!).toISOString()).toBe("2026-11-02T06:00:00.000Z");
    expect(jobDayEndMs("not-a-date")).toBeNull();
  });
});

describe("offerClock: when an offer is gone", () => {
  const T = "2026-11-01T07:30:00.000Z"; // 1:30 AM CST, inside the repeated fall-back hour
  const app = { id: "app-1", updated_at: "2026-10-31T07:30:00.000Z" };

  it("hard deadline: 1 ms before open, at and after gone", () => {
    const job = { response_deadline: T };
    expect(offerClock(app, job, Date.parse(T) - 1).isExpired).toBe(false);
    expect(offerClock(app, job, Date.parse(T)).isExpired).toBe(true);
    expect(offerClock(app, job, Date.parse(T) + 1).isExpired).toBe(true);
  });

  it("derived 24 h clock is 24 elapsed hours, not a wall-clock day, across the 25 h Sunday", () => {
    const stamped = { id: "app-2", updated_at: "2026-10-31T12:00:00.000Z" };
    const due = Date.parse("2026-11-01T12:00:00.000Z");
    expect(offerClock(stamped, {}, due - 1).isExpired).toBe(false);
    expect(offerClock(stamped, {}, due).isExpired).toBe(true);
  });
});
