/**
 * A3-33 (audit 11-01): a crew member's own step is the job page's button, and the Working card takes it.
 *
 * The member's page said "Next: finish and mark it done" while its only button was "See your crew steps" (Mark my
 * part done lived on another screen). crewMemberFace gives the page the Working card's own button for the member's
 * step; takeCrewFaceRequest is the card's half, taking the page's request only while that button would be live.
 *
 * @mutate src/pages/jobs/jobPage/crewMemberFace.ts |       return take("Mark my part done", "crew_done"); |       return null;
 * @mutate src/pages/jobs/jobPage/crewMemberFace.ts |       return take("I'm on my way", "crew_on_the_way"); |       return null;
 * @mutate src/pages/jobs/jobPage/crewMemberFace.ts |       return take("I've arrived", "crew_arrived"); |       return null;
 * @mutate src/pages/jobs/jobPage/crewMemberFace.ts |       if (minutesLeft > 0) { |       if (false) {
 * @mutate src/pages/jobs/jobPage/crewMemberFace.ts |       if (!hasRequiredProof(job, slot.proof_before_urls, slot.proof_after_urls)) { |       if (false) {
 * @mutate src/pages/jobs/jobPage/crewMemberFace.ts |     crewMinutesUntilDone(slot, nowMs) === 0 |     true
 * @mutate src/pages/jobs/jobPage/crewMemberFace.ts |       requestFaceAction(jobId, request); |       void request;
 * @mutate src/pages/jobs/appliedJobCard/CrewMemberSection.tsx |     else if (taken === "crew_done") void onDone(); |     else if (taken === "crew_done") void onArrive();
 * @mutate src/pages/jobs/appliedJobCard/CrewMemberSection.tsx |     const taken = takeCrewFaceRequest(app.job_id, slot, job); |     const taken = null as string | null;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { crewMemberFace, takeCrewFaceRequest } from "@/pages/jobs/jobPage/crewMemberFace";
import { requestFaceAction } from "@/components/job-card/faceActionRequest";
import type { CrewSlot } from "@/lib/crewLifecycle";

const NOW = Date.parse("2026-11-01T18:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const slot = (o: Partial<CrewSlot> = {}): CrewSlot => ({
  id: "s1", job_id: "j1", helper_id: "h1", status: "accepted",
  helper_confirmed_at: ago(600), helper_on_the_way_at: null, helper_arrived_at: null, helper_arrival_verified_at: null,
  poster_confirmed_arrival_at: null, poster_confirmed_working_at: null, helper_completed_at: null,
  proof_before_urls: null, proof_after_urls: null, poster_confirmed_completion_at: null, ...o,
});
const working = (o: Partial<CrewSlot> = {}) =>
  slot({ helper_on_the_way_at: ago(90), helper_arrived_at: ago(60), poster_confirmed_arrival_at: ago(55), poster_confirmed_working_at: ago(55), ...o });
const JOB = { status: "in_progress", require_photo_proof: false };

describe("crewMemberFace: the member's step is the page's button (A3-33)", () => {
  it("working, past the floor: 'Mark my part done', which opens the card with the done request", () => {
    const open = vi.fn();
    const face = crewMemberFace("j1", working(), JOB, open, NOW);
    expect(face?.label).toBe("Mark my part done");
    expect(face?.disabled).toBeFalsy();
    face!.onClick();
    expect(open).toHaveBeenCalledTimes(1);
    // The card takes exactly that request, once.
    expect(takeCrewFaceRequest("j1", working(), JOB, NOW)).toBe("crew_done");
    expect(takeCrewFaceRequest("j1", working(), JOB, NOW)).toBeNull();
  });

  it("inside the 30-minute floor: greyed, with the card's note; the card refuses the request", () => {
    const s = working({ helper_arrived_at: ago(10), poster_confirmed_working_at: ago(10) });
    const face = crewMemberFace("j1", s, JOB, vi.fn(), NOW);
    expect(face?.label).toBe("Mark my part done");
    expect(face?.disabled).toBe(true);
    expect(face?.note).toMatch(/^Available in 20 min/);
    requestFaceAction("j1", "crew_done");
    expect(takeCrewFaceRequest("j1", s, JOB, NOW)).toBeNull();
  });

  it("proof owed: 'Add your photos' opens the card with no request; the card refuses a done request", () => {
    const open = vi.fn();
    const job = { status: "in_progress", require_photo_proof: true };
    const face = crewMemberFace("j2", working(), job, open, NOW);
    expect(face?.label).toBe("Add your photos");
    expect(face?.onClick).toBe(open);
    requestFaceAction("j2", "crew_done");
    expect(takeCrewFaceRequest("j2", working(), job, NOW)).toBeNull();
  });

  it("set out and arrive: the card's own words and requests", () => {
    const setOut = crewMemberFace("j3", slot(), JOB, vi.fn(), NOW);
    expect(setOut?.label).toBe("I'm on my way");
    setOut!.onClick();
    expect(takeCrewFaceRequest("j3", slot(), JOB, NOW)).toBe("crew_on_the_way");
    const onWay = slot({ helper_on_the_way_at: ago(5) });
    const arrive = crewMemberFace("j3", onWay, JOB, vi.fn(), NOW);
    expect(arrive?.label).toBe("I've arrived");
    arrive!.onClick();
    // A request for another step is not taken.
    expect(takeCrewFaceRequest("j3", slot(), JOB, NOW)).toBeNull();
    expect(takeCrewFaceRequest("j3", onWay, JOB, NOW)).toBe("crew_arrived");
  });

  it("a wait (crew filling, the poster's confirm, a part done) or no row is no button: the page keeps 'See your crew steps'", () => {
    expect(crewMemberFace("j4", slot(), { status: "open" }, vi.fn(), NOW)).toBeNull();
    expect(crewMemberFace("j4", slot({ helper_on_the_way_at: ago(9), helper_arrived_at: ago(5) }), JOB, vi.fn(), NOW)).toBeNull();
    expect(crewMemberFace("j4", working({ helper_completed_at: ago(1) }), JOB, vi.fn(), NOW)).toBeNull();
    expect(crewMemberFace("j4", slot({ helper_confirmed_at: null }), JOB, vi.fn(), NOW)).toBeNull();
    expect(crewMemberFace("j4", null, JOB, vi.fn(), NOW)).toBeNull();
  });
});

describe("the Working card takes the page's request and runs that step's own handler (A3-33)", () => {
  const src = blankComments(readFileSync("src/pages/jobs/appliedJobCard/CrewMemberSection.tsx", "utf8"));
  it("each request runs its own handler, from takeCrewFaceRequest", () => {
    expect(src).toMatch(/const taken = takeCrewFaceRequest\(app\.job_id, slot, job\);/);
    const runs = [...src.matchAll(/taken === "(crew_\w+)"\) void (on\w+)\(\)/g)].map((m) => `${m[1]}->${m[2]}`);
    expect(runs.length).toBeGreaterThan(2);
    expect(runs).toEqual(["crew_on_the_way->onSetOut", "crew_arrived->onArrive", "crew_done->onDone"]);
  });
});
