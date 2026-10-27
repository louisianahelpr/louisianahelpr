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
// @mutate supabase/functions/_shared/sameDayMatch.ts |   return Number.isFinite(t) && t > now.getTime(); |   return Number.isFinite(t);
// @mutate supabase/functions/_shared/sameDayMatch.ts |   return milesBetween(jLat, jLng, hLat, hLng) <= SAME_DAY_RADIUS_MILES; |   return true;
// @mutate supabase/functions/_shared/sameDayMatch.ts |   if (!isSameDayJob(job.date_needed, now)) return 0; |
// @mutate src/components/postjob/LogisticsSection.tsx |     setDateNeeded(today);\n    setStartTime(sameDayStart); |     setDateNeeded(today);
// @mutate src/components/dashboard/JobCard.tsx |           if (isTodayJob(job.date_needed)) return <TodayCornerChip />; // Q2438 |           if (false) return <TodayCornerChip />; // Q2438

const ROOT = resolve(__dirname, "..", "..");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

/** A Louisiana wall-clock instant on 2026-10-27 (CDT, UTC-5). */
const ct = (hhmm: string) => new Date(`2026-10-27T${hhmm}:00-05:00`);

describe("Need it today (Q2438)", () => {
  it("fills the soonest start the server takes: now + 2 h + 10 min, up to the next half hour", () => {
    expect(sameDayStartTime(ct("09:00"))).toBe("11:30");
    expect(sameDayStartTime(ct("15:05"))).toBe("17:30");
    expect(sameDayStartTime(ct("15:20"))).toBe("17:30");
    expect(sameDayStartTime(ct("15:21"))).toBe("18:00");
    expect(sameDayStartTime(ct("00:00"))).toBe("02:30");
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
    expect(isTodayJob("2026-10-27", "2026-10-27")).toBe(true);
    expect(isTodayJob("2026-10-28", "2026-10-27")).toBe(false);
    expect(isTodayJob(null, "2026-10-27")).toBe(false);
  });
});

describe("same-day matching (Q2438)", () => {
  const now = ct("14:00");
  const job = { date_needed: "2026-10-27", parish: "Lafayette", latitude: 30.22, longitude: -92.02 };

  it("same day is Louisiana's calendar day, not UTC's", () => {
    // 8:30 PM CDT on the 27th is already the 28th in UTC.
    expect(isSameDayJob("2026-10-27", ct("20:30"))).toBe(true);
    expect(isSameDayJob("2026-10-28", ct("20:30"))).toBe(false);
  });

  it("online means Available now is still running", () => {
    expect(isOnlineNow("2026-10-27T15:00:00-05:00", now)).toBe(true);
    expect(isOnlineNow("2026-10-27T13:59:00-05:00", now)).toBe(false);
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
    const online = "2026-10-27T18:00:00-05:00";
    expect(sameDayBoost(job, { parish: "Lafayette", available_until: online }, now)).toBe(SAME_DAY_ONLINE_SCORE);
    expect(sameDayBoost(job, { parish: "Lafayette", available_until: null }, now)).toBe(0);
    expect(sameDayBoost(job, { parish: "Orleans", available_until: online }, now)).toBe(0);
    expect(sameDayBoost({ ...job, date_needed: "2026-10-28" }, { parish: "Lafayette", available_until: online }, now)).toBe(0);
    // Above any skill/location score instant-job-match gives (3 + 2 + 1).
    expect(SAME_DAY_ONLINE_SCORE).toBeGreaterThan(6);
  });
});

describe("the wiring (Q2438)", () => {
  it("Post a job offers Need it today, filling today and the start", () => {
    const src = code("src/components/postjob/LogisticsSection.tsx");
    expect(src).toContain("sameDayStartTime()");
    expect(src).toMatch(/setDateNeeded\(today\);\s*setStartTime\(sameDayStart\);/);
    expect(src).toContain("Need it today");
  });

  it("the browse card shows Today for a job dated today", () => {
    const src = code("src/components/dashboard/JobCard.tsx");
    expect(src).toContain("if (isTodayJob(job.date_needed)) return <TodayCornerChip />;");
  });

  it("instant-job-match reads the online state and boosts by it", () => {
    const src = code("supabase/functions/instant-job-match/index.ts");
    expect(src).toContain("available_until");
    expect(src).toContain("score += sameDayBoost(job, h, matchedAt);");
  });
});
