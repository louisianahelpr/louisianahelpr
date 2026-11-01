// @mutate src/components/tracker/jobProgressState.ts |     next: posterLate \|\| noApplicantsYet \|\| ((sameStep |     next: posterLate \|\| ((sameStep
// @mutate src/components/tracker/jobProgressState.ts | const picking = poster && (o.pendingApplicants ?? 0) > 0; | const picking = false;
// Board 2 (deal-room chat) and the chat halves of 59, 61, 62, 63, now the ONE tracker (owner, 2026-10-21):
// the stage is named from the job's own stamps and never runs ahead of them, and the deal card never writes.
// @mutate src/components/tracker/jobProgressState.ts | (workHasBegun(job, { workUnderway: o.workUnderway }) ? `${other} is working` : `${other} is at the job`) | `${other} is working`
// @mutate src/components/tracker/jobProgressState.ts | !!(job.poster_confirmed_working_at \|\| job.poster_confirmed_arrival_at \|\| job.helper_arrival_verified_at) | !!(job.poster_confirmed_working_at \|\| job.poster_confirmed_arrival_at \|\| job.helper_arrival_verified_at \|\| job.helper_arrived_at)
// @mutate src/components/tracker/jobProgressState.ts | if (job.helper_id && o.threadHelprId && job.helper_id !== o.threadHelprId) { | if (false) {
// @mutate src/components/tracker/jobProgressState.ts |     if (!Number.isNaN(opens) && now < opens) { |     if (false) {
// @mutate src/components/tracker/jobProgressState.ts |     const slot = o.rescheduled ? slotLabel(job.date_needed, job.start_time) : ""; |     const slot = "";
// @mutate src/components/tracker/jobProgressState.ts |       const mine = poster ? !posterIn : !helprIn; |       const mine = poster ? !helprIn : !posterIn;
// @mutate src/components/tracker/jobStepFromWait.ts |   confirm_booking: at(1), |   confirm_booking: at(2),
// @mutate src/components/tracker/jobStepFromWait.ts |   confirm_still_on: at(3), |   confirm_still_on: at(2),
// @mutate src/components/tracker/jobStepFromWait.ts |   approve: at(7), |   approve: at(6),
// @mutate src/components/tracker/jobProgressState.ts |       if (poster && !posterIn && now >= posterConfirmClosesMs(job.date_needed, job.start_time)) { |       if (false) {
// @mutate src/components/job-card/jobStatusLine.ts |     if (Date.now() >= posterConfirmClosesMs(job.date_needed, job.start_time)) return | if (false) return
// @mutate src/components/tracker/jobProgressState.ts |     const pending = o.pendingApplicants ?? (o.application === "pending" ? 1 : 0); |     const pending = o.application === "pending" ? 1 : 0;
// @mutate src/components/tracker/jobProgressState.ts |   if (isExpiredListing(job)) return at(null, false, poster ? EXPIRED_WORD | if (false) return at(null, false, poster ? EXPIRED_WORD
// @mutate src/components/tracker/jobProgressState.ts |   if (isExpiredListing(job)) return { ...base, stage: 0 | if (false) return { ...base, stage: 0
// @mutate src/components/tracker/jobProgressState.ts | const wait = poster ? `${other} confirms on ${day}, the day before` | const wait = poster ? `${other} confirms the day before. Opens ${when(opens)}`
// JA-4 (audit 11-01): the line named a button ("I'm still on") the job page calls "Confirm it's still on"; it now says the step.
// @mutate src/components/tracker/jobProgressState.ts | !posterIn ? "Confirm the job is still on" : | !posterIn ? "Tap I'm still on to confirm" :
// @mutate src/pages/jobs/jobPage/useJobPage.ts | has_active_dispute, cancellation_reason, cancelled_by, | has_active_dispute,
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jobProgress, JOB_PROGRESS_SHORT, JOB_PROGRESS_STEPS, type ProgressJob } from "@/components/tracker/jobProgressState";
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
  // The card's rule (helperStatusLine) reads the real clock, as it does on a card: pin it to NOW.
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => { vi.useRealTimers(); });
  it("has the owner's eight steps (2026-10-22)", () => {
    expect([...JOB_PROGRESS_STEPS]).toEqual(["Posted", "Offered", "Hired", "Confirmed", "On the way", "Arrived", "Working", "Done"]);
    expect(JOB_PROGRESS_SHORT.length).toBe(JOB_PROGRESS_STEPS.length);
  });

  it("board 2/59: open job with a pending application", () => {
    expect(poster({}, "pending")).toMatchObject({ stage: 0, waitingOnYou: true, word: "Posted", next: "Jolie applied" });
    expect(helpr({}, "pending")).toMatchObject({ stage: 0, waitingOnYou: false, next: "You applied. Waiting on Jolie" });
  });

  it("board 61: someone else was hired shows Filled, never held money", () => {
    const s = helpr({ status: "accepted", helper_id: "other", payment_status: "escrow" }, "rejected");
    expect(s).toMatchObject({ stage: 0, word: "Filled", next: "Jolie hired someone else", held: false });
    expect(poster({ status: "accepted", helper_id: "other", payment_status: "escrow" })).toMatchObject({ word: "Filled", next: "You hired someone else" });
  });

  it("an offer is not a booking", () => {
    expect(poster({ status: "accepted", helper_id: JO, helper_confirmed_at: null })).toMatchObject({ stage: 1, waitingOnYou: false, word: "Offered", next: "Waiting on Jolie to accept the offer" });
    // Accepting the offer is the Helpr's move: yellow on their side.
    expect(helpr({ status: "accepted", helper_id: ME, helper_confirmed_at: null })).toMatchObject({ stage: 1, waitingOnYou: true, next: "Jolie offered you this job" });
  });

  it("Accepted, before the day-before window: says when confirming opens (the server's rule)", () => {
    // Job Fri 2037-10-23 9:00; the window opens Thu 2037-10-22 00:00 Louisiana time.
    const j = { status: "accepted", helper_id: JO, date_needed: "2037-10-23", start_time: "09:00" };
    expect(poster(j)).toMatchObject({ stage: 2, waitingOnYou: false, word: "Hired", next: "Jolie confirms on Thu, the day before" });
    expect(helpr({ ...j, helper_id: ME })).toMatchObject({ stage: 2, waitingOnYou: false, next: "Confirm on Thu, the day before" });
  });

  // A2-C40 (audit 2026-10-29, AA9 1a): between the start and the next auto-start sweep (up to 15 min) the
  // poster's line said "Tap I'm still on to confirm" while JobConfirmation had already hidden that button.
  it("past the start, an unconfirmed poster is never told to tap I'm still on (A2-C40)", () => {
    // NOW is Wed 10:00 AM Louisiana; the job started Wed 9:00 AM.
    const j = { status: "accepted", helper_id: JO, date_needed: "2037-10-21", start_time: "09:00" };
    expect(poster(j)).toMatchObject({ stage: 3, next: "It's start time. Jolie hasn't confirmed" });
    expect(poster({ ...j, helper_dayof_confirmed_at: "t" }).next).not.toMatch(/Tap I'm still on|confirm by/);
    // Vacuity floor: an hour before the start the ask (and its button) is still there.
    expect(poster({ ...j, start_time: "11:00" })).toMatchObject({ stage: 3, waitingOnYou: true, next: "Confirm the job is still on" });
  });

  it("window open: who still owes the confirm, and by when", () => {
    const j = { status: "accepted", helper_id: JO, date_needed: "2037-10-22", start_time: "09:00" };
    expect(poster(j)).toMatchObject({ stage: 3, waitingOnYou: true, next: "Confirm the job is still on" });
    expect(poster({ ...j, poster_confirmed_at: "t" })).toMatchObject({ stage: 3, waitingOnYou: false, next: "Waiting on Jolie to confirm by Thu 7:00 AM" });
    expect(helpr({ ...j, helper_id: ME, poster_confirmed_at: "t" })).toMatchObject({ stage: 3, waitingOnYou: true });
    // Both in: Confirmed is done; On the way is next.
    expect(poster({ ...j, poster_confirmed_at: "t", helper_dayof_confirmed_at: "t" })).toMatchObject({ stage: 4, waitingOnYou: false, next: "You're both confirmed. Jolie taps On my way when they leave" });
    // Both in, a day out: On the way is next; the face offers "I'm on my way" only from 3 hours before (owner 2026-10-23).
    expect(helpr({ ...j, helper_id: ME, poster_confirmed_at: "t", helper_dayof_confirmed_at: "t" })).toMatchObject({ stage: 4, waitingOnYou: false, next: "You're scheduled" });
    // Only the Helpr in: Confirmed lights on BOTH (the old rail's rule, kept), so it waits on the poster; the
    // Helpr's early "I'm on my way" does not make Confirmed theirs.
    expect(helpr({ ...j, helper_id: ME, helper_dayof_confirmed_at: "t" })).toMatchObject({ stage: 3, waitingOnYou: false, next: "Waiting on Jolie to confirm" });
  });

  it("moved by an accepted change: each side's line names the NEW slot until they confirm it (owner, 2026-10-21)", () => {
    // The "Mow two lawns" shape: moved to Thu 9:00 AM; the server cleared both confirmations (20261021074803).
    const j = { status: "accepted", helper_id: JO, date_needed: "2037-10-22", start_time: "09:00" };
    const rp = (x: Partial<ProgressJob>) => jobProgress({ ...base, helper_confirmed_at: "t", ...x }, { viewer: "poster", otherFirst: "Yusef", now: NOW, rescheduled: true });
    const rh = (x: Partial<ProgressJob>) => jobProgress({ ...base, helper_confirmed_at: "t", ...x }, { viewer: "helpr", otherFirst: "Ben", now: NOW, rescheduled: true });
    expect(rp(j)).toMatchObject({ stage: 3, waitingOnYou: true, word: "Confirmed", next: "Confirm the new time, Thu 9:00 AM" });
    expect(rh({ ...j, helper_id: ME })).toMatchObject({ stage: 3, waitingOnYou: true, next: "Confirm you'll be there Thu 9:00 AM" });
    // One side in: the other's line waits on the NEW slot.
    expect(rp({ ...j, poster_confirmed_at: "t" })).toMatchObject({ stage: 3, waitingOnYou: false, next: "Waiting for Yusef to confirm Thu 9:00 AM" });
    expect(rh({ ...j, helper_id: ME, helper_dayof_confirmed_at: "t" })).toMatchObject({ stage: 3, waitingOnYou: false, next: "Waiting for Ben to confirm Thu 9:00 AM" });
    // Both in: the normal confirmed state.
    expect(rp({ ...j, poster_confirmed_at: "t", helper_dayof_confirmed_at: "t" })).toMatchObject({ next: "You're both confirmed. Yusef taps On my way when they leave" });
    // Moved to a day whose window has not opened: the new slot, then when confirming opens.
    expect(rp({ ...j, date_needed: "2037-10-23" })).toMatchObject({ next: "New time Fri 9:00 AM. Yusef confirms on Thu, the day before" });
    // No start time: the weekday alone.
    expect(rp({ ...j, start_time: null })).toMatchObject({ next: "Confirm the new time, Thu" });
  });

  it("board 62: on the way and arrived are their own steps, not Working", () => {
    expect(poster({ status: "in_progress", helper_id: JO, helper_on_the_way_at: "t" })).toMatchObject({ stage: 4, waitingOnYou: false, next: "Jolie is on the way" });
    expect(helpr({ status: "in_progress", helper_id: ME, helper_on_the_way_at: "t" })).toMatchObject({ stage: 4, waitingOnYou: true });
    // Confirming arrival is the poster's move.
    expect(poster({ status: "in_progress", helper_id: JO, helper_on_the_way_at: "t", helper_arrived_at: "t" })).toMatchObject({ stage: 5, waitingOnYou: true, next: "Jolie arrived. Confirm they've arrived" });
    // The Helpr's card asks for the before photo here (beforePhotoIsThePrimary): their move, so the bar says so too.
    expect(helpr({ status: "in_progress", helper_id: ME, helper_on_the_way_at: "t", helper_arrived_at: "t" })).toMatchObject({ stage: 5, waitingOnYou: true });
  });

  it("board 63: Working needs arrival evidence beyond the Helpr's own claim", () => {
    expect(poster({ status: "in_progress", helper_id: JO, helper_arrived_at: "t", poster_confirmed_arrival_at: "t", payment_status: "escrow" }))
      .toMatchObject({ stage: 6, waitingOnYou: false, word: "Working", next: "Jolie is working", held: true });
    // Lead 2026-10-31: "is working" exactly when the Working step has begun (workHasBegun); the Helpr's own tracking
    // row saying not started yet (the job page passes it) keeps "is at the job".
    expect(jobProgress({ ...base, status: "in_progress", helper_id: JO, helper_confirmed_at: "t", helper_arrived_at: "t", poster_confirmed_arrival_at: "t" }, { viewer: "poster", otherFirst: "Jolie", threadHelprId: JO, now: NOW, workUnderway: false }).next).toBe("Jolie is at the job");
    expect(poster({ status: "in_progress", helper_id: JO, helper_arrived_at: "t", poster_confirmed_arrival_at: "t", poster_confirmed_working_at: "t" }).next).toBe("Jolie is working");
    expect(helpr({ status: "in_progress", helper_id: ME, helper_arrival_verified_at: "t" })).toMatchObject({ stage: 6, waitingOnYou: true, word: "Working" });
  });

  it("marked done: the last step waits on the poster to check the work; completed is every step done", () => {
    expect(poster({ status: "in_progress", helper_id: JO, poster_confirmed_arrival_at: "t", helper_completed_at: "t" })).toMatchObject({ stage: 7, waitingOnYou: true, next: "Jolie marked it done. Check the work and approve" });
    expect(helpr({ status: "in_progress", helper_id: ME, poster_confirmed_arrival_at: "t", helper_completed_at: "t" })).toMatchObject({ stage: 7, waitingOnYou: false });
    expect(helpr({ status: "completed", helper_id: ME })).toMatchObject({ stage: 8, waitingOnYou: false });
  });

  it("held only while the payment is in escrow", () => {
    expect(poster({ status: "accepted", helper_id: JO, payment_status: "escrow" }).held).toBe(true);
    expect(poster({ status: "completed", helper_id: JO, payment_status: "released" })).toMatchObject({ stage: 8, held: false });
  });

  it("off the happy path: cancelled is all grey, a dispute is the warning step, not picked has no bar", () => {
    expect(poster({ status: "cancelled" })).toMatchObject({ tone: "cancelled", label: "Cancelled", waitingOnYou: false });
    expect(poster({ status: "in_progress", helper_id: JO, has_active_dispute: true })).toMatchObject({ stage: 7, tone: "problem", label: "Dispute" });
    expect(helpr({}, "rejected").stage).toBeNull();
  });
});

describe("audit 11-01 (JA-1, JA-23)", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => { vi.useRealTimers(); });
  const paid: ProgressJob = { ...base, payment_status: "escrow" };
  it("JA-1: the job page's applicant count reaches the poster's line (never 'No applicants yet' with 2 waiting)", () => {
    const p = jobProgress(paid, { viewer: "poster", now: NOW, pendingApplicants: 2 });
    expect(p.next).not.toMatch(/no applicants/i);
    expect(p).toMatchObject({ next: "Pick your Helpr", waitingOnYou: true });
    // JA-2: nobody applied: "Waiting for Helprs to apply", never the card's "No applicants yet" (the page's own block
    // under the buttons says that), whatever the listing's clock or payment state.
    for (const j of [paid, { ...paid, date_needed: "2037-10-21", start_time: "16:00" }, { ...paid, payment_status: "held" }]) {
      expect(jobProgress(j, { viewer: "poster", now: NOW, pendingApplicants: 0 }).next).toBe("Waiting for Helprs to apply");
    }
  });
  it("JA-23: an expired listing is Expired for its poster, Closed for anyone else, never Cancelled", () => {
    const expired: ProgressJob = { ...base, status: "cancelled", cancelled_by: null, cancellation_reason: "Job listing expired: no Helpr was hired" };
    const p = jobProgress(expired, { viewer: "poster", now: NOW });
    expect(p).toMatchObject({ tone: "cancelled", label: "Expired", word: "Expired", next: "No Helpr was hired in time" });
    const h = jobProgress(expired, { viewer: "helpr", now: NOW });
    expect(`${h.label} ${h.word} ${h.next}`).not.toMatch(/ancel/);
    // A real cancel (a person did it) stays Cancelled.
    expect(jobProgress({ ...expired, cancelled_by: "p" }, { viewer: "poster", now: NOW })).toMatchObject({ label: "Cancelled" });
  });
  // @mutate src/components/tracker/jobProgressState.ts | return at(8, false, "Done", Number.isNaN(doneMs) ? "Finished" : `Finished ${when(doneMs)}`, held); | return at(8, false, "Done", "", held);
  it("JA-11: a finished job's line says when it finished, on both sides", () => {
    const done: ProgressJob = { ...base, status: "completed", helper_id: "h", helper_confirmed_at: "t", payment_status: "payout_pending",
      helper_completed_at: "2037-10-21T14:00:00Z", poster_completed_at: "2037-10-21T14:20:00Z" };
    expect(jobProgress(done, { viewer: "poster", otherFirst: "Yusef", now: NOW })).toMatchObject({ stage: 8, next: "Finished Wed 9:20 AM" });
    expect(jobProgress(done, { viewer: "helpr", otherFirst: "Dana", now: NOW })).toMatchObject({ stage: 8, next: "Finished Wed 9:20 AM" });
  });
  // @mutate src/components/tracker/jobProgressState.ts |   return [who, reason, refund].filter(Boolean).join(" · "); |   return "This job was cancelled";
  // @mutate src/components/tracker/jobProgressState.ts |   const posterDid = !!by && by === job.customer_id; |   const posterDid = false;
  it("JA-26: a cancelled job says who, when, why and the refund", () => {
    const c: ProgressJob = { ...base, status: "cancelled", customer_id: "p", helper_id: "h", helper_confirmed_at: "t", cancelled_by: "p",
      cancelled_at: "2037-10-21T14:00:00Z", cancellation_reason: "[SWEEP] Plans changed", payment_status: "refunded" };
    expect(jobProgress(c, { viewer: "poster", otherFirst: "Yusef", now: NOW }))
      .toMatchObject({ label: "Cancelled", next: "You cancelled Wed 9:00 AM · Plans changed · Your payment was refunded" });
    // The Helpr: the poster's name, no refund line.
    expect(jobProgress(c, { viewer: "helpr", otherFirst: "Dana", now: NOW }).next).toBe("Dana cancelled Wed 9:00 AM · Plans changed");
    // The Helpr cancelled.
    expect(jobProgress({ ...c, cancelled_by: "h" }, { viewer: "poster", otherFirst: "Yusef", now: NOW }).next).toMatch(/^Yusef cancelled Wed 9:00 AM/);
    // Someone else (an admin): not named.
    expect(jobProgress({ ...c, cancelled_by: "admin", cancellation_reason: null, payment_status: "escrow" }, { viewer: "poster", now: NOW }).next).toBe("This job was cancelled");
  });
  // @mutate src/components/tracker/jobProgressState.ts |     const checkBy = autoCompleteAt({ helper_completed_at: job.helper_completed_at }); |     const checkBy = null;
  it("JA-21: the Helpr who marked it done is told until when the poster has to check", () => {
    const j: ProgressJob = { ...base, status: "in_progress", helper_id: ME, helper_confirmed_at: "t", poster_confirmed_arrival_at: "t", helper_completed_at: "2037-10-21T14:30:00Z" };
    expect(jobProgress(j, { viewer: "helpr", otherFirst: "Dana", threadHelprId: ME, now: NOW }).next).toMatch(/^You marked it done\. Dana has until \w{3} \d{1,2}:\d{2} [AP]M to check it$/);
  });
  // @mutate src/components/tracker/jobProgressState.ts |   if (mins <= LATE_GRACE_MIN) return null; |   return null;
  // @mutate src/components/tracker/jobProgressState.ts |     next: posterLate \|\| noApplicantsYet | next: false \|\| noApplicantsYet
  it("JA-12 / JA-13: past the start the poster reads that the Helpr is late, set out or not", () => {
    const j: ProgressJob = { ...base, status: "accepted", helper_id: "h", helper_confirmed_at: "t", helper_dayof_confirmed_at: "t", poster_confirmed_at: "t",
      payment_status: "escrow", date_needed: "2037-10-21", start_time: "08:45" };
    expect(jobProgress(j, { viewer: "poster", otherFirst: "Yusef", now: NOW }).next).toBe("Yusef is 1 h 15 min late and hasn't set out");
    // Moved to in_progress by the start sweep: the card's own "hasn't checked in", never the calm line.
    expect(jobProgress({ ...j, status: "in_progress", start_time: "09:35" }, { viewer: "poster", otherFirst: "Yusef", now: NOW }).next).not.toMatch(/taps On my way/);
    expect(jobProgress({ ...j, helper_on_the_way_at: "2037-10-21T13:40:00Z" }, { viewer: "poster", otherFirst: "Yusef", now: NOW }).next).toBe("Yusef is on the way, 1 h 15 min late");
    // Inside the grace, or before the start: the calm line.
    expect(jobProgress({ ...j, start_time: "09:55" }, { viewer: "poster", otherFirst: "Yusef", now: NOW }).next).not.toMatch(/late/);
  });
  it("the job page reads the columns the expired rule needs", () => {
    const src = readFileSync(resolve(__dirname, "../../pages/jobs/jobPage/useJobPage.ts"), "utf8");
    const party = src.match(/const PARTY_COLUMNS =\s*"([^"]+)"/)?.[1] ?? "";
    expect(party.length).toBeGreaterThan(100);
    for (const c of ["cancellation_reason", "cancelled_by", "cancelled_at", "cancellation_fee"]) expect(party.split(/,\s*/)).toContain(c);
  });
});

describe("DealCard never writes", () => {
  it("reads jobs/applications only; its button only navigates", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../messages/chatView/DealCard.tsx"), "utf8"));
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
    const src = blankComments(readFileSync(resolve(__dirname, "../messages/ChatHeader.tsx"), "utf8"));
    // Falls back to the job title while the facts load or if they fail (review note 5).
    expect(src).toContain("{dealPinned && personFacts ? personFacts : activeConvo.jobTitle}");
    expect(src).toMatch(/activeConvo\.jobStatus && !inboxVisible && !dealPinned/);
    expect(src).toMatch(/usePersonFacts\(dealPinned \? activeConvo\.otherUserId : null\)/);
  });
});
