// Board 2 (deal-room chat) and the chat halves of 59, 61, 62, 63: the pinned
// card names the stage from the job's own stamps and never runs ahead of the
// tracker, and the card itself never writes.
// @mutate src/components/messages/chatView/dealStage.ts | !!(job.poster_confirmed_working_at \|\| job.poster_confirmed_arrival_at \|\| job.helper_arrival_verified_at) | !!(job.poster_confirmed_working_at \|\| job.poster_confirmed_arrival_at \|\| job.helper_arrival_verified_at \|\| job.helper_arrived_at)
// @mutate src/components/messages/chatView/dealStage.ts | if (job.helper_id !== helprInThread) { | if (false) {
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dealStage, DEAL_STEPS, type DealJob } from "./dealStage";
import { blankComments } from "@/test/helpers/blankNonCode";

const ME = "me";
const JO = "jolie";
const base: DealJob = { status: "open", helper_id: null, payment_status: "unpaid" };
const poster = (j: Partial<DealJob>, app: string | null = null) => dealStage({ ...base, ...j }, true, JO, ME, app, "Jolie");
const helpr = (j: Partial<DealJob>, app: string | null = null) => dealStage({ ...base, ...j }, false, JO, ME, app, "Jolie");

describe("dealStage", () => {
  it("has the four board steps", () => {
    expect([...DEAL_STEPS]).toEqual(["Posted", "Hired", "Working", "Done"]);
  });

  it("board 2/59: open job with a pending application", () => {
    expect(poster({}, "pending")).toMatchObject({ step: 1, word: "Posted", label: "Jolie applied" });
    expect(helpr({}, "pending")).toMatchObject({ step: 1, label: "You applied. Waiting to hear back" });
  });

  it("board 61: someone else was hired shows Filled, never held money", () => {
    const s = helpr({ status: "accepted", helper_id: "other", payment_status: "escrow" }, "rejected");
    expect(s).toMatchObject({ step: 1, word: "Filled", label: "Jolie hired someone else", held: false });
    expect(poster({ status: "accepted", helper_id: "other", payment_status: "escrow" })).toMatchObject({ word: "Filled", label: "You hired someone else" });
  });

  it("board 62: on the way and arrived are Hired, not Working", () => {
    expect(poster({ status: "in_progress", helper_id: JO, helper_on_the_way_at: "t" })).toMatchObject({ step: 2, label: "Jolie is on the way" });
    expect(poster({ status: "in_progress", helper_id: JO, helper_on_the_way_at: "t", helper_arrived_at: "t" })).toMatchObject({ step: 2, label: "Jolie has arrived" });
  });

  it("board 63: Working needs arrival evidence beyond the Helpr's own claim", () => {
    expect(poster({ status: "in_progress", helper_id: JO, helper_arrived_at: "t", poster_confirmed_arrival_at: "t", payment_status: "escrow" }))
      .toMatchObject({ step: 3, word: "Working", label: "Jolie will mark it done", held: true });
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
    const src = blankComments(readFileSync(resolve(__dirname, "DealCard.tsx"), "utf8"));
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
// @mutate src/components/messages/ChatHeader.tsx | {dealPinned ? personFacts : activeConvo.jobTitle} | {activeConvo.jobTitle}
describe("chat header while the deal card is pinned", () => {
  it("shows the person's facts, not the job title, and drops the status chip", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../ChatHeader.tsx"), "utf8"));
    expect(src).toContain("{dealPinned ? personFacts : activeConvo.jobTitle}");
    expect(src).toMatch(/activeConvo\.jobStatus && !inboxVisible && !dealPinned/);
    expect(src).toMatch(/usePersonFacts\(dealPinned \? activeConvo\.otherUserId : null\)/);
  });
});
