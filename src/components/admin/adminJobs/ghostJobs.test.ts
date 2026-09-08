import { describe, it, expect } from "vitest";
import { isGhostJob, GHOST_GRACE_MINUTES, GHOST_JOB_FLAG, detectFlags } from "./adminJobsHelpers";
import type { Job } from "./types";

/**
 * A GHOST is a job that is open to helpers with no money behind it.
 *
 * `useJobSubmit`'s `cleanupOrphanJob` describes the failure it exists to
 * prevent: a job whose payment setup failed and whose cleanup DELETE then
 * matched zero rows is left "browsable, applicable-to, and impossible to pay
 * out". That cleanup is deliberately best-effort — it must not throw over the
 * error that triggered it — so when it does not land, nothing notices. Helpers
 * apply, spend a pitch, and the job can never be awarded.
 *
 * The admin queue had no signal for this at all: every other flag is about
 * something a PERSON did (spam keywords, an odd budget, a past date) and none
 * about the platform's own checkout dropping a row on the floor.
 */
const job = (o: Partial<Job> = {}): Job =>
  ({
    id: "j1",
    title: "Move a couch",
    description: "A perfectly ordinary description, long enough to not trip other flags.",
    budget: 100,
    status: "open",
    payment_status: "unpaid",
    created_at: new Date(Date.now() - 24 * 3600_000).toISOString(),
    date_needed: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    ...o,
  }) as unknown as Job;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe("isGhostJob", () => {
  it("flags an open job left unpaid", () => {
    expect(isGhostJob(job({ status: "open", payment_status: "unpaid" }))).toBe(true);
  });

  it.each(["escrow", "payout_pending", "released"])(
    "does not flag a funded job (%s)",
    (payment_status) => {
      expect(isGhostJob(job({ payment_status }))).toBe(false);
    },
  );

  it.each(["abandoned", "failed", "cancelling", "chargeback", "refunded", "cancelled"])(
    "flags every other payment state on an OPEN job (%s)",
    (payment_status) => {
      // The detector lists the FUNDED states and treats everything else as
      // unfunded, so a payment state added later defaults to "ghost" rather
      // than slipping through unnoticed. `abandoned` is the one live on prod.
      expect(isGhostJob(job({ payment_status }))).toBe(true);
    },
  );

  it("treats a null payment_status as unfunded, not unknown", () => {
    expect(isGhostJob(job({ payment_status: null }))).toBe(true);
  });

  it.each(["cancelled", "completed", "in_progress", "accepted"] as const)(
    "ignores jobs that are not open (%s) — nobody can apply to them",
    (status) => {
      // Three cancelled/unpaid rows sit on prod. They are not ghosts: an
      // unfunded job nobody can apply to is just a cancelled job.
      expect(isGhostJob(job({ status, payment_status: "unpaid" }))).toBe(false);
    },
  );

  describe("grace window", () => {
    // The job row is inserted BEFORE Stripe Checkout completes — that ordering
    // is the design. Without a grace window this detector would flag every
    // healthy post for the duration of its checkout and the tab would cry wolf.
    it("does not flag a checkout still in flight", () => {
      expect(isGhostJob(job({ created_at: minutesAgo(GHOST_GRACE_MINUTES - 5) }))).toBe(false);
    });

    it("flags one that has been unfunded well past any real checkout", () => {
      expect(isGhostJob(job({ created_at: minutesAgo(GHOST_GRACE_MINUTES + 5) }))).toBe(true);
    });

    it("does not flag a row with no created_at rather than guessing its age", () => {
      expect(isGhostJob({ ...job(), created_at: null as unknown as string })).toBe(false);
    });
  });
});

describe("detectFlags", () => {
  it("surfaces the ghost in the flag list, so it reaches the default queue", () => {
    expect(detectFlags(job())).toContain(GHOST_JOB_FLAG);
  });

  it("says nothing about escrow on a healthy funded job", () => {
    expect(detectFlags(job({ payment_status: "escrow" }))).not.toContain(GHOST_JOB_FLAG);
  });
});
