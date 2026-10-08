/**
 * Q1563: a link to a card that is not in the cached list yet waits for the
 * refetch instead of landing on the default tab without it.
 *
 * @mutate src/components/job-card/deepLinkWait.ts |   return named \|\| !fetching; |   return true;
 * @mutate src/components/job-card/JobListPage.tsx |     if (!deepLinkReady({ named, fetching: activityFetching })) return; |
 */
import { describe, expect, it } from "vitest";
import { deepLinkReady } from "./deepLinkWait";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("a deep link waits for the list that has its card", () => {
  it("the card is in the list: resolve now", () => {
    expect(deepLinkReady({ named: true, fetching: true })).toBe(true);
  });
  it("missing while the list refetches: wait (the brand-new application)", () => {
    expect(deepLinkReady({ named: false, fetching: true })).toBe(false);
  });
  it("missing after the refetch: resolve (a job that is gone falls back to the default tab)", () => {
    expect(deepLinkReady({ named: false, fetching: false })).toBe(true);
  });
  it("My Jobs / My Posts consult it before consuming the link", () => {
    const src = readFileSync(join(process.cwd(), "src/components/job-card/JobListPage.tsx"), "utf8");
    expect(src).toMatch(/if \(!deepLinkReady\(\{ named, fetching: activityFetching \}\)\) return;\n {4}deepLinkResolvedFor\.current = deepLinkKey;/);
  });
});
