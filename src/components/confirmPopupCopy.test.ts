import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

/**
 * Owner wording decisions, 2026-09-14 (pop-up, visual-notes follow-ups).
 *
 * The Helpr's Mark Job Complete confirm read "Request Your Payout?" with a
 * "Yes, I'm Done" button: the card says Mark Job Complete, the popup it
 * opens talked about money. Now "Mark This Job Complete?" / "Mark Complete".
 *
 * The confirm-booking popup's hand-off link read "Can't make it? See what
 * happens". It opens the real cancel flow, so it now says "Cancel Job", the
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
 * `title="Mark This Job Complete?"` would satisfy the positive assertions
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

describe("Mark Job Complete confirm popup", () => {
  const tracking = src("JobTracking.tsx");

  it("asks to mark the job complete, not to request a payout", () => {
    expect(tracking).toContain('title="Mark This Job Complete?"');
    expect(tracking).toContain('primaryLabel="Mark Complete"');
    expect(tracking).not.toContain("Request Your Payout?");
    expect(tracking).not.toMatch(/Yes, I['’]m Done/);
  });
});

describe("confirm-booking popup cancel link", () => {
  const confirmation = src("JobConfirmation.tsx");

  it("reads Cancel Job", () => {
    const link = confirmation.match(/onCantMakeIt\(\); \}\}[\s\S]*?>\s*([^<{]+?)\s*<\/button>/);
    expect(link, "could not find the onCantMakeIt link in JobConfirmation.tsx; re-read it").toBeTruthy();
    expect(link![1]).toBe("Cancel Job");
    expect(confirmation).not.toMatch(/See what happens/);
  });
});

// Owner, 2026-09-14: the card says Mark Job Complete and the popup it opens
// talked about money. This is that popup reverting.
// @mutate src/components/JobTracking.tsx | title="Mark This Job Complete?" | title="Request Your Payout?"
// The confirm-booking hand-off link reverting to euphemism: it opens the real
// cancel flow, so it has to say Cancel Job (VN-18).
// @mutate src/components/JobConfirmation.tsx | Cancel Job | See what happens
