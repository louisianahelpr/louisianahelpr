/*
 * CLASS CHECK — `await waitFor(() => expect(x).toBeEmptyDOMElement())` waits
 * for nothing.
 *
 * FOUND 2026-09-21, in `HelperStreakBadge.test.tsx`, by the burn-down. Three of
 * its tests — "renders nothing when there are no reviews", "stays hidden at a
 * 2-streak", "does not query Supabase when helperId is falsy" — each asserted:
 *
 *     await waitFor(() => expect(container).toBeEmptyDOMElement());
 *
 * The badge reads `const { data: streak = 0 } = useQuery(...)`, and `0 <
 * MIN_STREAK`, so its FIRST PAINT is empty for every input. `waitFor` polls
 * until its callback stops throwing — and the callback passed on poll #1,
 * before the mocked promise had resolved. The component under test never
 * reached the branch the test was named after.
 *
 * Measured: changing `MIN_STREAK = 3` to `1` — so a 2-streak pill renders on
 * screen — left all three GREEN.
 *
 * WHY IT IS A CLASS AND NOT AN INSTANCE. Every `useQuery`-backed component in
 * this app renders empty, null, or a skeleton on its first pass; that is what
 * `isLoading` means. So for ALL of them, "eventually empty" is indistinguishable
 * from "empty immediately and forever", and a test that waits for emptiness
 * proves only that React mounted. The bug it is meant to catch — the thing
 * appearing when it should not — is invisible by construction.
 *
 * THE FIX, in every case: wait for the DATA, then assert the absence.
 * `HelperStreakBadge.test.tsx` now polls its React Query cache entry to
 * `status === "success"` and asserts the computed streak really arrived (0, 2)
 * BEFORE asserting nothing rendered. Waiting on the query is the real
 * precondition; waiting on the DOM was waiting on the initial state.
 *
 * RATCHET: the list below may only SHRINK.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");

/**
 * Matchers a query-backed component's INITIAL (pre-data) render already
 * satisfies, written as [negated, matcher].
 *
 * `toBeVisible` and `not.toBeVisible` are opposite claims and must never be
 * conflated — a first cut at this compared bare matcher names and so read a
 * POSITIVE `toBeVisible()` as vacuous, which is exactly backwards.
 */
const SATISFIED_BY_FIRST_PAINT = new Set([
  "toBeEmptyDOMElement",
  "toBeNull",
  "not.toBeInTheDocument",
  "not.toBeVisible",
  "not.toBeTruthy",
]);

/** Every matcher invocation in `body`, as `not.toX` or `toX`. */
function matchersIn(body: string): string[] {
  return [...body.matchAll(/\.(not\.)?(to[A-Za-z]+)\s*\(/g)].map(
    (m) => (m[1] ? "not." : "") + m[2],
  );
}

/**
 * `waitFor(...)` calls whose body contains ONLY first-paint-satisfied matchers.
 *
 * A MIXED body is fine and common — `waitFor(() => { expect(a).toBeVisible();
 * expect(b).not.toBeInTheDocument(); })` really does wait, because the positive
 * half cannot pass until the data lands. It is the all-negative body that
 * returns on poll #1.
 */
function vacuousWaits(src: string): string[] {
  const code = blankComments(src);
  const out: string[] = [];
  for (const m of code.matchAll(/\bwaitFor\s*\(/g)) {
    const start = m.index! + m[0].length - 1; // at the "("
    let depth = 0;
    let end = start;
    for (let i = start; i < code.length; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
    }
    const body = code.slice(start, end + 1);
    const matchers = matchersIn(body);
    if (matchers.length === 0) continue;
    if (matchers.every((x) => SATISFIED_BY_FIRST_PAINT.has(x))) {
      out.push(body.slice(0, 90).replace(/\s+/g, " "));
    }
  }
  return out;
}

function testFiles(): string[] {
  return execFileSync("git", ["ls-files", "--", "src/*.test.tsx", "src/*.test.ts"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 1 << 24,
  })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * Known, reported, NOT fixed here — a ratchet, not an excuse. MAY ONLY SHRINK.
 *
 * Each of these waits for a condition its component's first paint already
 * satisfies, so each is a CANDIDATE hollow test: the branch it is named after
 * may never be reached. That is not proven for any of them individually — only
 * `HelperStreakBadge` was, by mutation (MIN_STREAK 3 -> 1 left three tests
 * green while a 2-streak pill rendered), and it is fixed and absent from this
 * list. The rest need the same treatment one at a time.
 *
 * Note the list was NOT hand-written: a first attempt guessed three files and
 * got one of them wrong in each direction (it named two files that do not have
 * the shape and missed four that do). Derived from the scan, then read back
 * from the scan's own output rather than from a test-failure diff — the diff
 * was truncated and the first correction was wrong too.
 */
const GRANDFATHERED: readonly string[] = [
  "src/components/AppLockGate.test.tsx",
  "src/components/BrowseMap.test.tsx",
  "src/components/profile/PublicReviewWall.test.tsx",
  "src/hooks/useAuthReady.test.tsx",
  "src/hooks/useDrivingTime.bound.test.tsx",
  "src/test/tripDistanceTrustAndBound.test.tsx",
];

describe("a waitFor that waits for emptiness waits for nothing", () => {
  const offenders = testFiles().filter((f) => vacuousWaits(readFileSync(resolve(REPO, f), "utf8")).length > 0);

  it("the detector actually fires on the shape it is about", () => {
    // Without this the ratchet below could silently stop ratcheting.
    expect(
      vacuousWaits('await waitFor(() => expect(container).toBeEmptyDOMElement());').length,
    ).toBe(1);
    // A body with a POSITIVE assertion in it is a real wait and must not fire.
    expect(
      vacuousWaits('await waitFor(() => { expect(a).toBeVisible(); expect(b).not.toBeInTheDocument(); });').length,
    ).toBe(0);
  });

  it("no NEW test waits for an initial state", () => {
    const known = new Set(GRANDFATHERED);
    const added = offenders.filter((f) => !known.has(f));
    expect(
      added,
      "`waitFor` polls until its callback stops throwing. A query-backed component's FIRST paint " +
        "is already empty, so this callback passes on poll #1 — before the mocked promise resolves — " +
        "and the branch the test is named after is never reached. Wait for the DATA (poll the query " +
        "cache to success), THEN assert the absence. See HelperStreakBadge.test.tsx.",
    ).toEqual([]);
  });

  it("the grandfathered list only shrinks", () => {
    const live = new Set(offenders);
    const stale = GRANDFATHERED.filter((f) => !live.has(f));
    expect(stale, "these no longer wait for an initial state — remove them from GRANDFATHERED").toEqual([]);
  });
});

// PROVEN RED 2026-09-21: removing an entry from GRANDFATHERED while that file
// still carries the shape fails "the grandfathered list only shrinks"; adding
// the shape to any other test file fails "no NEW test waits for an initial
// state". The detector's own two cases fail if the body-scan stops
// distinguishing an all-negative wait from a mixed one.
// SOURCE-TEXT PIN: this reads test source. It finds the SHAPE, not the
// vacuity — a `waitFor(empty)` on a component whose first paint is NOT empty
// is harmless and would still be flagged, and a test that waits wrongly by some
// other route is outside its inventory.
// @mutate src/components/profile/HelperStreakBadge.test.tsx | expect(await awaitStreakQuery(client, "helper-1")).toBe(2); | await waitFor(() => expect(container).toBeEmptyDOMElement());
