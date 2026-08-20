import { describe, it, expect } from "vitest";

import { deriveAppliedJobCardState } from "./appliedJobCardHelpers";
import type { AppliedApp, Job } from "../activityConstants";

/**
 * A direct offer has no `applications` row — useActivityData fabricates one
 * with `id: "direct-<jobId>"` and `status: "pending"` purely so the offer has a
 * card. That synthetic row used to satisfy `isPending`, so the card rendered
 * the Edit-message / Withdraw controls, each of which addressed an application
 * id no table contains (22P02 invalid uuid). Meanwhile the status stripe above
 * it read "Offered to you · respond" and there was no way to respond.
 *
 * These lock the routing: a pending direct offer is OFFERED, never PENDING.
 */
const HELPER = "helper-1";

const job = (over: Partial<Job> = {}) =>
  ({
    id: "job-1",
    status: "open",
    helper_confirmed_at: null,
    direct_offer_status: null,
    offered_to_helper_id: null,
    budget: 100,
    urgent_fee: 0,
    helper_fee_percent: null,
    is_group_job: false,
    helpers_needed: 1,
    ...over,
  }) as unknown as Job;

const app = (over: Partial<AppliedApp> = {}) =>
  ({
    id: "app-1",
    job_id: "job-1",
    helper_id: HELPER,
    status: "pending",
    ...over,
  }) as unknown as AppliedApp;

const derive = (a: AppliedApp, j: Job) =>
  deriveAppliedJobCardState(a, j as Job & { revision_note?: string | null }, new Set(), null);

describe("deriveAppliedJobCardState — direct offers", () => {
  it("routes a pending direct offer to the OFFERED section, not PENDING", () => {
    const j = job({ direct_offer_status: "pending", offered_to_helper_id: HELPER });
    const s = derive(app({ id: `direct-${j.id}` }), j);
    expect(s.isDirectOffer).toBe(true);
    expect(s.isOffered).toBe(true);
    // Critical: the withdraw / edit-message controls hang off isPending, and
    // every one of them would address `direct-job-1` as a uuid.
    expect(s.isPending).toBe(false);
    expect(s.hasActionSection).toBe(true);
  });

  it("leaves an ordinary pending application alone", () => {
    const s = derive(app(), job());
    expect(s.isDirectOffer).toBe(false);
    expect(s.isPending).toBe(true);
    expect(s.isOffered).toBe(false);
  });

  it("does not treat another helper's direct offer as this helper's", () => {
    const j = job({ direct_offer_status: "pending", offered_to_helper_id: "someone-else" });
    const s = derive(app(), j);
    expect(s.isDirectOffer).toBe(false);
    expect(s.isPending).toBe(true);
  });

  it("stops treating it as an offer once the offer is no longer pending", () => {
    const j = job({ direct_offer_status: "declined", offered_to_helper_id: HELPER });
    const s = derive(app(), j);
    expect(s.isDirectOffer).toBe(false);
    expect(s.isOffered).toBe(false);
  });

  it("still routes an accepted-but-unconfirmed application to OFFERED", () => {
    const j = job({ status: "accepted", helper_confirmed_at: null });
    const s = derive(app({ status: "accepted" }), j);
    expect(s.isOffered).toBe(true);
    expect(s.isConfirmed).toBe(false);
  });

  it("routes an accepted AND confirmed application to CONFIRMED", () => {
    const j = job({ status: "accepted", helper_confirmed_at: "2026-08-19T00:00:00Z" });
    const s = derive(app({ status: "accepted" }), j);
    expect(s.isOffered).toBe(false);
    expect(s.isConfirmed).toBe(true);
  });
});
