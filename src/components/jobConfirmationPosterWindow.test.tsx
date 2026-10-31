import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Owner, 2026-10-08 (Q1566, "there is no place for me to confirm the job is
 * still on"): the poster's "I'm still on" closed at NOON on the job day, so a
 * same-day 2 PM job had no control after 12:00.
 *
 * The class: the poster may confirm right up to the job's start (no start
 * time: the end of the job day), and not after it.
 *
 * @mutate src/components/JobConfirmation.tsx |     isLiveJob && confirmOpen && (isOwner ? now.getTime() < posterWindowEnd : hoursUntilJob > -24); |     isLiveJob && confirmOpen && hoursUntilJob > (isOwner ? -12 : -24);
 */

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticSuccess: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "update", "eq", "select", "single"]) chain[m] = vi.fn(() => chain);
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return { supabase: chain };
});

import { JobConfirmation } from "./JobConfirmation";
import { requestFaceAction, takeFaceAction } from "./job-card/faceActionRequest";

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
  it("1:00 PM on the day of a 2:00 PM job: I'm still on is there (it closed at noon)", () => {
    at("2032-10-14T18:00:00Z");
    render(poster("14:00:00"));
    expect(screen.getByRole("button", { name: /I'm still on/ })).toBeTruthy();
  });
  it("after the start it is gone", () => {
    at("2032-10-14T19:05:00Z");
    render(poster("14:00:00"));
    expect(screen.queryByRole("button", { name: /I'm still on/ })).toBeNull();
  });
  it("no start time: open all day", () => {
    at("2032-10-14T22:00:00Z");
    render(poster(null));
    expect(screen.getByRole("button", { name: /I'm still on/ })).toBeTruthy();
  });
});

/**
 * Card critique item 1 (owner, 2026-10-23): the collapsed card's "I'm still on" opens the card and leaves a
 * one-shot request; THIS control then opens its own "Confirm the job is still on" dialog, so its gates still decide.
 * @mutate src/components/JobConfirmation.tsx |     if (owed && (openNow \|\| takeFaceAction(jobId, "confirm"))) setShowConfirmDialog(true); |     if (owed) takeFaceAction(jobId, "confirm");
 * @mutate src/components/JobConfirmation.tsx | && Date.now() >= confirmOpensMs(dateNeeded); | ;
 */
describe("the face's confirm request opens this card's own dialog", () => {
  it("a request while the confirm is owed opens 'Confirm the job is still on' (no 'commit', LEAD-CONFIRM-WORDS)", () => {
    at("2032-10-14T18:00:00Z");
    requestFaceAction("job-1", "confirm");
    render(poster("14:00:00"));
    expect(screen.getByText("Confirm the job is still on")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yes, it's still on" })).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/commit/i);
  });
  it("no request, no dialog", () => {
    at("2032-10-14T18:00:00Z");
    render(poster("14:00:00"));
    expect(screen.queryByText("Confirm the job is still on")).toBeNull();
  });
  it("before the confirm opens, a request opens nothing and is not swallowed (the card only takes a confirm it owes)", () => {
    at("2032-10-10T18:00:00Z");
    requestFaceAction("job-1", "confirm");
    render(poster("14:00:00"));
    expect(screen.queryByText("Confirm the job is still on")).toBeNull();
    expect(takeFaceAction("job-1", "confirm")).toBe(true);
  });
});
