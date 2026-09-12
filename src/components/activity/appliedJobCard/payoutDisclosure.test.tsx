// What the HELPER is told about when they get paid.
//
// A 2026-09-06 end-to-end review followed the money through a full loop and
// found the app describing a payment that had not been scheduled yet. After
// the poster approves, `create-payment` sets:
//
//     payment_status     = 'payout_pending'
//     payout_scheduled_at = now + PAYOUT_HOLD_HOURS
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
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  AUTO_COMPLETE_HOURS,
  PAYOUT_HOLD_HOURS,
  TOTAL_TO_PAYOUT_HOURS,
} from "../../../../supabase/functions/_shared/escrowTiming";

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
const CARD_DIR = resolve(process.cwd(), "src/components/activity/appliedJobCard");
const cardFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) return cardFiles(full);
    return e.name.endsWith(".tsx") && !e.name.includes(".test.") ? [full] : [];
  });
const SRC = cardFiles(CARD_DIR).map((f) => readFileSync(f, "utf8")).join("\n");
/** Strip comments — the history above is written in them and quotes the old copy. */
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * The terminal state — poster has approved — and everything the card says
 * after it. It used to be found by slicing at the literal condition
 * `job.helper_completed_at && job.poster_completed_at`; the split named that
 * condition (`fullyComplete`) and moved it into SubmittedStep, so the slice
 * silently returned the WHOLE file and the assertions below passed for the
 * wrong reason before they failed for the right one. Anchor on the named
 * branch, and fail loudly if the anchor itself ever disappears.
 */
function terminalBranch(): string {
  const at = SRC.indexOf("const fullyComplete");
  expect(at, "SubmittedStep no longer names its terminal branch `fullyComplete`").toBeGreaterThan(-1);
  return SRC.slice(at);
}

describe("the helper is told when the money actually moves", () => {
  it("states the payout hold rather than implying payment at approval", () => {
    // The number must be INTERPOLATED from escrowTiming, never retyped: the
    // cron reads that constant, so a hardcoded "24" is a second registry that
    // goes stale silently the moment the hold changes.
    expect(code).toContain("PAYOUT_HOLD_HOURS");
    const interpolations = code.match(/\$\{PAYOUT_HOLD_HOURS\}|\{PAYOUT_HOLD_HOURS\}/g) ?? [];
    expect(interpolations.length).toBeGreaterThanOrEqual(3);
  });

  it("never tells the helper the money is already on its way at approval", () => {
    // The exact sentence that shipped, on the instant-release branch. It
    // described a transfer that create-payment had not scheduled yet — and
    // `auto_release_on_complete`, the flag behind it, only skips the poster's
    // REVIEW window; it does not touch the payout hold.
    expect(code).not.toContain("it's on its way");
    expect(code).not.toMatch(/payment will automatically be released to you/i);
    expect(code).not.toMatch(/Payment will auto-release to you when this timer expires/i);
  });

  it("says something about money in the completed state", () => {
    // The regression that hurt most was SILENCE. Assert the terminal branch
    // still speaks to the payout rather than reverting to a bare chip.
    expect(terminalBranch()).toMatch(/payout/i);
    expect(terminalBranch()).toContain("PAYOUT_HOLD_HOURS");
  });

  it("distinguishes released from merely approved", () => {
    // 'released' is the only state in which the transfer has actually fired.
    expect(terminalBranch()).toContain('payment_status === "released"');
  });
});

describe("the schedule the copy describes is the one the cron runs", () => {
  it("keeps the two legs distinct", () => {
    // Approval window and payout hold are different clocks. Copy that collapses
    // them is how "released to you in 24 hours" came to describe a 48-hour trip.
    expect(TOTAL_TO_PAYOUT_HOURS).toBe(AUTO_COMPLETE_HOURS + PAYOUT_HOLD_HOURS);
    expect(PAYOUT_HOLD_HOURS).toBeGreaterThan(0);
  });

  it("matches the hold create-payment actually writes", () => {
    // The source of the whole finding: an unconditional +24h at the release
    // write. If that literal changes, this fails and the copy gets revisited.
    const fn = readFileSync(
      resolve(process.cwd(), "supabase/functions/create-payment/index.ts"),
      "utf8",
    );
    expect(fn).toContain("Date.now() + 24 * 60 * 60 * 1000");
    expect(PAYOUT_HOLD_HOURS).toBe(24);
  });
});
