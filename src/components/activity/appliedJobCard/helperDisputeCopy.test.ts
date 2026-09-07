import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { helperDisputeCopy } from "./helperDisputeCopy";

/**
 * THE HELPER'S DISPUTE PANEL MUST NOT SPEAK IN THE POSTER'S VOICE.
 *
 * External QA, 2026-09-06. A helper can open a dispute — the same "Something
 * Wrong? Open a Dispute" link sits on their completed job — and production has
 * one: job 8133a907-f36f-4278-96c4-41d4ce1d56c8, `disputed_by` = `helper_id`.
 * On that card the panel headlined "Both sides are talking it out", offered a
 * box to RESPOND to the helper's own complaint, and captioned the countdown:
 *
 *   "If the poster doesn't resolve or escalate, payment auto-releases to you
 *    after the deadline."
 *
 * i.e. "if nothing happens, you get paid", shown to the person who had just
 * complained. It is not inaccurate — `auto-resolve-disputes` settles every
 * non-escalated expired dispute with `_outcome: "helper"` — which is exactly
 * why it cannot be shown as an inducement to sit still.
 *
 * WHAT MAKES THIS TEST NON-VACUOUS. It does not assert that a particular
 * sentence is present. It asserts a RELATION over the state space: no sentence
 * shown to the party who filed may read as a payout promise, and no control may
 * ask them to answer themselves. Before the fix, `helperDisputeCopy` returned
 * the same object for both values of `disputed_by`, so every assertion below
 * that distinguishes them would have failed, and none of them can be satisfied
 * by rewording alone.
 */

const ME = "helper-uuid";
const POSTER = "poster-uuid";

/** Every value the app writes to `jobs.dispute_status`, plus the null default. */
const DISPUTE_STATUSES = [
  null,
  "open",
  "helper_responded",
  "escalated",
  "under_review",
  "resolved",
  "auto_resolved",
] as const;

describe("helper dispute panel — copy is aimed at whoever filed", () => {
  const states = DISPUTE_STATUSES.flatMap((dispute_status) =>
    [ME, POSTER].map((disputed_by) => ({ dispute_status, disputed_by })),
  );

  it("distinguishes the two sides at all", () => {
    // Guards the guard. Before the fix this file's subject returned identical
    // copy for both, and every assertion below would have been comparing a
    // value with itself.
    const mine = helperDisputeCopy({ disputed_by: ME, dispute_status: "open" }, ME);
    const theirs = helperDisputeCopy({ disputed_by: POSTER, dispute_status: "open" }, ME);
    expect(mine.iOpenedIt).toBe(true);
    expect(theirs.iOpenedIt).toBe(false);
    expect(mine.consequenceText).not.toBe(theirs.consequenceText);
    expect(mine.headline).not.toBe(theirs.headline);
    expect(mine.reasonLabel).not.toBe(theirs.reasonLabel);
    expect(states.length).toBe(DISPUTE_STATUSES.length * 2);
  });

  it("never promises the filer a payout for waiting", () => {
    // The exact shape of the original defect: "payment auto-releases to you"
    // is fine copy for the ACCUSED helper (it is the poster's clock), and is
    // an inducement when shown to the helper who filed.
    for (const job of states) {
      const c = helperDisputeCopy(job, ME);
      if (!c.iOpenedIt) continue;
      expect(
        /auto-releases to you|releases to you after/i.test(c.consequenceText),
        `dispute_status=${job.dispute_status}: the helper who FILED is told the payment ` +
          `auto-releases to them.\n  ${c.consequenceText}`,
      ).toBe(false);
    }
  });

  it("still tells the filer what the clock actually does", () => {
    // Re-aimed, not deleted. Softening this into silence would be its own
    // defect — the money really does move at the deadline, and a helper who is
    // not told that cannot make a decision.
    for (const job of states) {
      const c = helperDisputeCopy(job, ME);
      if (!c.iOpenedIt) continue;
      expect(
        /releases|lapses|hold/i.test(c.consequenceText),
        `dispute_status=${job.dispute_status}: the filer is no longer told what happens ` +
          `at the deadline.\n  ${c.consequenceText}`,
      ).toBe(true);
      // …and is pointed at a move that ends it, rather than left with none.
      expect(
        /admin|resolve|talk/i.test(c.consequenceText),
        `dispute_status=${job.dispute_status}: the filer is told the outcome but given ` +
          `no way to change it.\n  ${c.consequenceText}`,
      ).toBe(true);
    }
  });

  it("never asks the filer to respond to their own dispute", () => {
    // The response box writes `dispute_helper_response`, which the POSTER's
    // card renders under "Helpr's response". Offering it to the opener asks
    // them to answer themselves, in a field addressed to the other party.
    for (const job of states) {
      const c = helperDisputeCopy(job, ME);
      if (!c.iOpenedIt) continue;
      expect(
        c.canRespond,
        `dispute_status=${job.dispute_status}: the helper who filed is offered the ` +
          `"respond to dispute" box.`,
      ).toBe(false);
    }
  });

  it("keeps the accused helper's voice in every live state, including after escalation", () => {
    // This gate was `disputeStatus === "open"` once, so the control vanished
    // the moment the poster escalated — and `helper_abort_job` opens its
    // dispute ESCALATED from the start, so a helper who took the sanctioned
    // exit never saw it at all. The server permits it in every state:
    // `dispute_helper_response` is on enforce_helper_jobs_column_whitelist's
    // ALLOW-list unconditionally.
    for (const status of ["open", "escalated", "under_review"]) {
      expect(
        helperDisputeCopy({ disputed_by: POSTER, dispute_status: status }, ME).canRespond,
        `a helper accused in a ${status} dispute has no way to state their side.`,
      ).toBe(true);
    }
  });

  it("a decided dispute offers no response box", () => {
    for (const status of ["resolved", "auto_resolved"]) {
      expect(helperDisputeCopy({ disputed_by: POSTER, dispute_status: status }, ME).canRespond).toBe(false);
    }
  });

  it("the component actually renders these strings rather than its own", () => {
    // The split only helps if DisputedSection consumes it. A copy left inline
    // would drift back, which is the failure this whole file exists for.
    const src = readFileSync(resolve(__dirname, "DisputedSection.tsx"), "utf8");
    expect(src).toContain("helperDisputeCopy(job, app.helper_id)");
    for (const bound of ["{headline}", "{reasonLabel}", "consequenceText={consequenceText}"]) {
      expect(
        src.includes(bound),
        `DisputedSection no longer renders ${bound} — the copy has been inlined again ` +
          `and this test can no longer see what the helper is shown.`,
      ).toBe(true);
    }
  });
});

/**
 * The poster's collapsed card must announce an open dispute.
 *
 * QA: the poster's COLLAPSED card for a disputed job showed the same title, the
 * same "$120", and no badge — while a 72-hour clock ran toward an automatic
 * release of that money. Every action block on PostedJobCard is behind
 * `isExpanded`, so the poster had to open the card to learn a dispute existed.
 * The helper's card already reads "DISPUTE OPEN" at the top level, because
 * DisputedSection is rendered OUTSIDE AppliedJobCard's expand gate.
 */
describe("the poster's collapsed card announces the dispute", () => {
  it("PostedJobCard renders a dispute badge when collapsed", () => {
    const src = readFileSync(resolve(__dirname, "../PostedJobCard.tsx"), "utf8");
    expect(
      /!isExpanded && job\.status === "disputed"/.test(src),
      "PostedJobCard no longer shows a collapsed-card dispute badge. A poster " +
        "scrolling My Posts cannot tell that one of these jobs has a 72-hour clock " +
        "running on their money.",
    ).toBe(true);
  });

  it("the helper's panel is still outside the expand gate, which is the bar being matched", () => {
    // If this ever moved behind an expand, the two sides would be equally
    // silent and the test above would be matching nothing worth matching.
    const src = readFileSync(resolve(__dirname, "../AppliedJobCard.tsx"), "utf8");
    const disputed = src.indexOf("{isDisputed && (");
    expect(disputed, "AppliedJobCard no longer renders DisputedSection on `isDisputed`").toBeGreaterThan(-1);
    expect(
      /\{isDisputed && \(\s*<DisputedSection/.test(src),
      "AppliedJobCard's dispute panel is no longer rendered directly on `isDisputed` — " +
        "check it has not been put behind `isExpanded`, which would hide an open " +
        "dispute from the helper too.",
    ).toBe(true);
  });
});
