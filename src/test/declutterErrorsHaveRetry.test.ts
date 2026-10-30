/**
 * CLASS GUARD (Declutter audit 2026-10-28): when a Declutter read fails, the screen says so with a way to try again
 * (the shared ErrorState with onRetry), never a grey line. Four did not: the meeting spot and the donation receipts
 * said "... couldn't load. Pull to refresh." (no button, and a desktop page cannot be pulled), a paid order's pickup
 * address and a seller delivery's open times showed one line with no retry.
 *
 * Inventory from source: every non-test .tsx under src/components/declutter, comments blanked.
 *   1. No "Pull to refresh" anywhere.
 *   2. Every `if (<query>.isError ...) return ...` early return is one of: <ErrorState ... onRetry=...>; its own
 *      "Try again" (a refetch() in the returned markup); the item page's designed DeclutterItemUnavailable; or null,
 *      where the section is an optional extra that simply does not show (a price hint, a bundle card).
 *   AutoFreeRow (a manage-listing row) was listed here until OWN-FREE (2026-10-30) gave it ErrorState with onRetry.
 *
 * @mutate src/components/declutter/DeclutterMeetup.tsx |   if (meetup.isError) return <ErrorState variant="inline" title="We couldn't load the meeting spot." body={meetupErrorMessage(meetup.error)} onRetry={() => void meetup.refetch()} />; |   if (meetup.isError) return <p role="alert">The meeting spot couldn't load. Pull to refresh.</p>;
 * @mutate src/components/declutter/SellerDeliveryOrder.tsx | body={sellerDeliveryErrorMessage(times.error)} onRetry={() => void times.refetch()} /> | body={sellerDeliveryErrorMessage(times.error)} />
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const files = walkSource([join(ROOT, "src/components/declutter")], [".tsx"]).filter((f) => !/\.test\.tsx$/.test(f));

describe("a failed Declutter read offers a retry", () => {
  it("reads a real Declutter source tree", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it('never "Pull to refresh"', () => {
    expect(files.filter((f) => /pull to refresh/i.test(blankComments(readFileSync(f, "utf8")))).map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("every isError early return renders ErrorState with onRetry", () => {
    const bad: string[] = [];
    let seen = 0;
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/if \(([^)]*\.isError[^)]*)\)\s*(?:\{\s*)?return\s+([^;]*);/g)) {
        seen++;
        const ok = /<ErrorState\b[^>]*\bonRetry=/.test(m[2]) || /\.refetch\(/.test(m[2]) || /^null\b/.test(m[2].trim()) || /^<DeclutterItemUnavailable\b/.test(m[2].trim());
        if (!ok) bad.push(`${relative(ROOT, f)}: if (${m[1]}) return ${m[2].slice(0, 80)}`);
      }
    }
    expect(seen).toBeGreaterThan(15);
    expect(bad).toEqual([]);
  });
});
