/*
 * HOME AND NEEDS YOU ALWAYS AGREE (owner, 2026-10-31, LEAD-NEEDSYOU-MISSING).
 *
 * The owner's "Mow and Weed Eat" job showed "Confirm the job is still on" in
 * Home's Next up while Jobs > Posted > Needs you was empty and the job sat under
 * Waiting. Prod read 2026-10-31 15:39Z (SELECT only): status accepted, date
 * 2026-11-01 09:00, helper_confirmed_at set, poster_confirmed_at 15:31:41Z,
 * helper_dayof_confirmed_at null.
 *
 * Part 1 proves the RULE is shared: for every agreed-job state, at every point
 * of the confirm window, on both sides, Home's to-do list holds a job exactly
 * when the Jobs tab files it under Needs you. Fed one row they cannot disagree.
 *
 * Part 2 is the cause: two screens held two COPIES of the row. JobConfirmation
 * wrote the stamp and told no cache, so Home's to-do (persisted, fresh 60 s)
 * kept the pre-confirm copy. Every client write of a confirm stamp must call
 * recordConfirmInActivityCache( in its success branch, and that helper must
 * move the cached row so the to-do drops at once (real QueryClient).
 */

// @mutate src/components/JobConfirmation.tsx | recordConfirmInActivityCache(jobId, field, confirmedAt); | void 0;
// @mutate src/lib/confirmActivityCache.ts | postedJobs: old.postedJobs.map((j) => (j.id === jobId ? { ...j, [field]: at } : j)) | postedJobs: old.postedJobs
// @mutate src/lib/confirmActivityCache.ts | appliedApps: old.appliedApps.map((a) => (a.job?.id === jobId ? { ...a, job: { ...a.job, [field]: at } } : a)), | appliedApps: old.appliedApps,
// @mutate src/pages/home/homeDashboard/needsYouTodos.ts | postedActivityBucket(j, i.pendingApplicantCounts[j.id] ?? 0) === "needs_you" | postedActivityBucket(j, i.pendingApplicantCounts[j.id] ?? 0) !== "scheduled"

import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";
import { recordConfirmInActivityCache } from "@/lib/confirmActivityCache";
import { queryKeys } from "@/lib/queryKeys";
import { postedActivityBucket, appliedActivityBucket } from "@/components/job-card/activityFilters";
import { deriveNeedsYouTodos } from "@/pages/home/homeDashboard/needsYouTodos";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

const root = join(__dirname, "..", "..");

/** The owner's row (7b1da54b), with the two confirm stamps as the variables. */
const job = (over: Partial<Job> = {}): Job =>
  ({
    id: "7b1da54b",
    title: "Mow and Weed Eat",
    status: "accepted",
    customer_id: "poster",
    helper_id: "helpr",
    date_needed: "2037-11-01",
    start_time: "09:00:00",
    helper_confirmed_at: "2037-10-30T04:11:58Z",
    helper_dayof_confirmed_at: null,
    poster_confirmed_at: null,
    payment_status: "held",
    ...over,
  }) as unknown as Job;
const app = (j: Job): AppliedApp => ({ id: "app-1", job_id: j.id, helper_id: "helpr", status: "accepted", job: j }) as unknown as AppliedApp;
const todosFor = (postedJobs: Job[], appliedApps: AppliedApp[] = []) =>
  deriveNeedsYouTodos({ postedJobs, pendingApplicantCounts: {}, appliedApps, shopOrders: [], backout: new Map() } as never);

afterEach(() => vi.useRealTimers());

describe("one rule: Home's to-do holds a job exactly when Jobs files it under Needs you", () => {
  // Two days out, the window just opened, the owner's 10:25 / 10:35 CT, an hour before, after the start.
  const times = ["2037-10-30T12:00:00Z", "2037-10-31T05:30:00Z", "2037-10-31T15:25:00Z", "2037-10-31T15:35:00Z", "2037-11-01T13:00:00Z", "2037-11-01T14:30:00Z"];
  const stamps = [null, "2037-10-31T15:31:41Z"];
  let cases = 0;
  for (const t of times)
    for (const pc of stamps)
      for (const hc of stamps)
        it(`${t} poster=${pc ? "in" : "-"} helpr=${hc ? "in" : "-"}`, () => {
          vi.useFakeTimers();
          vi.setSystemTime(new Date(t));
          const j = job({ poster_confirmed_at: pc, helper_dayof_confirmed_at: hc } as Partial<Job>);
          const poster = todosFor([j]);
          expect(poster.some((x) => x.id === `p-${j.id}`)).toBe(postedActivityBucket(j) === "needs_you");
          const a = app(j);
          const helpr = todosFor([], [a]);
          expect(helpr.some((x) => x.id === `a-${a.id}`)).toBe(appliedActivityBucket(a) === "needs_you");
          cases++;
        });
  it("covers the whole matrix", () => expect(cases).toBeGreaterThan(20));

  it("the owner's row: Confirm the job is still on before her tap, Waiting (no to-do) after", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2037-10-31T15:35:00Z"));
    expect(todosFor([job()]).map((x) => x.title)).toEqual(["Confirm the job is still on"]);
    expect(postedActivityBucket(job())).toBe("needs_you");
    const after = job({ poster_confirmed_at: "2037-10-31T15:31:41Z" } as Partial<Job>);
    expect(todosFor([after])).toEqual([]);
    expect(postedActivityBucket(after)).toBe("waiting");
  });
});

describe("every client confirm write updates the shared activity cache", () => {
  const writers = trackedFiles("src")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.startsWith("src/test/"))
    .map((f) => ({ f, src: blankComments(readFileSync(join(root, f), "utf8")) }))
    .filter(({ src }) => /\.from\(\s*"jobs"\s*\)[\s\S]{0,200}?\.update\(/.test(src) && /"(poster_confirmed_at|helper_dayof_confirmed_at)"/.test(src));

  it("finds the confirm writers (inventory floor)", () => {
    expect(writers.length).toBeGreaterThan(0);
  });

  it.each(writers.map((w) => [w.f, w.src] as const))("%s calls recordConfirmInActivityCache( after its write succeeds", (_name, src) => {
    const success = src.indexOf("hapticSuccess();");
    expect(success).toBeGreaterThan(-1);
    expect(src.slice(success, success + 400)).toContain("recordConfirmInActivityCache(");
  });

  it("the helper moves the cached row so Home's to-do drops at once, for the poster and for the Helpr", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2037-10-31T15:35:00Z"));
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.activity.posted("poster"), { postedJobs: [job()], applicantCounts: {}, pendingApplicantCounts: {} });
    qc.setQueryData(queryKeys.activity.applied("helpr"), { appliedApps: [app(job())], declinedJobIds: new Set(), helperReviewedJobIds: new Set() });
    expect(todosFor([job()])).toHaveLength(1);
    expect(todosFor([], [app(job())])).toHaveLength(1);

    recordConfirmInActivityCache("7b1da54b", "poster_confirmed_at", "2037-10-31T15:31:41Z", qc);
    const posted = qc.getQueryData<{ postedJobs: Job[] }>(queryKeys.activity.posted("poster"))!;
    expect(todosFor(posted.postedJobs)).toEqual([]);

    recordConfirmInActivityCache("7b1da54b", "helper_dayof_confirmed_at", "2037-10-31T15:36:00Z", qc);
    const applied = qc.getQueryData<{ appliedApps: AppliedApp[] }>(queryKeys.activity.applied("helpr"))!;
    expect(todosFor([], applied.appliedApps)).toEqual([]);
  });
});
