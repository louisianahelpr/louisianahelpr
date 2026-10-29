/**
 * Q2438 (owner-approved 2026-10-27): same-day ("Need it today") jobs.
 *
 * - "Need it today" fills Louisiana's today and the soonest start the server
 *   accepts (refuse_short_notice_job: 2 hours' notice), or says it is too late.
 * - instant-job-match puts online ("Available now") Helprs who are nearby
 *   (same parish, or within 25 miles) first on a same-day job
 *   (supabase/functions/_shared/sameDayMatch.ts; the edge half is proven in
 *   src/test/edge/instant-job-match.test.ts).
 * - A card for a job dated today wears "Today".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { isTodayJob, sameDayStartTime } from "@/lib/sameDayJob";
import {
  SAME_DAY_ONLINE_SCORE,
  isNearby,
  isOnlineNow,
  isSameDayJob,
  milesBetween,
  sameDayBoost,
} from "../../supabase/functions/_shared/sameDayMatch";

// @mutate src/lib/sameDayJob.ts |   const earliest = louisianaMinutes(now) + SAME_DAY_MIN_NOTICE_MIN + CHECKOUT_MARGIN_MIN; |   const earliest = louisianaMinutes(now) + CHECKOUT_MARGIN_MIN;
// @mutate src/lib/sameDayJob.ts |   if (rounded > lh * 60 + lm) return null; |
// @mutate src/lib/sameDayJob.ts |   const rounded = Math.max(Math.ceil(earliest / 30) * 30, eh * 60 + em); |   const rounded = Math.ceil(earliest / 30) * 30;
// @mutate supabase/functions/_shared/sameDayMatch.ts |   return Number.isFinite(t) && t > now.getTime(); |   return Number.isFinite(t);
// @mutate supabase/functions/_shared/sameDayMatch.ts |   return milesBetween(jLat, jLng, hLat, hLng) <= SAME_DAY_RADIUS_MILES; |   return true;
// @mutate supabase/functions/_shared/sameDayMatch.ts |   if (!isSameDayJob(job.date_needed, now)) return 0; |
// @mutate src/components/postjob/LogisticsSection.tsx |     setDateNeeded(today);\n    markTodayStart(sameDayStart); |     setDateNeeded(today);
// @mutate src/components/dashboard/JobCard.tsx |           if (isTodayJob(job.date_needed)) { |           if (false) {

const ROOT = resolve(__dirname, "..", "..");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

/** A Louisiana wall-clock instant on 2024-03-14 (CDT, UTC-5). */
const ct = (hhmm: string) => new Date(`2024-03-14T${hhmm}:00-05:00`);

describe("Need it today (Q2438)", () => {
  it("fills the soonest start the server takes: now + 2 h + 10 min, up to the next half hour", () => {
    expect(sameDayStartTime(ct("09:00"))).toBe("11:30");
    expect(sameDayStartTime(ct("15:05"))).toBe("17:30");
    expect(sameDayStartTime(ct("15:20"))).toBe("17:30");
    expect(sameDayStartTime(ct("15:21"))).toBe("18:00");
  });

  it("never fills a start before 8:00 AM (A2-C27: at 00:33 it filled 3:00 AM)", () => {
    expect(sameDayStartTime(ct("00:33"))).toBe("08:00");
    expect(sameDayStartTime(ct("00:00"))).toBe("08:00");
    expect(sameDayStartTime(ct("05:50"))).toBe("08:00");
    expect(sameDayStartTime(ct("05:51"))).toBe("08:30");
  });

  it("is too late after the last start of the day (9:00 PM)", () => {
    expect(sameDayStartTime(ct("18:50"))).toBe("21:00");
    expect(sameDayStartTime(ct("18:51"))).toBeNull();
    expect(sameDayStartTime(ct("23:30"))).toBeNull();
  });

  it("the start it fills is always at least 2 hours away (the server's own rule)", () => {
    let checked = 0;
    for (let m = 0; m < 24 * 60; m += 7) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      const start = sameDayStartTime(ct(`${hh}:${mm}`));
      if (!start) continue;
      const [sh, sm] = start.split(":").map(Number);
      expect(sh * 60 + sm - m, `${hh}:${mm} -> ${start}`).toBeGreaterThanOrEqual(120);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("a card is a Today card only for Louisiana's today", () => {
    expect(isTodayJob("2024-03-14", "2024-03-14")).toBe(true);
    expect(isTodayJob("2024-03-15", "2024-03-14")).toBe(false);
    expect(isTodayJob(null, "2024-03-14")).toBe(false);
  });
});

describe("same-day matching (Q2438)", () => {
  const now = ct("14:00");
  const job = { date_needed: "2024-03-14", parish: "Lafayette", latitude: 30.22, longitude: -92.02 };

  it("same day is Louisiana's calendar day, not UTC's", () => {
    // 8:30 PM CDT on the 27th is already the 28th in UTC.
    expect(isSameDayJob("2024-03-14", ct("20:30"))).toBe(true);
    expect(isSameDayJob("2024-03-15", ct("20:30"))).toBe(false);
  });

  it("online means Available now is still running", () => {
    expect(isOnlineNow("2024-03-14T15:00:00-05:00", now)).toBe(true);
    expect(isOnlineNow("2024-03-14T13:59:00-05:00", now)).toBe(false);
    expect(isOnlineNow(null, now)).toBe(false);
  });

  it("nearby is the same parish, or within 25 miles when both have coordinates", () => {
    expect(isNearby(job, { parish: "lafayette" })).toBe(true);
    // Broussard is ~8 miles from Lafayette; New Orleans ~120.
    expect(isNearby(job, { parish: "St. Martin", latitude: 30.15, longitude: -91.96 })).toBe(true);
    expect(isNearby(job, { parish: "Orleans", latitude: 29.95, longitude: -90.07 })).toBe(false);
    expect(isNearby(job, { parish: null })).toBe(false);
    expect(milesBetween(30.22, -92.02, 29.95, -90.07)).toBeGreaterThan(100);
  });

  it("the boost is for online AND nearby Helprs on a same-day job only", () => {
    const online = "2024-03-14T18:00:00-05:00";
    expect(sameDayBoost(job, { parish: "Lafayette", available_until: online }, now)).toBe(SAME_DAY_ONLINE_SCORE);
    expect(sameDayBoost(job, { parish: "Lafayette", available_until: null }, now)).toBe(0);
    expect(sameDayBoost(job, { parish: "Orleans", available_until: online }, now)).toBe(0);
    expect(sameDayBoost({ ...job, date_needed: "2024-03-15" }, { parish: "Lafayette", available_until: online }, now)).toBe(0);
    // Above any skill/location score instant-job-match gives (3 + 2 + 1).
    expect(SAME_DAY_ONLINE_SCORE).toBeGreaterThan(6);
  });
});

describe("the wiring (Q2438)", () => {
  it("Post a job offers Need it today, filling today and the start", () => {
    const src = code("src/components/postjob/LogisticsSection.tsx");
    // A2-C27: the start comes through useSameDayPick (sameDayStartTime(), remembered as Need it today's own).
    expect(src).toContain("useSameDayPick({ today, startTime, setDateNeeded, setStartTime })");
    expect(code("src/components/postjob/useSameDayPick.ts")).toContain("sameDayStart: sameDayStartTime(),");
    expect(src).toMatch(/setDateNeeded\(today\);\s*markTodayStart\(sameDayStart\);/);
    expect(src).toContain("Need it today");
  });

  it("the browse card shows Today for a job dated today", () => {
    const src = code("src/components/dashboard/JobCard.tsx");
    expect(src).toMatch(/if \(isTodayJob\(job\.date_needed\)\) \{/);
  });

  it("instant-job-match reads the online state and boosts by it", () => {
    const src = code("supabase/functions/instant-job-match/index.ts");
    expect(src).toContain("available_until");
    expect(src).toContain("score += sameDayBoost(job, h, matchedAt);");
  });
});
