/**
 * A HELPR AT WORK IS "WAITING", NOT A TO-DO (lead 10-31, on b49's finding: Home showed a poster's in-progress job
 * twice, Live now AND Next up "Your Helpr is working · Open job", the Jobs tile said "1 need you" and the Explore
 * badge 1, while the job card's own eyebrow said Waiting).
 *
 * Holds, on the REAL bucket, status-line and Home rules (no mocks):
 *  - an in-progress job counts as needing the poster ONLY while a poster move is due: confirm an arrival the Helpr
 *    claimed, a start time passed with no check-in, approve submitted work, or a day gone past; otherwise Waiting;
 *  - the bucket agrees with the card's own line for every in-progress state (the card's eyebrow is the bucket word);
 *  - so Home's to-dos (Jobs count, Explore badge, Next up) leave a working job out, and Next up's Waiting line never
 *    repeats the job Live now shows;
 *  - in the Jobs list a job under way leads its group (Waiting), above open listings.
 *
 * @mutate src/components/job-card/activityFilters.ts |     return posterMoveDueWhileInProgress(j, now) ? "needs_you" : "waiting"; |     return "needs_you";
 * @mutate src/components/job-card/activityFilters.ts |   if (!j.poster_confirmed_arrival_at && (j.helper_arrived_at \|\| arrivalNearMissWithin12h(j, now.getTime()))) return true; |   if (!j.poster_confirmed_arrival_at && j.helper_arrived_at && false) return true;
 * @mutate src/components/job-card/activityFilters.ts |   return !(start && start.getTime() > now.getTime()); |   return false;
 * @mutate src/components/job-card/activityFilters.ts |   if (j.is_group_job) return false; |   if (j.is_group_job) return true;
 * @mutate src/components/job-card/activityFilters.ts |  \|\| Number(b.status === "in_progress") - Number(a.status === "in_progress")), | ),
 * @mutate src/pages/home/homeDashboard/nextUpStates.ts |     if (j.id === liveJobId \|\| postedActivityBucket(j, n) !== "waiting") continue; |     if (postedActivityBucket(j, n) !== "waiting") continue;
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts | deriveWaiting(pj, posted.pendingApplicantCounts ?? {}, aa, liveNow?.jobId ?? null, | deriveWaiting(pj, posted.pendingApplicantCounts ?? {}, aa, null,
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook } from "@testing-library/react";
import { postedActivityBucket, useActivityFilters } from "@/components/job-card/activityFilters";
import { BUCKET_LABEL } from "@/lib/activityBuckets";
import { derivePosterWait, posterStatusLine, type PosterWait } from "@/components/job-card/jobStatusLine";
import { deriveNeedsYouTodos } from "@/pages/home/homeDashboard/needsYouTodos";
import { deriveLiveNow, deriveWaiting } from "@/pages/home/homeDashboard/nextUpStates";
import { blankComments } from "./helpers/blankNonCode";
import { jobLocalDateISO } from "./helpers/jobLocalDate";
import { pinJobClock } from "./helpers/pinJobClock";
import type { Job } from "@/components/job-card/activityConstants";

const FAR = "2099-01-02";
const job = (over: Partial<Job>): Job =>
  ({
    id: "j", title: "Haul off an old couch", status: "in_progress", payment_status: "escrow", helper_id: "h",
    customer_id: "me", date_needed: FAR, start_time: null, created_at: "2098-12-01T00:00:00Z", updated_at: "2099-01-01T00:00:00Z",
    helper_confirmed_at: "2098-12-30T00:00:00Z", helper_on_the_way_at: null, helper_arrived_at: null,
    poster_confirmed_arrival_at: null, poster_confirmed_working_at: null, helper_completed_at: null, poster_completed_at: null,
    revision_requested_at: null, is_group_job: false, ...over,
  }) as Job;

// The poster's "you" lines while work runs: each is a move the poster can make now.
const POSTER_MOVES = new Set<PosterWait>(["confirm_arrival", "started_no_checkin", "approve"]);

// Every in-progress state the poster can see, with whose move it is. The clock: the job day is far ahead except
// where a case sets it, so nothing here is overdue unless it says so.
const CASES: Array<{ name: string; row: Partial<Job>; bucket: "needs_you" | "waiting" }> = [
  { name: "on the way", row: { helper_on_the_way_at: "2099-01-02T09:00:00Z" }, bucket: "waiting" },
  { name: "arrived, poster has not confirmed", row: { helper_on_the_way_at: "t", helper_arrived_at: "2099-01-02T09:30:00Z" }, bucket: "needs_you" },
  { name: "arrival confirmed, at the job", row: { helper_on_the_way_at: "t", helper_arrived_at: "t", poster_confirmed_arrival_at: "t" }, bucket: "waiting" },
  { name: "working, confirmed", row: { helper_on_the_way_at: "t", helper_arrived_at: "t", poster_confirmed_arrival_at: "t", poster_confirmed_working_at: "t" }, bucket: "waiting" },
  { name: "arrival confirmed by the poster with no Helpr tap", row: { poster_confirmed_arrival_at: "t" }, bucket: "waiting" },
  { name: "started by the clock, start still ahead", row: { start_time: "09:00" }, bucket: "waiting" },
  { name: "work marked done, waiting for approval", row: { helper_arrived_at: "t", poster_confirmed_arrival_at: "t", helper_completed_at: "2099-01-02T12:00:00Z" }, bucket: "needs_you" },
  { name: "a crew underway", row: { is_group_job: true, helper_id: null }, bucket: "waiting" },
];

describe("an in-progress job is the poster's to-do only while a poster move is due", () => {
  for (const c of CASES) {
    it(`${c.name}: ${c.bucket}`, () => {
      const j = job(c.row);
      expect(postedActivityBucket(j, 0)).toBe(c.bucket);
      // The bucket and the card's own line agree: a poster move is due exactly when the line is one.
      const id = derivePosterWait(j, 0);
      expect(POSTER_MOVES.has(id), id).toBe(c.bucket === "needs_you");
      // The card's eyebrow is the bucket's word whenever the line does not carry its own.
      const line = posterStatusLine(j, 0);
      if (c.bucket === "waiting") expect(line.eyebrow, id).toBe(BUCKET_LABEL.waiting);
    });
  }

  it("a start time that has passed with nobody checked in is the poster's move (Report no-show)", () => {
    // Noon in Louisiana and the job's day in Central: the runner's own (UTC) calendar day turned this red on
    // CI after 7 PM Central (train 9, 10-31), when "today" was already tomorrow in UTC.
    pinJobClock();
    const now = new Date();
    const j = job({ date_needed: jobLocalDateISO(0), start_time: "00:00" });
    expect(derivePosterWait(j, 0, now)).toBe("started_no_checkin");
    expect(postedActivityBucket(j, 0, now)).toBe("needs_you");
    vi.useRealTimers();
  });

  it("a near-miss arrival in the last 12 hours is an arrival to confirm, like the ladder's", () => {
    const j = job({ helper_on_the_way_at: "t", helper_arrival_near_miss_at: new Date(Date.now() - 3_600_000).toISOString() } as Partial<Job>);
    expect(derivePosterWait(j, 0)).toBe("confirm_arrival");
    expect(postedActivityBucket(j, 0)).toBe("needs_you");
    const old = job({ helper_on_the_way_at: "t", helper_arrival_near_miss_at: new Date(Date.now() - 13 * 3_600_000).toISOString() } as Partial<Job>);
    expect(postedActivityBucket(old, 0)).toBe("waiting");
  });
});

describe("Home: a working job is Live now, never a to-do, and never named twice", () => {
  const working = job({ id: "w1", helper_on_the_way_at: "t", helper_arrived_at: "2099-01-02T09:00:00Z", poster_confirmed_arrival_at: "t" });
  const open = job({ id: "o1", title: "Mow the lawn", status: "open", helper_id: null, helper_confirmed_at: null });

  it("the to-do list (Jobs count, Explore badge, Next up) leaves it out", () => {
    const todos = deriveNeedsYouTodos({ postedJobs: [working], pendingApplicantCounts: {}, appliedApps: [], shopOrders: [], backout: new Map() });
    expect(todos).toEqual([]);
    // An arrival to confirm is still a to-do.
    const arrived = job({ id: "a1", helper_on_the_way_at: "t", helper_arrived_at: "t" });
    expect(deriveNeedsYouTodos({ postedJobs: [arrived], pendingApplicantCounts: {}, appliedApps: [], shopOrders: [], backout: new Map() }).map((t) => t.id)).toEqual(["p-a1"]);
  });

  it("Live now shows it; Next up's Waiting names the next job, not the live one again", () => {
    const live = deriveLiveNow([working, open], []);
    expect(live?.jobId).toBe("w1");
    expect(deriveWaiting([working, open], { o1: 0 }, [], live!.jobId)?.jobId).toBe("o1");
    // Alone, nothing else is waiting: Next up has no second card for it.
    expect(deriveWaiting([working], {}, [], "w1")).toBeNull();
  });

  it("useHomeSummary hands deriveWaiting the live job", () => {
    const src = blankComments(readFileSync(resolve(process.cwd(), "src/pages/home/homeDashboard/useHomeSummary.ts"), "utf8"));
    expect(src).toContain("deriveWaiting(pj, posted.pendingApplicantCounts ?? {}, aa, liveNow?.jobId ?? null,");
  });
});

describe("the Jobs list: a job under way leads Waiting", () => {
  it("in the Waiting filter the working job comes before open listings, in either incoming order", () => {
    const working = job({ id: "w1", helper_on_the_way_at: "t", helper_arrived_at: "t", poster_confirmed_arrival_at: "t" });
    const openA = job({ id: "o1", status: "open", helper_id: null, helper_confirmed_at: null });
    const openB = job({ id: "o2", status: "open", helper_id: null, helper_confirmed_at: null });
    const { result } = renderHook(() =>
      useActivityFilters({ postedJobs: [openA, openB, working], appliedApps: [], statusFilter: "waiting", searchQuery: "", userId: "me", pendingApplicantCounts: {} }),
    );
    const ids = result.current.filteredPostedJobs.map((j) => j.id);
    expect(ids.length).toBeGreaterThan(2);
    expect(ids).toEqual(["w1", "o1", "o2"]);
  });
});
