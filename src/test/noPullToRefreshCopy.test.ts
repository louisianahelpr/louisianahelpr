/**
 * CLASS GUARD (AUD31-82): member copy never tells anyone to "Pull to refresh".
 *
 * A desktop page cannot be pulled, so "...this job may have been cancelled. Pull to refresh." (JobTracking,
 * JobConfirmation) told a desktop member to do something they could not do. Declutter had already dropped it
 * (declutterErrorsHaveRetry.test.ts); the Jobs refusals, lifecycle error words and a few cards still said it.
 * They now say "Refresh the page", which is true on a phone and a desktop.
 *
 * Inventory: every tracked .ts/.tsx under src/ that is not a test, comments blanked. The one exemption is the
 * pull indicator itself (PullToRefreshWrapper), drawn only while a finger is pulling.
 *
 * @mutate src/lib/lifecycleErrors.ts |     job_not_completable: "This job isn't active any more, so it can't be marked done. Refresh the page.", |     job_not_completable: "This job isn't active any more, so it can't be marked done. Pull to refresh.",
 * @mutate src/components/JobTracking.tsx | this job may have been cancelled. Refresh the page. | this job may have been cancelled. Pull to refresh.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
// @two-way src/test/noPullToRefreshCopy.test.ts:stale baseline entry in EXEMPT
const EXEMPT = new Set(["src/components/PullToRefreshWrapper.tsx"]);
const files = trackedFiles("src").filter(
  (f) => /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.(ts|tsx)$/.test(f) && !f.startsWith("src/test/"),
);

describe('member copy never says "Pull to refresh" (a desktop page cannot be pulled)', () => {
  it("reads a real source tree", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it("no source outside the pull indicator says it", () => {
    const bad = files.filter((f) => !EXEMPT.has(f) && /pull to refresh/i.test(blankComments(readFileSync(resolve(ROOT, f), "utf8"))));
    expect(bad).toEqual([]);
  });

  it("the exemption is still needed (the indicator still says it)", () => {
    for (const f of EXEMPT) expect(/pull to refresh/i.test(blankComments(readFileSync(resolve(ROOT, f), "utf8"))), `stale baseline entry in EXEMPT — remove it (lower the baseline): ${f}`).toBe(true);
  });
});
