/**
 * The stale-bundle guard, tested for BOTH outcomes.
 *
 * A guard that has never been seen to fire is not a guard. This one's
 * end-to-end proof is genuinely awkward — `vite preview` reads from disk per
 * request so a rebuild cannot desynchronise it, and PLAYWRIGHT_BASE_URL only
 * redirects the chromium project — and two attempts at an end-to-end
 * demonstration came back GREEN, which would have been reported as success.
 * So the decision is a pure function and it is tested directly.
 */
import { describe, it, expect } from "vitest";
import { staleBundleMessage, entryOf } from "./staleBundle";

const page = (entry: string) =>
  `<!doctype html><html><head><script type="module" crossorigin src="/${entry}"></script></head><body></body></html>`;

describe("stale-bundle guard", () => {
  it("finds the hashed entry chunk in a built index.html", () => {
    expect(entryOf(page("assets/index-AubTYSDm.js"))).toBe("assets/index-AubTYSDm.js");
  });

  it("FIRES when the server serves a different build than the one on disk", () => {
    const msg = staleBundleMessage(
      "http://127.0.0.1:4173",
      page("assets/index-OLDBUILD0.js"),
      page("assets/index-NEWBUILD0.js"),
    );
    expect(msg, "a mismatched pair must be refused").not.toBeNull();
    // The message has to name BOTH hashes: the whole failure is that the two
    // differ, and a reader who cannot see which is which learns nothing.
    expect(msg).toContain("assets/index-OLDBUILD0.js");
    expect(msg).toContain("assets/index-NEWBUILD0.js");
    expect(msg).toContain("STALE");
  });

  it("stays silent when they agree", () => {
    const same = page("assets/index-SAMEBUILD.js");
    expect(staleBundleMessage("http://127.0.0.1:4173", same, same)).toBeNull();
  });

  it("stays silent when there is nothing to compare", () => {
    const built = page("assets/index-AubTYSDm.js");
    // No local dist — CI's own `npm run build &&` path, before the build runs.
    expect(staleBundleMessage("u", built, undefined)).toBeNull();
    // Server unreachable — that is the runner's problem, not this check's, and
    // turning it into a second failure would bury the real one.
    expect(staleBundleMessage("u", undefined, built)).toBeNull();
    // A dev-style index with no hashed entry has nothing to compare.
    expect(staleBundleMessage("u", built, "<html><body>dev</body></html>")).toBeNull();
  });
});
