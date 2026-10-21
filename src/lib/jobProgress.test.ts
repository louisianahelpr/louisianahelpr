// Board 2 (deal-room chat) and the chat halves of 59, 61, 62, 63, now the ONE tracker (owner, 2026-10-21):
// the stage is named from the job's own stamps and never runs ahead of them, and the deal card never writes.
// @mutate src/lib/jobProgress.ts | !!(job.poster_confirmed_working_at \|\| job.poster_confirmed_arrival_at \|\| job.helper_arrival_verified_at) | !!(job.poster_confirmed_working_at \|\| job.poster_confirmed_arrival_at \|\| job.helper_arrival_verified_at \|\| job.helper_arrived_at)
// @mutate src/lib/jobProgress.ts | if (job.helper_id && o.threadHelprId && job.helper_id !== o.threadHelprId) { | if (false) {
// @mutate src/lib/jobProgress.ts |     if (!Number.isNaN(opens) && now < opens) { |     if (false) {
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jobProgress, JOB_PROGRESS_STEPS, type ProgressJob } from "@/lib/jobProgress";
import { blankComments } from "@/test/helpers/blankNonCode";

const ME = "me";
const JO = "jolie";
const base: ProgressJob = { status: "open", helper_id: null, payment_status: "unpaid" };
const NOW = new Date("2037-10-21T15:00:00Z"); // Wed 10:00 AM in Louisiana (2037: a fixed day far out, jobDayFixtureTimezone)
const poster = (j: Partial<ProgressJob>, app: string | null = null) =>
  jobProgress({ ...base, helper_confirmed_at: j.helper_id ? "t" : null, ...j }, { viewer: "poster", otherFirst: "Jolie", threadHelprId: JO, application: app, now: NOW });
const helpr = (j: Partial<ProgressJob>, app: string | null = null) =>
  jobProgress({ ...base, helper_confirmed_at: j.helper_id ? "t" : null, ...j }, { viewer: "helpr", otherFirst: "Jolie", threadHelprId: ME, application: app, now: NOW });

describe("jobProgress (the one tracker)", () => {
  it("has the four board steps", () => {
    expect([...JOB_PROGRESS_STEPS]).toEqual(["Posted", "Hired", "Working", "Done"]);
  });

  it("board 2/59: open job with a pending application", () => {
    expect(poster({}, "pending")).toMatchObject({ step: 1, word: "Posted", next: "Jolie applied" });
    expect(helpr({}, "pending")).toMatchObject({ step: 1, next: "You applied. Waiting on Jolie" });
  });

  it("board 61: someone else was hired shows Filled, never held money", () => {
    const s = helpr({ status: "accepted", helper_id: "other", payment_status: "escrow" }, "rejected");
    expect(s).toMatchObject({ step: 1, word: "Filled", next: "Jolie hired someone else", held: false });
    expect(poster({ status: "accepted", helper_id: "other", payment_status: "escrow" })).toMatchObject({ word: "Filled", next: "You hired someone else" });
  });

  it("an offer is not a booking", () => {
    expect(poster({ status: "accepted", helper_id: JO, helper_confirmed_at: null })).toMatchObject({ step: 1, word: "Offered", next: "Waiting on Jolie to accept the offer" });
  });

  it("Accepted, before the day-before window: says when confirming opens (the server's rule)", () => {
    // Job Fri 2037-10-23 9:00; the window opens Thu 2037-10-22 00:00 Louisiana time.
    const j = { status: "accepted", helper_id: JO, date_needed: "2037-10-23", start_time: "09:00" };
    expect(poster(j)).toMatchObject({ step: 2, word: "Hired", next: "Jolie confirms the day before. Opens Thu 12:00 AM" });
    expect(helpr({ ...j, helper_id: ME })).toMatchObject({ step: 2, next: "Confirm the day before. Opens Thu 12:00 AM" });
  });

  it("window open: who still owes the confirm, and by when", () => {
    const j = { status: "accepted", helper_id: JO, date_needed: "2037-10-22", start_time: "09:00" };
    expect(poster(j)).toMatchObject({ next: "Tap I'm still on to confirm" });
    expect(poster({ ...j, poster_confirmed_at: "t" })).toMatchObject({ next: "Waiting on Jolie to confirm by Thu 7:00 AM" });
    expect(poster({ ...j, poster_confirmed_at: "t", helper_dayof_confirmed_at: "t" })).toMatchObject({ next: "You're both confirmed. Jolie taps On my way when they leave" });
  });

  it("board 62: on the way and arrived are Hired, not Working", () => {
    expect(poster({ status: "in_progress", helper_id: JO, helper_on_the_way_at: "t" })).toMatchObject({ step: 2, next: "Jolie is on the way" });
    expect(poster({ status: "in_progress", helper_id: JO, helper_on_the_way_at: "t", helper_arrived_at: "t" })).toMatchObject({ step: 2, next: "Jolie arrived. Confirm they've arrived" });
  });

  it("board 63: Working needs arrival evidence beyond the Helpr's own claim", () => {
    expect(poster({ status: "in_progress", helper_id: JO, helper_arrived_at: "t", poster_confirmed_arrival_at: "t", payment_status: "escrow" }))
      .toMatchObject({ step: 3, word: "Working", next: "Jolie is working", held: true });
    expect(helpr({ status: "in_progress", helper_id: ME, helper_arrival_verified_at: "t" })).toMatchObject({ step: 3, word: "Working" });
  });

  it("held only while the payment is in escrow", () => {
    expect(poster({ status: "accepted", helper_id: JO, payment_status: "escrow" }).held).toBe(true);
    expect(poster({ status: "completed", helper_id: JO, payment_status: "released" })).toMatchObject({ step: 4, held: false });
  });

  it("off the happy path there is no step bar", () => {
    expect(poster({ status: "cancelled" }).step).toBeNull();
    expect(poster({ status: "in_progress", helper_id: JO, has_active_dispute: true }).step).toBeNull();
    expect(helpr({}, "rejected").step).toBeNull();
  });
});

describe("DealCard never writes", () => {
  it("reads jobs/applications only; its button only navigates", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../components/messages/chatView/DealCard.tsx"), "utf8"));
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    const rpcs = [...src.matchAll(/\.rpc\(\s*"([^"]+)"/g)].map((m) => m[1]);
    // Read-only RPCs only: the applicant's own jobs, and the person facts for the header.
    expect(rpcs.sort()).toEqual(["get_jobs_for_my_applications", "get_public_profile_stats"]);
    // No address column is ever selected (spec v2 §1.6: no address before a deal).
    expect(src).not.toMatch(/[",]location[,"]|latitude|longitude|zip_code/);
    expect(src.length).toBeGreaterThan(1000);
  });
});

// Lead 2026-10-21: while the card is pinned, the header names the PERSON (the
// You card's real-or-absent facts) instead of repeating the job title.
// @mutate src/components/messages/ChatHeader.tsx | {dealPinned && personFacts ? personFacts : activeConvo.jobTitle} | {activeConvo.jobTitle}
describe("chat header while the deal card is pinned", () => {
  it("shows the person's facts, not the job title, and drops the status chip", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../components/messages/ChatHeader.tsx"), "utf8"));
    // Falls back to the job title while the facts load or if they fail (review note 5).
    expect(src).toContain("{dealPinned && personFacts ? personFacts : activeConvo.jobTitle}");
    expect(src).toMatch(/activeConvo\.jobStatus && !inboxVisible && !dealPinned/);
    expect(src).toMatch(/usePersonFacts\(dealPinned \? activeConvo\.otherUserId : null\)/);
  });
});
