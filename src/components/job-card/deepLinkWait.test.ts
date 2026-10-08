/**
 * Q1563: a link to a card that is not in the cached list yet waits for the
 * refetch instead of landing on the default tab without it. Owner, 2026-10-08:
 * "after application sent, i clicked view in my jobs but then it took me to
 * needs you instead of waiting" — the first render read "not fetching" before
 * the stale list's refetch had started, so the link resolved without its card.
 *
 * @mutate src/components/job-card/deepLinkWait.ts |   return named \|\| settled; |   return true;
 * @mutate src/components/job-card/deepLinkWait.ts |   return queries.every((q) => !q.stale \|\| q.updatedAt >= openedAt); |   return true;
 * @mutate src/components/job-card/JobListPage.tsx |     if (!deepLinkReady({ named, settled: activitySettled })) return; |
 */
import { describe, expect, it } from "vitest";
import { activitySettled, deepLinkReady } from "./deepLinkWait";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OPENED = 1_000;

describe("a deep link waits for the list that has its card", () => {
  it("the card is in the list: resolve now", () => {
    expect(deepLinkReady({ named: true, settled: false })).toBe(true);
  });
  it("missing before the list settles: wait (the brand-new application)", () => {
    expect(deepLinkReady({ named: false, settled: false })).toBe(false);
  });
  it("missing after the list settles: resolve (a job that is gone falls back to the default tab)", () => {
    expect(deepLinkReady({ named: false, settled: true })).toBe(true);
  });

  it("the first render (stale list, refetch not started yet) is NOT settled — the owner's bug", () => {
    expect(activitySettled([{ isFetching: false, stale: true, updatedAt: OPENED - 60_000 }], OPENED)).toBe(false);
  });
  it("while the refetch runs: not settled", () => {
    expect(activitySettled([{ isFetching: true, stale: true, updatedAt: OPENED - 60_000 }], OPENED)).toBe(false);
  });
  it("refreshed after the page opened: settled", () => {
    expect(activitySettled([{ isFetching: false, stale: false, updatedAt: OPENED + 500 }], OPENED)).toBe(true);
  });
  it("a fresh cache that needs no refetch: settled", () => {
    expect(activitySettled([{ isFetching: false, stale: false, updatedAt: OPENED - 5 }], OPENED)).toBe(true);
  });

  it("My Jobs / My Posts consult it before consuming the link", () => {
    const src = readFileSync(join(process.cwd(), "src/components/job-card/JobListPage.tsx"), "utf8");
    expect(src).toMatch(/if \(!deepLinkReady\(\{ named, settled: activitySettled \}\)\) return;\n {4}deepLinkResolvedFor\.current = deepLinkKey;/);
  });
});
