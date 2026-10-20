/**
 * Cowork design audit 2026-10-20, J6 (looked at on prod, poster-e2e, 375 dark:
 * ~/.lh-shots/audit-musts-1020/before-done@bottom-375-dark.png): the bottom
 * of Jobs > Posted showed the "Done 22 >" and "Cancelled 136 >" rows, then a
 * box saying "That's everything under this view. You also have 14 in Needs
 * You, 2 in Waiting, 1 in Scheduled, 22 in Done and 136 in Cancelled" with a
 * "Show Cancelled" button. Every count was already a status box at the top
 * (Needs you 14 · Waiting 2 · Upcoming 1 · Done 22), the rows right above it
 * said Done and Cancelled again, and it called Upcoming "Scheduled".
 *
 * The class: a list screen states each bucket's count ONCE (its status box).
 * No component outside the empty states restates the other buckets' counts in
 * a sentence after the list. Inventory: every non-test .tsx under src.
 *
 * @mutate src/pages/posts/PostedJobsTab.tsx |   return <div aria-hidden className="mt-auto" />; |   return <p>That's everything under this view. You also have {"1"} in Done.</p>;
 */
import { describe, expect, it } from "vitest";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";

const REPO = resolve(__dirname, "..", "..");
/** Empty states may point at the buckets that DO have posts: their list is empty, so nothing is restated. */
const EMPTY_STATES = new Set(["src/components/job-card/ActivityEmptyState.tsx"]);

describe("J6: the Posted list does not restate its status boxes", () => {
  it("no list footer says 'That's everything under …' or 'You also have N in …'", () => {
    const files = walkSource([join(REPO, "src")]).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) && !f.includes("/src/test/"));
    expect(files.length).toBeGreaterThan(500);
    const offenders = files
      .map((f) => ({ f: relative(REPO, f), src: blankComments(readSource(f) ?? "") }))
      .filter(({ f }) => !EMPTY_STATES.has(f))
      .filter(({ src }) => /That's everything under|You also have\b/.test(src))
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it("the Posted list's tail is only the spacer", () => {
    const src = blankComments(readSource(join(REPO, "src/pages/posts/PostedJobsTab.tsx")) ?? "");
    const tail = /function ListTail\(\)\s*\{([\s\S]*?)\n\}/.exec(src);
    expect(tail, "ListTail not found").not.toBeNull();
    expect(tail![1].trim()).toBe('return <div aria-hidden className="mt-auto" />;');
    expect(src).toMatch(/<ListTail \/>/);
  });
});
