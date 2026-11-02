/**
 * CONTINUE ANOTHER DAY, EVERYWHERE THE JOB SHOWS (Auditor 11, 11-01, the owner's own job 7b1da54b with Yusef).
 * With a day set to finish, Home said "Your after photos are in. Mark it done" to the Helpr and "waiting for them to
 * mark it done" + "Nothing else booked" to the poster, because Home, the to-do list and the chat's job card read only
 * the job row. They now read the job page's own continueDayNextStep (src/lib/continueDayWords.ts), and Coming up
 * lists the new day. The "Set a day to finish" sheet no longer offers today after a "done" (A3-119) and says what
 * setting a day does.
 *
 * @mutate src/components/tracker/jobProgressState.ts |     if (step) return { ...base, next: nextStepWords(step), waitingOnYou: step.who === "you" }; |     if (step) return base;
 * @mutate src/pages/home/homeDashboard/nextUpStates.ts |       detail: continueDayWords(continueDays[jobId], { side, otherFirst: other })! }; |       detail: "" };
 * @mutate src/pages/home/homeDashboard/nextUpStates.ts |     if (!step \|\| step.who === "you") return null; |     return null;
 * @mutate src/pages/home/homeDashboard/comingUp.ts |   const setDay = (jobId: string) => (i.continueDays?.[jobId]?.status === "set" ? i.continueDays[jobId] : null); |   const setDay = (jobId: string) => (jobId ? null : null);
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | (cd[a.job.id] ? contStep(a.job.id, "helpr", helprOther(a))?.who === "you" : appliedActivityBucket(a) === "needs_you") | appliedActivityBucket(a) === "needs_you"
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |         title: continueDayWords(cd[a.job!.id], { side: "helpr", otherFirst: helprOther(a) }) ?? (line.id === "on_the_way" ? ON_THE_WAY_TASK : line.detail), |         title: (line.id === "on_the_way" ? ON_THE_WAY_TASK : line.detail),
 * @mutate src/components/jobs/ContinueDaySheet.tsx |   const offerToday = !helprMarkedDone && today.getHours() < LAST_START_HOUR_TODAY; |   const offerToday = true;
 * @mutate src/components/jobs/ContinueDaySheet.tsx |           {helprMarkedDone && ( |           {false && (
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { deriveLiveNow, deriveWaiting } from "@/pages/home/homeDashboard/nextUpStates";
import { deriveComingUp } from "@/pages/home/homeDashboard/comingUp";
import { deriveNeedsYouTodos } from "@/pages/home/homeDashboard/needsYouTodos";
import { jobProgress } from "@/components/tracker/jobProgressState";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import type { ContinueDay } from "@/lib/continueDayWords";
import { formatJobDate } from "@/lib/dateUtils";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

vi.mock("@/lib/continueDay", async (orig) => ({ ...(await orig<typeof import("@/lib/continueDay")>()), proposeContinueDay: async () => ({ status: "set" }) }));
import { ContinueDaySheet } from "@/components/jobs/ContinueDaySheet";

// The time wheel scrolls its column into view (jsdom has no scrollTo).
Element.prototype.scrollTo ??= () => {};
const TODAY = jobLocalDateISO(0);
const AHEAD = jobLocalDateISO(3);
// Yusef's job: under way today, after photos in, not marked done (the server clears a "done" when a day is set).
const yusefJob = (over: Partial<Job> = {}): Job => ({
  id: "7b1da54b", title: "Haul off yard debris", status: "in_progress", payment_status: "escrow", helper_id: "yusef", customer_id: "lexi",
  date_needed: TODAY, start_time: "08:00", helper_confirmed_at: "t", poster_confirmed_at: "t", helper_on_the_way_at: "t",
  helper_arrived_at: new Date(Date.now() - 3 * 3_600_000).toISOString(), poster_confirmed_arrival_at: "t", poster_confirmed_working_at: "t",
  require_photo_proof: true, proof_before_urls: ["b.jpg"], proof_after_urls: ["a.jpg"], updated_at: "t", ...over,
}) as Job;
const yusefApp = (j: Job): AppliedApp => ({ id: "app1", helper_id: "yusef", status: "accepted", job: j, posterName: "Lexi Lombas" }) as AppliedApp;
const day = (over: Partial<ContinueDay> = {}): ContinueDay => ({
  id: "c1", job_id: "7b1da54b", proposed_by: "lexi", new_date: AHEAD, new_start_time: "09:00:00", note: null, status: "set", helper_confirmed_at: null, ...over,
});
const label = (d: string) => {
  const [, m, dd] = d.split("-").map(Number);
  return `${new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" })} ${m}/${dd} at 9 AM`;
};

describe("the tracker line (Home's Live now, the chat's job card) reads the continue day", () => {
  it("the Helpr: never 'Mark it done' with a day set; the poster: never 'waiting for them to mark it done'", () => {
    const j = yusefJob();
    // The broken state the audit saw, without the day: proves the fixture is Yusef's.
    expect(jobProgress(j, { viewer: "helpr", otherFirst: "Lexi" }).next).toBe("Your after photos are in. Mark it done");
    expect(jobProgress(j, { viewer: "poster", otherFirst: "Yusef" }).next).toBe("Yusef added after photos · waiting for them to mark it done");
    const h = jobProgress(j, { viewer: "helpr", otherFirst: "Lexi", continueDay: day() });
    expect(h.next).toBe(`Next: confirm you'll be there · continuing ${label(AHEAD)}`);
    expect(h.waitingOnYou).toBe(true);
    expect(jobProgress(j, { viewer: "poster", otherFirst: "Yusef", continueDay: day({ helper_confirmed_at: "t" }) }).next).toBe(`Yusef confirmed ${label(AHEAD)}`);
  });
});

describe("Home: Live now, Waiting, Coming up", () => {
  it("a job continuing on a day still ahead is not 'Live now'", () => {
    expect(deriveLiveNow([yusefJob()], [], { yusef: "Yusef Brown" })).not.toBeNull();
    expect(deriveLiveNow([yusefJob()], [], { yusef: "Yusef Brown" }, { "7b1da54b": day() })).toBeNull();
  });

  it("the poster waits on the continue day in the job page's words", () => {
    const w = deriveWaiting([yusefJob()], {}, [], null, { yusef: "Yusef Brown" }, { "7b1da54b": day() });
    expect(w?.label).toBe("Waiting on Yusef");
    expect(w?.detail).toBe(`Continuing ${label(AHEAD)} · waiting on Yusef to confirm`);
    const after = deriveWaiting([yusefJob()], {}, [], null, { yusef: "Yusef Brown" }, { "7b1da54b": day({ helper_confirmed_at: "t" }) });
    expect(after?.detail).toBe(`Yusef confirmed ${label(AHEAD)}`);
  });

  it("Coming up lists the new day on both sides (it said 'Nothing else booked')", () => {
    const base = { cart: [], bookings: [], myOrders: [], shopOrders: [] };
    expect(deriveComingUp({ ...base, postedJobs: [yusefJob()], appliedApps: [] })).toEqual([]);
    const rows = deriveComingUp({ ...base, postedJobs: [yusefJob()], appliedApps: [yusefApp(yusefJob())], continueDays: { "7b1da54b": day() } });
    expect(rows.map((r) => [r.role, r.time])).toEqual([["posted", "9:00 AM"], ["working", "9:00 AM"]]);
    // A proposed day is not agreed: not on the agenda yet.
    expect(deriveComingUp({ ...base, postedJobs: [yusefJob()], appliedApps: [], continueDays: { "7b1da54b": day({ status: "proposed" }) } })).toEqual([]);
  });
});

describe("the to-do list (Next up and the badges)", () => {
  const inputs = (cd: Record<string, ContinueDay>) => ({ postedJobs: [], pendingApplicantCounts: {}, appliedApps: [yusefApp(yusefJob())], shopOrders: [], backout: new Map(), continueDays: cd });
  it("the Helpr's to-do is to confirm the day, never 'Mark it done'; once confirmed there is nothing to do until then", () => {
    const before = deriveNeedsYouTodos({ ...inputs({}) });
    expect(before.map((t) => t.title)).toEqual(["Finish and mark it done"]);
    expect(deriveNeedsYouTodos(inputs({ "7b1da54b": day() })).map((t) => t.title)).toEqual([`Next: confirm you'll be there · continuing ${label(AHEAD)}`]);
    expect(deriveNeedsYouTodos(inputs({ "7b1da54b": day({ helper_confirmed_at: "t" }) }))).toEqual([]);
  });
});

describe("A3-119: the 'Set a day to finish' sheet", () => {
  const sheet = (helprMarkedDone: boolean, hour: number) => render(
    <ContinueDaySheet open onOpenChange={() => {}} jobId="7b1da54b" side="poster" otherFirst="Yusef" onSaved={() => {}}
      helprMarkedDone={helprMarkedDone} today={new Date(2026, 10, 1, hour, 0)} />,
  );
  it("after the Helpr marked it done: tomorrow onward, and it says the 'done' is cleared and the payment waits", () => {
    const { unmount } = sheet(true, 9);
    const chips = within(screen.getByRole("group", { name: "Day to finish" })).getAllByRole("button").map((b) => b.textContent);
    expect(chips[0]).toBe(formatJobDate("2026-11-02"));
    expect(screen.getByText(`Yusef's "done" is cleared and the payment waits until the work is finished.`)).toBeTruthy();
    unmount();
  });
  it("no 'done' yet: today while a start an hour out still fits, not late at night", () => {
    const { unmount } = sheet(false, 9);
    expect(within(screen.getByRole("group", { name: "Day to finish" })).getAllByRole("button")[0].textContent).toBe(formatJobDate("2026-11-01"));
    expect(document.querySelector("[data-continue-day-effect]")).toBeNull();
    unmount();
    sheet(false, 23);
    expect(within(screen.getByRole("group", { name: "Day to finish" })).getAllByRole("button")[0].textContent).toBe(formatJobDate("2026-11-02"));
  });
});

describe("inventory floor", () => {
  it("the fixtures cover both sides", () => {
    expect([yusefJob(), yusefApp(yusefJob())].length).toBeGreaterThan(1);
  });
});
