import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Owner, 2026-10-08 (Q1566, "there is no place for me to confirm the job is
 * still on"): the poster's "I'm Still On" closed at NOON on the job day, so a
 * same-day 2 PM job had no control after 12:00.
 *
 * The class: the poster may confirm right up to the job's start (no start
 * time: the end of the job day), and not after it.
 *
 * @mutate src/components/JobConfirmation.tsx |     isLiveJob && hoursUntilJob <= 24 && (isOwner ? now.getTime() < posterWindowEnd : hoursUntilJob > -24); |     isLiveJob && hoursUntilJob <= 24 && hoursUntilJob > (isOwner ? -12 : -24);
 */

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticSuccess: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "update", "eq", "select", "single"]) chain[m] = vi.fn(() => chain);
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return { supabase: chain };
});

import { JobConfirmation } from "./JobConfirmation";

// 2:00 PM Central on 2032-10-14 = 19:00Z (CDT).
const poster = (startTime: string | null) => (
  <JobConfirmation
    jobId="job-1"
    isOwner
    isHelper={false}
    posterConfirmedAt={null}
    helperConfirmedAt="2032-10-13T12:00:00Z"
    helperDayofConfirmedAt={null}
    dateNeeded="2032-10-14"
    startTime={startTime}
    jobStatus="accepted"
    embedded
  />
);
const at = (iso: string) => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso)); };
afterEach(() => vi.useRealTimers());

describe("the poster can say the job is still on until it starts", () => {
  it("1:00 PM on the day of a 2:00 PM job: I'm Still On is there (it closed at noon)", () => {
    at("2032-10-14T18:00:00Z");
    render(poster("14:00:00"));
    expect(screen.getByRole("button", { name: /I'm Still On/ })).toBeTruthy();
  });
  it("after the start it is gone", () => {
    at("2032-10-14T19:05:00Z");
    render(poster("14:00:00"));
    expect(screen.queryByRole("button", { name: /I'm Still On/ })).toBeNull();
  });
  it("no start time: open all day", () => {
    at("2032-10-14T22:00:00Z");
    render(poster(null));
    expect(screen.getByRole("button", { name: /I'm Still On/ })).toBeTruthy();
  });
});
