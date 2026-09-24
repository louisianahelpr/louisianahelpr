/**
 * N-003: Quiet Hours is a WALL-CLOCK window, and the server must read it as one.
 *
 * notification_preferences.quiet_start / quiet_end are `time without time zone`
 * values typed into an <input type="time"> on /profile?tab=notifications and
 * drawn on a "24hr local" clock (QuietHoursClock.tsx). send-push-notification
 * compared them against `now.getUTCHours()`, so a Louisiana user's 22:00-07:00
 * window actually muted 17:00-02:00 local — all evening, then pushes resumed at
 * 2am. No per-user timezone is stored (information_schema, 2026-09-23: no
 * timezone/tz column on any public table), so quietHours.ts evaluates the
 * window in America/Chicago.
 *
 * The CLASS: any edge function that decides by hour-of-day. `getUTCHours()` /
 * `getHours()` both answer in UTC on Supabase's runtime, which is never the
 * Louisiana wall clock, so no edge function may read an hour that way; the one
 * sanctioned reader is quietHours.ts's Intl-based `localMinutes`.
 *
 * PROVEN RED 2026-09-23 on each @mutate below (scripts/vacuity).
 */
// @mutate supabase/functions/send-push-notification/quietHours.ts | const nowMin = localMinutes(now, timeZone) | const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes()
// @mutate supabase/functions/send-push-notification/quietHours.ts | export const QUIET_HOURS_TIME_ZONE = 'America/Chicago' | export const QUIET_HOURS_TIME_ZONE = 'UTC'
// @mutate supabase/functions/send-push-notification/index.ts | isInQuietHours(quietPrefs.quiet_start, quietPrefs.quiet_end, new Date()) | isInQuietHours(quietPrefs.quiet_start, quietPrefs.quiet_end, new Date(), 'UTC')
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "../helpers/blankNonCode";

// Non-literal specifier: tsconfig.app.json does not include supabase/functions
// modules (TS6307); this one is typechecked by `npm run typecheck:edge`.
const QUIET_PATH = "../../../supabase/functions/send-push-notification/quietHours.ts";
const { isInQuietHours, QUIET_HOURS_TIME_ZONE } = (await import(/* @vite-ignore */ QUIET_PATH)) as {
  isInQuietHours(start: string, end: string, now: Date, timeZone?: string): boolean;
  QUIET_HOURS_TIME_ZONE: string;
};

const ROOT = join(__dirname, "../../..");
const FUNCTIONS = join(ROOT, "supabase/functions");

describe("quiet hours are evaluated on the Louisiana wall clock", () => {
  it("uses America/Chicago", () => {
    expect(QUIET_HOURS_TIME_ZONE).toBe("America/Chicago");
  });

  // CDT (UTC-5) in September.
  it("22:00-07:00 mutes 23:00 CDT and lets 18:00 CDT through (the reported inversion)", () => {
    // 23:00 CDT = 04:00Z next day.
    expect(isInQuietHours("22:00:00", "07:00:00", new Date("2026-09-24T04:00:00Z"))).toBe(true);
    // 18:00 CDT = 23:00Z. UTC evaluation called this QUIET — the bug.
    expect(isInQuietHours("22:00:00", "07:00:00", new Date("2026-09-23T23:00:00Z"))).toBe(false);
    // 03:00 CDT = 08:00Z. UTC evaluation called this NOT quiet — pushes at 3am.
    expect(isInQuietHours("22:00:00", "07:00:00", new Date("2026-09-24T08:00:00Z"))).toBe(true);
    // 07:30 CDT = 12:30Z — window over.
    expect(isInQuietHours("22:00", "07:00", new Date("2026-09-24T12:30:00Z"))).toBe(false);
  });

  it("tracks CST in winter (UTC-6), not a fixed offset", () => {
    // 22:30 CST = 04:30Z.
    expect(isInQuietHours("22:00", "07:00", new Date("2026-01-15T04:30:00Z"))).toBe(true);
    // 21:30 CST = 03:30Z — before the window. A fixed -5 offset says 22:30 → quiet.
    expect(isInQuietHours("22:00", "07:00", new Date("2026-01-15T03:30:00Z"))).toBe(false);
  });

  it("handles a same-day window and the empty / malformed cases", () => {
    // 13:30 CDT = 18:30Z.
    expect(isInQuietHours("13:00", "14:00", new Date("2026-09-23T18:30:00Z"))).toBe(true);
    expect(isInQuietHours("13:00", "14:00", new Date("2026-09-23T13:30:00Z"))).toBe(false);
    expect(isInQuietHours("09:00", "09:00", new Date("2026-09-23T14:00:00Z"))).toBe(false);
    expect(isInQuietHours("junk", "07:00", new Date("2026-09-23T14:00:00Z"))).toBe(false);
    // Midnight local (05:00Z in CDT) is inside an overnight window.
    expect(isInQuietHours("22:00", "07:00", new Date("2026-09-24T05:00:00Z"))).toBe(true);
  });

  it("the push sender calls the shared evaluator with no timezone override", () => {
    const src = blankComments(
      readFileSync(join(FUNCTIONS, "send-push-notification/index.ts"), "utf8"),
    );
    expect(src).toMatch(/from '\.\/quietHours\.ts'/);
    const calls = src.match(/isInQuietHours\((?:[^()]|\([^()]*\))*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      // Exactly three args (start, end, now): the default zone is the policy.
      expect(c, c).toMatch(/^isInQuietHours\(quietPrefs\.quiet_start, quietPrefs\.quiet_end, new Date\(\)\)$/);
    }
  });
});

describe("CLASS: no edge function decides by a UTC hour-of-day", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\./.test(name)) out.push(p);
    }
    return out;
  }

  it("no getUTCHours()/getHours() in any edge function source", () => {
    const files = walk(FUNCTIONS);
    // Inventory floor: the walk really read the functions tree (not a count claim).
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const f of files) {
      const code = blankComments(readFileSync(f, "utf8"));
      if (/\.get(UTC)?Hours\s*\(/.test(code)) offenders.push(relative(ROOT, f));
    }
    expect(offenders).toEqual([]);
  });
});
