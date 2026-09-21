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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { staleBundleMessage, entryOf } from "./staleBundle";

/** Comments blanked (offsets preserved) so a `// assertFreshBundle(...)` can
 * never stand in for the call. */
const code = (p: string) =>
  readFileSync(resolve(__dirname, "..", "..", p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|\n)[ \t]*\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

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

/**
 * MOUNT-WIRING. Everything above tests a PURE FUNCTION over two strings — it
 * never fetches a server and cannot see a real deployed bundle. All of it is
 * worth exactly nothing if nobody calls it, and that is the one thing a
 * pure-function test cannot check about itself. So pin the chain:
 *   fixtures.ts → assertFreshBundle() → staleBundleMessage() → throw.
 */
describe("the decision is actually wired into the happy-path run", () => {
  it("assertFreshBundle asks staleBundleMessage and THROWS on its answer", () => {
    const src = code("e2e/happy-path/assertFreshBundle.ts");
    expect(src).toMatch(/import\s*\{\s*staleBundleMessage\s*\}\s*from/);
    expect(src).toMatch(/=\s*staleBundleMessage\(\s*baseURL\s*,\s*servedHtml\s*,\s*diskHtml\s*\)/);
    // A logged warning is not a guard: a stale bundle must stop the run.
    expect(src, "a stale bundle must THROW, not warn").toMatch(/if\s*\(message\)\s*throw new Error\(message\)/);
  });

  it("the happy-path fixture calls it with the baseURL", () => {
    expect(code("e2e/happy-path/fixtures.ts")).toMatch(/await assertFreshBundle\(/);
  });
});

// PROVEN RED 2026-09-21. Inverting the comparison ("stale" and "fresh" swapped)
// fails both FIRES and "stays silent when they agree"; cutting the call out of
// the happy-path fixture, or downgrading the throw to a warn, fails the
// mount-wiring pair added the same day.
// SOURCE-TEXT / PURE-FUNCTION PIN: nothing here fetches a server, so it cannot
// see a real deployed bundle. It sees the DECISION and its WIRING; the live
// comparison happens only inside an actual happy-path run.
// @mutate src/test/staleBundle.ts | if (!served || served === want) return null; | if (!served || served !== want) return null;
// @mutate e2e/happy-path/assertFreshBundle.ts | if (message) throw new Error(message); | if (message) console.warn(message);
// @mutate e2e/happy-path/fixtures.ts | await assertFreshBundle( | await Promise.resolve(
