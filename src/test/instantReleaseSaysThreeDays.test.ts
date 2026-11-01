/**
 * Instant Release is an early approval, not an early payment (10-30 jobs audit,
 * item 7). The offer said "payment goes out the moment your Helpr marks done ...
 * no 24-hour wait", and the setting said "Release payment as soon as". A poster
 * gave up their review for that while the Helpr still waited the standard 3 days:
 * auto-release-payment starts the clock at the approval and pays 72 hours later.
 *
 * Both sentences are tied to the number the payout code uses, so changing the wait
 * fails here until the words change with it.
 *
 * @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts | when your Helpr marks done with photo proof. They're paid 3 days later. | and payment goes out the moment your Helpr marks done with photo proof.
 * @mutate src/pages/profile/AutoTip.tsx | with no 24-hour review. They're paid 3 days later. | with no 24-hour review.
 * @mutate supabase/functions/_shared/escrowTiming.ts | export const STANDARD_PAYOUT_DAYS_AFTER_APPROVAL = 3; | export const STANDARD_PAYOUT_DAYS_AFTER_APPROVAL = 2;
 * @mutate supabase/functions/auto-release-payment/index.ts | const payoutTime = standardPayoutAtIso(instantIds.has(job.id) ? null : job.poster_completed_at); | const payoutTime = new Date().toISOString();
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { STANDARD_PAYOUT_DAYS_AFTER_APPROVAL } from "../../supabase/functions/_shared/escrowTiming";

const read = (rel: string) => blankComments(readFileSync(resolve(process.cwd(), rel), "utf8"));
const flat = (s: string) => s.replace(/\s+/g, " ");

const SURFACES = [
  "src/components/job-card/activityActions/useLifecycleHandlers.ts",
  "src/pages/profile/AutoTip.tsx",
];

describe("Instant Release says when the Helpr is really paid", () => {
  it("the payout code still waits the standard days after an Instant Release approval", () => {
    expect(STANDARD_PAYOUT_DAYS_AFTER_APPROVAL).toBe(3);
    expect(read("supabase/functions/auto-release-payment/index.ts")).toContain(
      "standardPayoutAtIso(instantIds.has(job.id) ? null : job.poster_completed_at)",
    );
  });

  it.each(SURFACES)("%s says approve, then the real wait", (file) => {
    const copy = flat(read(file));
    // Floor (vacuity scan): the real surface was read, not an empty or moved file (each about 24 KB on 10-31).
    expect(copy.length).toBeGreaterThan(2_000);
    expect(copy).toContain("photo proof");
    expect(copy).toContain(`They're paid ${STANDARD_PAYOUT_DAYS_AFTER_APPROVAL} days later.`);
  });

  it.each(SURFACES)("%s promises no immediate payment", (file) => {
    const copy = flat(read(file));
    expect(copy).not.toMatch(/payment goes out the moment|no 24-hour wait|release payment as soon as/i);
  });
});
