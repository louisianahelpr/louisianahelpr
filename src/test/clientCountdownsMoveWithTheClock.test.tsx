/**
 * Q1424, the client half: every on-card clock flips at its instant (within
 * its one-minute tick) and never before, with the clock MOVED.
 *
 * The 2026-10-06 time inventory listed the client countdowns as having no
 * proof that moves the clock: OfferedActions (the answer window), SubmittedStep
 * (24 h auto-complete), JobCountdown, PostedJobCard's revision deadlines,
 * DisputedStep, and the Browse / My Posts expiry chip re-render. No test of
 * any of them used fake timers (grep of src for useFakeTimers / setSystemTime /
 * advanceTimersByTime beside their names, 2026-10-13). They draw through a few
 * shared clocks, so those are what is proven here:
 *
 *   DeadlineCountdown    SubmittedStep, DisputedStep (both sides), RevisionStep,
 *                        PostedJobCard, InProgressStep, OpenStep
 *   CountdownRows        OfferedActions and the collapsed status strip
 *   JobCountdown         the "job starts in" pill
 *   useExpiryClock       the expiry chip and its Activity bucket
 *   useDoneFloorActive   Mark Job Complete's 30-minute floor
 *
 * Each case mounts 1 ms before the instant (not expired), then lets the
 * component's own timer run (expired within its tick), and mounts at the
 * instant (expired). A job start is Central wall-clock, so JobCountdown and
 * jobStartTarget are checked against the Central instant on both 2026 DST days.
 *
 * INVENTORY, exact both ways: every src module that keeps its own clock state
 * (`setNow(`) is a proven primitive here or listed in NOT_PROVEN with why, and
 * every Q1424-named component renders through a proven primitive.
 */
// @mutate src/components/job-card/DeadlineCountdown.tsx |   const isExpired = diffMs <= 0; |   const isExpired = diffMs < -60_000;
// @mutate src/components/job-card/CountdownRows.tsx |         {left <= 0 ? ( |         {left < -60_000 ? (
// @mutate src/components/job-card/JobCountdown.tsx |   if (diffMs <= 0) { |   if (diffMs <= -60_000) {
// @mutate src/lib/useExpiryClock.ts |   if (left <= 60_000) return left; |   if (left <= 60_000) return 60_000 * 5;
// @mutate src/components/job-card/useDoneFloor.ts |     const t = setTimeout(() => setNow(Date.now()), wait + 250); |     const t = setTimeout(() => setNow(Date.now()), wait + 120_000);
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import DeadlineCountdownDefault from "@/components/job-card/DeadlineCountdown";
import { CountdownRows, jobStartTarget } from "@/components/job-card/CountdownRows";
import { JobCountdown } from "@/components/job-card/JobCountdown";
import { useExpiryClock } from "@/lib/useExpiryClock";
import { useDoneFloorActive } from "@/components/job-card/useDoneFloor";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const MIN = 60_000;
const DEADLINE = Date.UTC(2026, 9, 20, 15, 30, 0); // 10:30 CDT

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const at = (ms: number) => vi.setSystemTime(new Date(ms));
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("DeadlineCountdown (SubmittedStep, DisputedStep, RevisionStep, PostedJobCard)", () => {
  const el = () => (
    <DeadlineCountdownDefault deadline={new Date(DEADLINE).toISOString()} expiredText="EXPIRED" consequenceText="until it releases" inline />
  );
  it("1 ms before: still counting; its own tick flips it within a minute", () => {
    at(DEADLINE - 1);
    const { container } = render(el());
    expect(container.textContent).not.toContain("EXPIRED");
    expect(container.textContent).toContain("0m");
    tick(MIN);
    expect(container.textContent).toContain("EXPIRED");
  });
  it("at the instant: expired", () => {
    at(DEADLINE);
    const { container } = render(el());
    expect(container.textContent).toContain("EXPIRED");
  });
});

describe("CountdownRows (OfferedActions, the collapsed strip)", () => {
  const el = () => (
    <CountdownRows variant="box" clocks={[{ id: "answer", at: new Date(DEADLINE).toISOString(), text: "left to answer", expiredText: "ANSWER WINDOW CLOSED" }]} />
  );
  it("1 ms before: still counting; its own tick flips it within a minute", () => {
    at(DEADLINE - 1);
    const { container } = render(el());
    expect(container.textContent).toContain("left to answer");
    tick(MIN);
    expect(container.textContent).toContain("ANSWER WINDOW CLOSED");
  });
  it("at the instant: expired", () => {
    at(DEADLINE);
    expect(render(el()).container.textContent).toContain("ANSWER WINDOW CLOSED");
  });
});

describe("JobCountdown and jobStartTarget: a Central start, on both 2026 DST days", () => {
  const CASES: Array<[string, string, string, number]> = [
    ["CDT day", "2026-10-20", "09:00:00", Date.UTC(2026, 9, 20, 14, 0, 0)],
    ["spring-forward day (CDT from 02:00)", "2026-03-08", "09:00:00", Date.UTC(2026, 2, 8, 14, 0, 0)],
    ["fall-back day (CST from 02:00)", "2026-11-01", "09:00:00", Date.UTC(2026, 10, 1, 15, 0, 0)],
  ];
  it.each(CASES)("%s: the target is the Central instant", (_l, date, time, ms) => {
    expect(jobStartTarget(date, time)?.getTime()).toBe(ms);
  });
  it.each(CASES)("%s: 1 ms before counts, its own tick reaches 'arrived', and at the instant it has arrived", (_l, date, time, ms) => {
    at(ms - 1);
    const { container } = render(<JobCountdown dateNeeded={date} startTime={time} label="Job starts in" />);
    expect(container.textContent).toContain("Job starts in: 0m");
    tick(MIN);
    expect(container.textContent).toContain("Job time has arrived!");
    cleanup();
    at(ms);
    expect(render(<JobCountdown dateNeeded={date} startTime={time} label="Job starts in" />).container.textContent).toContain("Job time has arrived!");
  });
  it("no start time: counts to the END of the Central day (23:59:59), not its midnight", () => {
    const end = Date.UTC(2026, 9, 21, 4, 59, 59); // 2026-10-20 23:59:59 CDT
    expect(jobStartTarget("2026-10-20", null)?.getTime()).toBe(end);
    at(end - 1);
    expect(render(<JobCountdown dateNeeded="2026-10-20" label="Job starts in" />).container.textContent).not.toContain("arrived");
    cleanup();
    at(end);
    expect(render(<JobCountdown dateNeeded="2026-10-20" label="Job starts in" />).container.textContent).toContain("Job time has arrived!");
  });
});

describe("useExpiryClock (the expiry chip and its Activity bucket)", () => {
  it("re-reads the time just past the instant, not on the next minute", () => {
    at(DEADLINE - 30_000);
    const iso = new Date(DEADLINE).toISOString();
    const { result } = renderHook(() => useExpiryClock([iso]));
    expect(result.current.getTime()).toBeLessThan(DEADLINE);
    tick(30_000 - 1);
    expect(result.current.getTime()).toBeLessThan(DEADLINE);
    tick(1 + 25);
    expect(result.current.getTime()).toBeGreaterThanOrEqual(DEADLINE);
    expect(result.current.getTime()).toBeLessThan(DEADLINE + 1_000);
  });
  it("sets no timer when nothing is live", () => {
    at(DEADLINE + 1);
    renderHook(() => useExpiryClock([new Date(DEADLINE).toISOString(), null]));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useDoneFloorActive (Mark Job Complete's 30-minute floor)", () => {
  it("active until 30 min after the work started, inactive by itself within a second of it", () => {
    const start = DEADLINE - 30 * MIN;
    at(DEADLINE - 1);
    const { result } = renderHook(() => useDoneFloorActive(new Date(start).toISOString()));
    expect(result.current).toBe(true);
    tick(1_000);
    expect(result.current).toBe(false);
  });
  it("at the instant: already inactive", () => {
    at(DEADLINE);
    const { result } = renderHook(() => useDoneFloorActive(new Date(DEADLINE - 30 * MIN).toISOString()));
    expect(result.current).toBe(false);
  });
});

/** Modules with their own clock state, each a primitive proven above or a decision. */
const PROVEN_PRIMITIVES = [
  "src/components/job-card/CountdownRows.tsx",
  "src/components/job-card/DeadlineCountdown.tsx",
  "src/components/job-card/JobCountdown.tsx",
  "src/components/job-card/useDoneFloor.ts",
  "src/lib/useExpiryClock.ts",
];
// @two-way src/test/clientCountdownsMoveWithTheClock.test.tsx:a NOT_PROVEN module that keeps no clock state any more
const NOT_PROVEN: Record<string, string> = {
  "src/pages/jobs/appliedJobCard/ActiveJobSection.tsx":
    "the payout request floor (MIN_WORK_MS, a 60 s tick) on the money path; its button's greyed state is useDoneFloorActive's, proven above",
};
/** The components the 2026-10-06 inventory named, and the primitive each draws its clock through. */
const NAMED: Record<string, string> = {
  "src/pages/jobs/appliedJobCard/OfferedActions.tsx": "CountdownRows",
  "src/pages/jobs/appliedJobCard/steps/SubmittedStep.tsx": "DeadlineCountdown",
  "src/pages/posts/postedJobCard/steps/DisputedStep.tsx": "DeadlineCountdown",
  "src/pages/jobs/appliedJobCard/DisputedSection.tsx": "DeadlineCountdown",
  "src/pages/posts/PostedJobCard.tsx": "DeadlineCountdown",
  "src/pages/jobs/appliedJobCard/steps/RevisionStep.tsx": "DeadlineCountdown",
  "src/components/dashboard/JobCard.tsx": "useExpiryClock",
};

describe("the inventory: every client clock is one of these (exact)", () => {
  const tracked = execFileSync("git", ["ls-files", "-z", "--", "src"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
  const withClock = tracked.filter((f) => /\bsetNow\(/.test(blankComments(readFileSync(join(ROOT, f), "utf8")))).sort();

  it("reads the source tree (floor)", () => {
    expect(tracked.length).toBeGreaterThan(400);
    expect(withClock.length).toBeGreaterThan(4);
  });
  it("every module with its own clock state is proven here or decided, and no entry is stale", () => {
    const decided = [...PROVEN_PRIMITIVES, ...Object.keys(NOT_PROVEN)].sort();
    expect(withClock).toEqual(decided);
  });
  it.each(Object.entries(NAMED))("%s draws its clock through %s", (file, primitive) => {
    const src = blankComments(readFileSync(join(ROOT, file), "utf8"));
    expect(src).toMatch(new RegExp(`<${primitive}\\b|\\b${primitive}\\(`));
  });
});
