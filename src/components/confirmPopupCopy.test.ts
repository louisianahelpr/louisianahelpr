import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

/**
 * Owner wording decisions, 2026-09-14 (pop-up, visual-notes follow-ups).
 *
 * The Helpr's Mark job complete confirm read "Request Your Payout?" with a
 * "Yes, I'm Done" button: the card says Mark job complete, the popup it
 * opens talked about money. Now "Mark this job complete?" / "Mark Complete".
 *
 * The confirm-booking popup's hand-off link read "Can't make it? See what
 * happens". It opens the real cancel flow, so it now says "Cancel job", the
 * label ConfirmedSection's chip already uses (VN-18).
 *
 * Read from source because the strings live in JSX props deep inside
 * components that need a job, a session and a tracker to render.
 */
/*
 * COMMENTS ARE BLANKED BEFORE ANYTHING IS ASSERTED.
 *
 * This repo cites the origin of a wording decision in prose constantly — the
 * paragraph above does it twice, naming both the copy that shipped and the
 * copy it replaced. A raw-text guard cannot tell a live JSX prop from a
 * sentence about one, so it fails in both directions: a commented-out
 * `title="Mark this job complete?"` would satisfy the positive assertions
 * while the rendered popup said something else, and one honest note
 * mentioning "Request Your Payout?" would turn the negative assertions red
 * for a change that never touched the UI.
 *
 * (Same lesson as the migration-pin census in docs/GUARD-BURNDOWN.md: a first
 * pass grepping raw text said 14, blanking comments first said 7.)
 *
 * `blankComments` (src/test/helpers/blankNonCode.ts) rather than a regex of
 * our own: it is string-aware, so a `//` inside a URL does not open a comment
 * that runs to the end of the file, and it BLANKS rather than deletes, so the
 * JSX either side still reads as one chunk for the structural regex below.
 * `blankComments`, not `blankNonCode` — every assertion here is about the
 * text inside a string literal, which `blankNonCode` would also blank.
 */
const src = (f: string) =>
  blankComments(readFileSync(resolve(__dirname, f), "utf8"));

describe("Mark job complete confirm popup", () => {
  const tracking = src("JobTracking.tsx");

  it("asks to mark the job complete, not to request a payout", () => {
    expect(tracking).toContain('title="Mark this job complete?"');
    expect(tracking).toContain('primaryLabel="Mark job complete"');
    expect(tracking).not.toContain("Request Your Payout?");
    expect(tracking).not.toMatch(/Yes, I['’]m Done/);
  });

  // Audit 2026-10-30: nothing pays out on a timer (escrowTiming.ts: the money moves only after approval, and past the
  // window support is asked to step in), so "starts the clock on your payment" promised something that never runs.
  // @mutate src/components/JobTracking.tsx | the work is finished, so they can approve it." | the work is finished and starts the clock on your payment."
  it("says what the tap does, with no clock on the payment", () => {
    expect(tracking).toContain("This tells the person who posted this job the work is finished, so they can approve it.");
    expect(tracking).not.toMatch(/clock on your payment/);
    expect(tracking).toContain("Your payment stays held safely until the job is approved.");
  });
});

describe("confirm-booking popup cancel link", () => {
  const confirmation = src("JobConfirmation.tsx");

  it("reads Cancel job", () => {
    const link = confirmation.match(/onCantMakeIt\(\); \}\}[\s\S]*?>\s*([^<{]+?)\s*<\/button>/);
    expect(link, "could not find the onCantMakeIt link in JobConfirmation.tsx; re-read it").toBeTruthy();
    expect(link![1]).toBe("Cancel job");
    expect(confirmation).not.toMatch(/See what happens/);
  });
});

// Owner, 2026-09-14: the card says Mark job complete and the popup it opens
// talked about money. This is that popup reverting.
// @mutate src/components/JobTracking.tsx | title="Mark this job complete?" | title="Request Your Payout?"
// The confirm-booking hand-off link reverting to euphemism: it opens the real
// cancel flow, so it has to say Cancel job (VN-18).
// @mutate src/components/JobConfirmation.tsx | Cancel job | See what happens
