/**
 * The e2e calendar picker refuses a browser on the wrong clock.
 *
 * prod-audit run 38181023758 (start 22:35Z, 2026-10-11): interruptions'
 * "double-tap the final Post" failed with "2026-10-11 is present but not
 * selectable". The spec computed a Louisiana day (isoDayIn, America/Chicago)
 * while its browser context ran on the runner's UTC clock, where it was
 * already 10-12, and Post a Job disables days before the DEVICE's today
 * (DatePickerField min = todayLocalISO()). Every evening run from 7 PM CT to
 * midnight hit it.
 *
 * Class: pickCalendarDay asserts the page's own time zone is the one its
 * caller's day was computed in, so any caller on the wrong clock fails on
 * that, by name, instead of on a disabled cell; and every spec that picks a
 * Post a Job day (directly or through fillLogistics) makes its context in that
 * zone.
 *
 * @mutate e2e/calendarPicker.ts |   ).toBe(CALENDAR_ZONE); |   ).toBeDefined();
 * @mutate e2e/prod-audit/interruptions.spec.ts | newUserContext(browser, poster, { timezoneId: "America/Chicago" }) | newUserContext(browser, poster)
 * @mutate e2e/slow-network/slow-network.spec.ts | newUserContext(browser, poster, { timezoneId: ZONE }); | newUserContext(browser, poster);
 */
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

describe("the e2e calendar picker runs in the zone its day is computed in", () => {
  it("pickCalendarDay checks the page's time zone against CALENDAR_ZONE before clicking", () => {
    const src = read("e2e/calendarPicker.ts");
    expect(src).toMatch(/export const CALENDAR_ZONE = "America\/Chicago";/);
    const fn = src.slice(src.indexOf("export async function pickCalendarDay"));
    const check = fn.indexOf("resolvedOptions().timeZone");
    expect(check).toBeGreaterThan(0);
    expect(fn).toMatch(/\)\.toBe\(CALENDAR_ZONE\);/);
    expect(check).toBeLessThan(fn.indexOf("await button.click()"));
  });

  it("every spec that picks a Post a Job day gives its poster context the Louisiana zone", () => {
    const specs = walkSource([join(ROOT, "e2e")], [".ts"])
      .filter((f) => /\.spec\.ts$/.test(f))
      .filter((f) => /\b(pickCalendarDay|fillLogistics)\(/.test(blankComments(readFileSync(f, "utf8"))));
    expect(specs.length).toBeGreaterThanOrEqual(3);
    // The poster is the one who posts: every poster context in these files.
    const posterCalls = specs.flatMap((f) =>
      [...blankComments(readFileSync(f, "utf8")).matchAll(/newUserContext\(\s*browser\s*,\s*(?:S\.)?poster\b[^)]*\)/g)].map((m) => ({ f: relative(ROOT, f), call: m[0] })),
    );
    expect(posterCalls.length).toBeGreaterThanOrEqual(3);
    expect(posterCalls.filter(({ call }) => !/timezoneId/.test(call)).map(({ f, call }) => `${f}: ${call}`)).toEqual([]);
  });
});
