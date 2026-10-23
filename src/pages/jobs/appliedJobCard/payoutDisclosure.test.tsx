// What the HELPER is told about when they get paid.
//
// A 2026-09-06 end-to-end review followed the money through a full loop and
// found the app describing a payment that had not been scheduled yet. After
// the poster approves, `create-payment` sets:
//
//     payment_status     = 'payout_pending'
//     payout_scheduled_at = approval + STANDARD_PAYOUT_HOURS_AFTER_APPROVAL (owner 2026-10-23)
//
// and `process-scheduled-payouts` fires the transfer only once that passes.
// The helper is paid a DAY after approval. Every string around that moment
// pointed at the moment itself: the helper's CTA is "I'm Done — Request
// Payout", the poster's is "Release Payment", the waiting card promised
// "payment will automatically be released to you", and the terminal state —
// the one place a helper looks to find out what happened to their money —
// said "Job complete" and nothing else at all.
//
// Nobody was underpaid. But a helper reading those words checks their bank a
// day early and finds nothing, which is indistinguishable from a broken
// payout the first time it happens.
//
// These assertions are about TRUTHFULNESS, not wording, so they check the two
// things that make the copy true: an approved-but-unpaid job must say the
// payout is still ahead, and it must not claim the money has already moved.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "../../../test/helpers/blankNonCode";
import {
  APPROVAL_WINDOW_HOURS,
  STANDARD_PAYOUT_HOURS_AFTER_APPROVAL,
} from "../../../../supabase/functions/_shared/escrowTiming";
import { readdirSync } from "../../../test/helpers/trackedFiles";

/**
 * EVERY file of the helper's applied card, not one named file.
 *
 * This read `ActiveJobSection.tsx` alone, and the card was split into a
 * container plus one component per step on 2026-09-11 — at which point the
 * payout sentences lived in `steps/SubmittedStep.tsx` and this suite was
 * asserting about a file that no longer contained the copy it was policing. A
 * test that names one path is a registry checked against itself; derive the set
 * from the directory instead, so a future split cannot silently empty it.
 */
const CARD_DIR = resolve(process.cwd(), "src/pages/jobs/appliedJobCard");
const cardFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) return cardFiles(full);
    return e.name.endsWith(".tsx") && !e.name.includes(".test.") ? [full] : [];
  });
const SRC = cardFiles(CARD_DIR).map((f) => readFileSync(f, "utf8")).join("\n");
/** Strip comments — the history above is written in them and quotes the old copy. */
// Was a deleting comment-stripper. A regex cannot tell it is inside a string, so a
// `/` + `*` in a URL or regex literal opens a comment that runs to the next `*` + `/`
// anywhere later and takes the real code between. Measured 2026-09-21: 157 of 1,054
// source files lose real code to that chain, one of them 98% of its own.
// `blankComments` scans left-to-right, string-aware, and blanks in place so offsets
// survive. (SQL needs `blankSqlComments` — `--`, nesting, '' escaping, $tag$ bodies.)
const code = blankComments(SRC);

/**
 * The terminal state — poster has approved — and ONLY what the card says in it.
 *
 * It used to be found by slicing at the literal condition
 * `job.helper_completed_at && job.poster_completed_at`; the split named that
 * condition (`fullyComplete`) and moved it into SubmittedStep, so the slice
 * silently returned the WHOLE file and the assertions below passed for the
 * wrong reason before they failed for the right one.
 *
 * AND THEN IT KEPT DOING EXACTLY THAT. The re-anchor to `const fullyComplete`
 * landed on the DECLARATION — two lines into the component — and still ran to
 * the end of the file, so the slice still contained the not-yet-approved arm.
 * Measured by mutation 2026-09-21: deleting the terminal sentence outright
 * ("Approved. Your payout releases {PAYOUT_HOLD_HOURS} hours after approval…")
 * left all six tests GREEN, because `PAYOUT_HOLD_HOURS` and the word "payout"
 * were still inside the slice four times over — from the other branch. The one
 * regression this file says hurt most, silence in the completed state, was the
 * one it could not see.
 *
 * So take the branch itself: the parenthesised consequent of
 * `fullyComplete ? ( … )`, matched by paren depth on the comment-blanked copy
 * so a `(` in the prose above cannot move the boundary.
 */
function terminalBranch(): string {
  const cond = code.indexOf("fullyComplete ? (");
  expect(cond, "SubmittedStep no longer branches its notice on `fullyComplete ? (`").toBeGreaterThan(-1);
  const open = code.indexOf("(", cond + "fullyComplete ?".length);
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") {
      depth -= 1;
      if (depth === 0) return SRC.slice(open + 1, i);
    }
  }
  throw new Error("SubmittedStep's `fullyComplete ? (` never closes");
}

describe("the helper is told when the money actually moves", () => {
  it("states when the payout is sent rather than implying payment at approval", () => {
    // INTERPOLATED from escrowTiming, never retyped (owner 2026-10-23: the payout is sent
    // STANDARD_PAYOUT_PHRASE after the approval, and once scheduled the card names the DAY).
    const interpolations = code.match(/\$\{STANDARD_PAYOUT_PHRASE\}|\{STANDARD_PAYOUT_PHRASE\}/g) ?? [];
    expect(interpolations.length).toBeGreaterThanOrEqual(3);
    expect(code).toMatch(/payoutDayLabel\(job\.payout_scheduled_at\)/);
  });

  it("never tells the helper the money is already on its way at approval", () => {
    // The exact sentence that shipped, on the instant-release branch. It
    // described a transfer that create-payment had not scheduled yet — and
    // `auto_release_on_complete`, the flag behind it, only skips the poster's
    // REVIEW window; it does not touch the payout hold.
    expect(code).not.toContain("it's on its way");
    expect(code).not.toMatch(/payment will automatically be released to you/i);
    expect(code).not.toMatch(/Payment will auto-release to you when this timer expires/i);
    // Owner 2026-10-23: nothing is released on a timer.
    expect(code).not.toMatch(/completes automatically/i);
  });

  it("says something about money in the completed state", () => {
    // The regression that hurt most was SILENCE. Assert the terminal branch
    // still speaks to the payout rather than reverting to a bare chip.
    expect(terminalBranch()).toMatch(/payout/i);
    // Owner 2026-10-23: the DAY once it is scheduled, else the rule.
    expect(terminalBranch()).toContain("{payDay}");
    expect(terminalBranch()).toContain("STANDARD_PAYOUT_PHRASE");
  });

  it("distinguishes released from merely approved", () => {
    // 'released' is the only state in which the transfer has actually fired.
    expect(terminalBranch()).toContain('payment_status === "released"');
  });
});

describe("the schedule the copy describes is the one the cron runs", () => {
  it("keeps the two clocks distinct", () => {
    // The poster's approval window and the payout clock are different clocks. Copy that collapses
    // them is how "released to you in 24 hours" came to describe a 72-hour trip.
    expect(APPROVAL_WINDOW_HOURS).toBe(24);
    expect(STANDARD_PAYOUT_HOURS_AFTER_APPROVAL).toBe(72);
  });

  it("matches the schedule create-payment actually writes", () => {
    // The source of the whole finding was an unconditional +24h at the release
    // write. The release write schedules the standard payout 3 days after the
    // poster's APPROVAL (owner 2026-10-23), from the shared function the copy's
    // STANDARD_PAYOUT_PHRASE is built from. A literal comes back → red.
    const fn = readFileSync(
      resolve(process.cwd(), "supabase/functions/create-payment/index.ts"),
      "utf8",
    );
    expect(fn).toMatch(/const payoutTime = standardPayoutAtIso\(isPoster \? null : job\.poster_completed_at\);/);
    expect(fn).not.toContain("Date.now() + 24 * 60 * 60 * 1000");
  });
});

// SILENCE IN THE COMPLETED STATE — the regression this file exists for. Until
// 2026-09-21 this exact mutation SURVIVED (terminalBranch() ran to the end of
// the file and read the other branch's copy); it now fails on the missing
// day inside the approved arm (STANDARD_PAYOUT_PHRASE before 2026-10-23, PAYOUT_HOLD_HOURS before Q202).
// @mutate src/pages/jobs/appliedJobCard/steps/SubmittedStep.tsx | <>Approved. Your payout will be sent {payDay}, then lands | <>Approved. then lands
