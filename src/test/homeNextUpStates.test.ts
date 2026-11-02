/**
 * Home's Live now and Waiting states (boards 165 and 83), on the REAL bucket
 * and status-line rules (no mocks): a stale in_progress row is overdue, not
 * live; a job waiting on someone else names who.
 *
 * @mutate src/pages/home/homeDashboard/nextUpStates.ts |   const live = (j: Job \| null \| undefined): j is Job => !!j && j.status === "in_progress" && !jobIsOverdue(j); |   const live = (j: Job \| null \| undefined): j is Job => !!j && j.status === "in_progress";
 * @mutate src/pages/home/homeDashboard/nextUpStates.ts |       label: who ? `Waiting on ${who}` : "Waiting on a reply", |       label: "Waiting",
 * @mutate src/pages/home/homeDashboard/nextUpStates.ts |   ].sort((x, y) => (y.sort > x.sort ? 1 : y.sort < x.sort ? -1 : 0)); |   ];
 * @mutate src/pages/home/homeDashboard/nextUpStates.ts |       label: j.helper_id ? `Waiting on ${firstOf(hiredName(j, helperNames)) ?? "your Helpr"}` : "Waiting on Helprs", |       label: j.helper_id ? "Waiting on your Helpr" : "Waiting on Helprs",
 * @mutate src/pages/home/homeDashboard/nextUpStates.ts |       detail: posterStatusLine(j, n, new Date(), undefined, false, hiredName(j, helperNames)).detail, |       detail: posterStatusLine(j, n).detail,
 * @mutate src/pages/home/homeDashboard/nextUpStates.ts |       detail: posterStatusLine(j, 0, new Date(), undefined, false, hiredName(j, helperNames)).detail, |       detail: posterStatusLine(j).detail,
 */
import { describe, it, expect } from "vitest";
import { deriveLiveNow, deriveWaiting } from "@/pages/home/homeDashboard/nextUpStates";
import { deriveNeedsYouTodos, REVIEW_WORK_ACTION } from "@/pages/home/homeDashboard/needsYouTodos";
import { JOB_PROGRESS_STEPS } from "@/components/tracker/jobProgressState";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

const job = (over: Partial<Job>): Job =>
  ({
    id: "j", title: "Mow the lawn", status: "open", payment_status: "escrow", helper_id: null, date_needed: "2099-01-02",
    updated_at: "2099-01-01T00:00:00Z", helper_arrived_at: null, helper_on_the_way_at: null, ...over,
  }) as Job;
const app = (over: Partial<AppliedApp>, j: Partial<Job>): AppliedApp =>
  ({ id: "a", helper_id: "me", status: "pending", job: job(j), ...over }) as AppliedApp;

describe("Live now (board 165)", () => {
  it("the steps are the one tracker's eight, and a live job with a confirmed arrival sits on Working", () => {
    expect([...JOB_PROGRESS_STEPS]).toEqual(["Posted", "Offered", "Hired", "Confirmed", "On the way", "Arrived", "Working", "Done"]);
    const l = deriveLiveNow([job({ id: "p1", status: "in_progress", helper_id: "h", helper_confirmed_at: "t", poster_confirmed_arrival_at: "t" })], []);
    expect(l?.progress.stage).toBe(6);
    expect(l?.progress.next).toBe("Your Helpr is working"); // the Working step has begun (workHasBegun, lead 2026-10-31)
    expect(l?.side).toBe("You hired");
  });

  it("an in_progress job whose day has passed is overdue, not live", () => {
    expect(deriveLiveNow([job({ status: "in_progress", helper_id: "h", date_needed: "2020-01-01" })], [])).toBeNull();
  });

  it("the Helpr's side: only a job I was hired on, and the latest started wins", () => {
    const mine = app({ id: "a1", helper_id: "me" }, { id: "w1", status: "in_progress", helper_id: "me", helper_arrived_at: "2099-01-02T10:00:00Z" });
    const earlier = job({ id: "p2", status: "in_progress", helper_id: "h", helper_arrived_at: "2099-01-02T09:00:00Z" });
    const notMine = app({ id: "a2", helper_id: "me" }, { id: "w2", status: "in_progress", helper_id: "someone-else" });
    expect(deriveLiveNow([], [notMine])).toBeNull();
    expect(deriveLiveNow([], [mine])?.side).toBe("You're working");
    // Posted rows come first in the list; the later start still wins.
    expect(deriveLiveNow([earlier], [mine])?.jobId).toBe("w1");
  });

  it("nothing happening: null", () => {
    expect(deriveLiveNow([job({ status: "open" }), job({ status: "completed" })], [])).toBeNull();
  });
});

describe("Waiting (board 83)", () => {
  it("an application nobody has answered names the poster", () => {
    const w = deriveWaiting([], {}, [{ ...app({}, { id: "o1", status: "open" }), posterName: "Travis Boudreaux" }]);
    expect(w?.label).toBe("Waiting on Travis");
    expect(w?.title).toBe("You applied · Mow the lawn");
    expect(w?.detail).toBe("Travis hasn't replied yet");
  });

  it("an open job of mine with no applicants waits on Helprs, in the card's own words", () => {
    const w = deriveWaiting([job({ id: "p1", status: "open" })], { p1: 0 }, []);
    expect(w?.label).toBe("Waiting on Helprs");
    expect(w?.title).toBe("Mow the lawn");
    expect(w?.detail.length).toBeGreaterThan(3);
  });

  it("nothing waiting: null (Home then says it is all caught up)", () => {
    expect(deriveWaiting([job({ status: "completed" })], {}, [])).toBeNull();
  });
});

// JA-38 (audit 11-01): Home's Next up said "Your Helpr is on the way" while the job page and card say "Yusef is on the way".
describe("the poster's Home lines name their Helpr", () => {
  const names = { h1: "Yusef Bourgeois" };
  it("Waiting: 'Waiting on Yusef' and the card's named line", () => {
    const w = deriveWaiting([job({ id: "p3", status: "in_progress", helper_id: "h1", helper_confirmed_at: "t", helper_on_the_way_at: "2099-01-02T08:00:00Z" })], {}, [], null, names);
    expect(w?.label).toBe("Waiting on Yusef");
    expect(w?.detail).toBe("Yusef is on the way");
  });
  it("Live now: the card's named line", () => {
    const l = deriveLiveNow([job({ id: "p4", status: "in_progress", helper_id: "h1", helper_confirmed_at: "t", helper_on_the_way_at: "2099-01-02T08:00:00Z" })], [], names);
    expect(l?.detail).toMatch(/^Yusef /);
  });
  it("no name known: the neutral words stay", () => {
    const w = deriveWaiting([job({ id: "p5", status: "in_progress", helper_id: "h9", helper_confirmed_at: "t", helper_on_the_way_at: "2099-01-02T08:00:00Z" })], {}, [], null, names);
    expect(w?.label).toBe("Waiting on your Helpr");
  });
});

// A3-83 (audit 11-01): at "Yusef marked it done" Home showed the job in Live now AND Next up, both "Open job",
// and neither said what to do. Live now steps aside once the work is submitted; Next up's button names the step.
// @mutate src/pages/home/homeDashboard/nextUpStates.ts | j.status === "in_progress" && !submissionAwaitingPoster(j) && !jobIsOverdue(j); | j.status === "in_progress" && !jobIsOverdue(j);
// @mutate src/pages/home/homeDashboard/needsYouTodos.ts | POSTER_REVIEW_STEPS.has(line.id) ? REVIEW_WORK_ACTION : "Open job" | "Open job"
describe("done-approve: one row, and it says what to do (A3-83)", () => {
  const submitted = { id: "d1", status: "in_progress", helper_id: "h", helper_confirmed_at: "t", poster_confirmed_arrival_at: "t", helper_completed_at: "2026-11-01T15:00:00Z" } as const;
  it("a job the Helpr marked done is not Live now; one sent back for a fix still is", () => {
    expect(deriveLiveNow([job(submitted)], [])).toBeNull();
    expect(deriveLiveNow([job({ ...submitted, revision_requested_at: "2026-11-01T16:00:00Z" })], [])?.jobId).toBe("d1");
  });
  it("Next up's button for the approve step is 'Review work', opening the job", () => {
    const todos = deriveNeedsYouTodos({ postedJobs: [job(submitted)], pendingApplicantCounts: {}, appliedApps: [], shopOrders: [], backout: new Map() });
    expect(todos.length).toBeGreaterThan(0);
    expect(todos[0]).toMatchObject({ action: REVIEW_WORK_ACTION, to: "/jobs/d1" });
  });
});
