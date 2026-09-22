import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE CLASS: a journey `page.goto` that the app's own stale-chunk recovery
 * reload can interrupt.
 *
 * `hardReloadBypassCache` (src/lib/chunkReload.ts) recovers from a cancelled
 * module preload by `location.replace(href + "&_v=<now>")` — it reloads the
 * page being LEFT. When that fires while a `page.goto` is in flight, WebKit
 * reports "Navigation to X is interrupted by another navigation to Y", where Y
 * is the OLD screen plus `_v=`. It has now eaten two different journeys
 * (notifications.spec.ts deep link, 03-account.spec.ts:66 → /profile in run
 * 35751533019), and was reproduced deterministically in WebKit on 2026-09-22.
 *
 * Fixing one spec at a time would leave the other 39 `page.goto` call sites in
 * e2e/journeys open to it, so the tolerance lives in ONE place — `journey.track`
 * in e2e/journeys/fixtures.ts, which every journey page passes through. This
 * guard is what keeps it there, keeps it NARROW (only the app's own `_v=`
 * reload is excused), and keeps it LOUD (annotated, and it retries once rather
 * than swallowing the failure).
 */
// The wiring is load-bearing and invisible: remove the one line in
// journey.track that installs the wrapper and every journey is exposed again,
// exactly as it was in run 35751533019.
// @mutate e2e/journeys/fixtures.ts | tolerateRecoveryReload(name, page, testInfo); | pages.set(name, page);
// Widening the gate is the other way this stops being a guard: excuse any
// interrupted navigation, not just the app's own `_v=` recovery reload, and a
// genuine navigation bug goes quiet.
// @mutate e2e/journeys/fixtures.ts | \|\| !/[?&]_v= | \|\| !/[?&]zzz=
const fixtures = readFileSync(join(process.cwd(), "e2e/journeys/fixtures.ts"), "utf8");

describe("journey pages tolerate the app's chunk-recovery self-navigation", () => {
  it("every tracked page gets the wrapper, so no spec has to remember", () => {
    const track = /track:\s*\(name,\s*page\)\s*=>\s*\{([\s\S]*?)\n {6}\}/.exec(fixtures)?.[1];
    expect(track, "journey.track is not shaped as expected in e2e/journeys/fixtures.ts").toBeTruthy();
    expect(
      /tolerateRecoveryReload\(\s*name,\s*page,\s*testInfo\s*\)/.test(track as string),
      "journey.track no longer installs tolerateRecoveryReload, so a chunk-recovery reload can again fail any journey's page.goto",
    ).toBe(true);
  });

  it("the wrapper exists and re-runs the ORIGINAL goto exactly once", () => {
    const body = /const tolerateRecoveryReload = [\s\S]*?\n\};/.exec(fixtures)?.[0];
    expect(body, "tolerateRecoveryReload is gone from e2e/journeys/fixtures.ts").toBeTruthy();
    const src = body as string;
    // The retry must call the captured, UNWRAPPED goto, so a second
    // interruption throws instead of looping.
    expect((src.match(/return await goto\(\.\.\.args\);/g) ?? []).length).toBe(2);
    expect(/await page\.waitForTimeout\(/.test(src)).toBe(true);
  });

  it("only the app's own `_v=` recovery reload is excused — nothing else", () => {
    const body = /const tolerateRecoveryReload = [\s\S]*?\n\};/.exec(fixtures)?.[0] as string;
    expect(
      /if \(!to \|\| !\/\[\?&\]_v=\\d\+\/\.test\(to\)\) throw err;/.test(body),
      "the tolerance is no longer gated on the `_v=` cache-buster: it would now swallow REAL interrupted navigations, which is the whole failure this class exists to keep visible",
    ).toBe(true);
  });

  it("the interruption is announced, never silent", () => {
    const body = /const tolerateRecoveryReload = [\s\S]*?\n\};/.exec(fixtures)?.[0] as string;
    expect(
      /testInfo\.annotations\.push\(\{\s*\n?\s*type: "app-self-navigation"/.test(body),
      "a tolerated self-navigation must still be recorded as an annotation",
    ).toBe(true);
  });
});
