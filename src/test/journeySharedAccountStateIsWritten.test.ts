import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

/**
 * Q280: two journey failures in e2e-journeys run 35905284660, neither an app
 * defect, both the same shape: the spec believed a state of the SHARED test
 * accounts that it had not established.
 *
 * 1. HELD WRITES. On the `slow` rotation the harness holds every backend call
 *    3-8s in a route handler. 03-account (WebKit) clicked "Save Helpr", saw the
 *    OPTIMISTIC "Unsave Helpr", navigated, and the favorite_helpers POST died
 *    in that handler (trace status -1; no POST in the API gateway's edge_logs).
 *    route.continue() does not throw when that happens (probed in WebKit and
 *    Chromium), so the fixture tracks each held user write until its response
 *    and fails a passing test on any that never got one, naming it.
 *
 * 2. AVAILABILITY COPY. time-travel reads AvailabilityTab's OFF-state copy
 *    ("Ready until 5:00 PM") under a moved clock. The shared poster's
 *    `available_until` had been left at 5:00 PM Central by a press run, so the
 *    app CORRECTLY showed "Available now · Until 5:00 PM" and the spec failed
 *    in both engines. Any spec asserting that copy must clear the signal
 *    itself, through the app's RPC, before it looks.
 */

// Held writes stop being tracked: one that never leaves the browser is silent again.
// @mutate e2e/journeys/fixtures.ts | trackHeldWrite(route.request()); | void route.request();
// "Answered" stops meaning a response arrived (continue() resolving proves nothing).
// @mutate e2e/journeys/fixtures.ts | req.response().then((r) => r !== null, () => false) | Promise.resolve(true)
// The record is kept but nothing fails on it.
// @mutate e2e/journeys/fixtures.ts | expect(lostWrites, | void (lostWrites,
// The time-travel spec stops clearing the shared poster's "Available now" signal.
// @mutate e2e/journeys/time-travel.spec.ts | /rest/v1/rpc/clear_available_now` | /rest/v1/rpc/noop`

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const fixtures = blankComments(read("e2e/journeys/fixtures.ts"));

function specFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...specFiles(rel));
    else if (/\.spec\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

describe("journeys write the shared-account state they depend on", () => {
  it("the slow row tracks every held request it releases until its response", () => {
    const slow = /network === "slow"\) \{([\s\S]*?)\n {2}\} else if/.exec(fixtures)?.[1];
    expect(slow, "the slow-rotation route handler is not shaped as expected in e2e/journeys/fixtures.ts").toBeTruthy();
    const releases = (slow as string).split(/route\.continue\(\)/).length - 1;
    expect(releases, "no route.continue() in the slow handler").toBeGreaterThan(0);
    const tracked = ((slow as string).match(/trackHeldWrite\(route\.request\(\)\);\s*await route\.continue\(\)/g) ?? []).length;
    expect(tracked, "a held request is released without trackHeldWrite(): a write lost to the test's own navigation is silent").toBe(releases);
    // continue() resolves even when navigation cancelled the request, so only a response proves the write was sent.
    const track = /function trackHeldWrite\(req: Request\) \{([\s\S]*?)\n\}/.exec(fixtures)?.[1] ?? "";
    expect(track, "trackHeldWrite must judge a write by whether its response arrived").toContain("req.response().then((r) => r !== null, () => false)");
    expect(fixtures).toMatch(/const lostWrites = await heldWritesNeverAnswered\([\d_]+\);/);
  });

  it("a lost user write fails a passing journey, and only telemetry is exempt", () => {
    expect(fixtures).toMatch(/if \(testInfo\.status === "passed"\) \{\s*expect\(lostWrites, "[^"]*"\)\.toEqual\(\[\]\);/);
    expect(fixtures).toMatch(/heldWrites = \[\];/); // reset per test
    const exempt = /const FIRE_AND_FORGET_RX = (\/.*\/);/.exec(fixtures)?.[1] ?? "";
    // The exemption must not cover the tables users write on purpose.
    for (const table of ["favorite_helpers", "saved_searches", "notification_preferences", "profiles", "helper_availability", "jobs", "applications", "messages"]) {
      expect(exempt.includes(table), `${table} is exempted from the lost-write check`).toBe(false);
    }
  });

  it("every spec that asserts AvailabilityTab's off-state copy clears available_until first", () => {
    const tab = read("src/components/profile/AvailabilityTab.tsx");
    const off = /const offSubtitle = useCallback\(\(\) => \{([\s\S]*?)\}, \[todaysHours\]\);/.exec(tab)?.[1];
    expect(off, "offSubtitle is not shaped as expected in AvailabilityTab.tsx").toBeTruthy();
    // The fixed words before the first interpolation of each off-state line.
    const phrases = [...(off as string).matchAll(/return `([^`$]+)/g)].map((m) => m[1].trim()).filter((p) => p.length >= 8);
    expect(phrases.length, `off-state phrases read from AvailabilityTab: ${phrases.join(" | ")}`).toBeGreaterThanOrEqual(3);

    const asserting = specFiles("e2e").filter((f) => {
      const code = blankComments(read(f));
      return phrases.some((p) => code.includes(p));
    });
    expect(asserting.length, "no spec asserts the off-state copy; the inventory went empty").toBeGreaterThan(0);
    const missing = asserting.filter((f) => !/\/rest\/v1\/rpc\/clear_available_now`/.test(blankComments(read(f))));
    expect(missing, "these specs assert the OFF copy without clearing the shared account's available_until").toEqual([]);
  });
});
