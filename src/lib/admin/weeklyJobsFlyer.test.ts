/**
 * Q2431: the Admin weekly jobs flyer prints real jobs only, the Helpr's
 * take-home (never the poster's price, never a fee), and the owner's own
 * format (TITLE / SUN 11/1 · 9 AM · NEW IBERIA / $89).
 *
 * The two take-home fixtures are the two jobs on the owner's hand-made flyer,
 * read from prod 2026-10-27 (read-only): "Mow and Weed Eat" $100 stamped
 * 10% + 70c printed $89; "GIVE AWAY!!" $60 stamped 5% + 70c printed $56.
 */
import { describe, expect, it } from "vitest";
import {
  flyerCaption,
  flyerDayDate,
  flyerJobLines,
  flyerTakeHome,
  flyerTime,
  flyerTitle,
  flyerTown,
  realJobsOnly,
  thisWeeksJobs,
  toFlyerJob,
  wavyPanelPoints,
  type FlyerSourceJob,
} from "./weeklyJobsFlyer";

// @mutate src/lib/admin/weeklyJobsFlyer.ts | seedFlags.filter((s) => s.is_seed === false) | seedFlags.filter((s) => s.is_seed !== true)
// @mutate src/lib/admin/weeklyJobsFlyer.ts | const net = computeNet(budget, tierFeePercent(null), Number(job.urgent_fee ?? 0), helpers, 0, job).netEarnings; | const net = budget;
// @mutate src/lib/admin/weeklyJobsFlyer.ts |   const price = job.takeHome === null ? "GET QUOTES" : `$${job.takeHome}`; |   const price = `$${job.takeHome}`;
// @mutate src/lib/admin/weeklyJobsFlyer.ts |   const town = parts[parts.length - 2]; |   const town = parts[0];

const mow: FlyerSourceJob = {
  id: "7b1da54b",
  title: "Mow and Weed Eat",
  budget: "100.00",
  date_needed: "2026-11-01",
  start_time: "09:00:00",
  location: "New Iberia, LA",
  pricing_mode: null,
  helper_fee_flat_cents: 70,
  helper_fee_percent: "10",
};
const giveaway: FlyerSourceJob = {
  id: "11f8b084",
  title: "GIVE AWAY!!",
  budget: "60.00",
  date_needed: "2026-10-31",
  start_time: "18:00:00",
  location: "Delcambre, LA",
  pricing_mode: null,
  helper_fee_flat_cents: 70,
  helper_fee_percent: "5",
};

describe("weekly jobs flyer (Q2431)", () => {
  it("prints the Helpr's take-home the owner printed: $89 and $56", () => {
    expect(flyerTakeHome(mow)).toBe(89);
    expect(flyerTakeHome(giveaway)).toBe(56);
  });

  it("a quotes job prints GET QUOTES, never a dollar figure", () => {
    const q = toFlyerJob({ ...mow, pricing_mode: "quotes" });
    expect(q.takeHome).toBeNull();
    expect(flyerJobLines(q)[2]).toBe("GET QUOTES");
  });

  it("formats the owner's lines", () => {
    expect(flyerJobLines(toFlyerJob(mow))).toEqual(["MOW & WEED EAT", "SUN 11/1 · 9 AM · NEW IBERIA", "$89"]);
    expect(flyerJobLines(toFlyerJob(giveaway))).toEqual(["GIVE AWAY", "SAT 10/31 · 6 PM · DELCAMBRE", "$56"]);
    expect(flyerDayDate("2026-11-01")).toBe("SUN 11/1");
    expect(flyerTime("13:30:00")).toBe("1:30 PM");
    expect(flyerTime("00:00:00")).toBe("12 AM");
    expect(flyerTime(null)).toBeNull();
    expect(flyerTitle("  Help  with moving!! ")).toBe("HELP WITH MOVING");
  });

  it("reads the town from a masked or a full address", () => {
    expect(flyerTown("New Iberia, LA")).toBe("New Iberia");
    expect(flyerTown("4804 Dolphin St, New Iberia, LA 70560")).toBe("New Iberia");
    expect(flyerTown(null)).toBeNull();
    expect(flyerTown("")).toBeNull();
  });

  it("keeps only rows the seed read says are real (is_seed === false)", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const kept = realJobsOnly(rows, [
      { id: "a", is_seed: false },
      { id: "b", is_seed: true },
      { id: "c", is_seed: null },
      // "d" missing from the read: left off.
    ]);
    expect(kept.map((r) => r.id)).toEqual(["a"]);
  });

  it("this week = today through the next 6 days (plus flexible), soonest first", () => {
    const today = new Date(2026, 9, 27);
    const jobs = [
      { id: "late", date_needed: "2026-11-03" },
      { id: "past", date_needed: "2026-10-26" },
      { id: "sun", date_needed: "2026-11-01" },
      { id: "flex", date_needed: null },
      { id: "sat", date_needed: "2026-10-31" },
      { id: "nextweek", date_needed: "2026-11-04" },
    ];
    expect(thisWeeksJobs(jobs, today).map((j) => j.id)).toEqual(["sat", "sun", "flex"]);
  });

  it("the caption names take-home figures and no fee or percent", () => {
    const c = flyerCaption([toFlyerJob(mow), toFlyerJob(giveaway)]);
    expect(c).toContain("Mow & Weed Eat in New Iberia, Sun 11/1, 9 AM: $89");
    expect(c).toContain("louisianahelpr.com");
    expect(c).not.toMatch(/\bfees?\b|%|commission/i);
  });

  it("the wavy panel closes on itself and waves both ways round the base box", () => {
    const box = { x: 160, y: 150, w: 760, h: 1080, r: 150 };
    const pts = wavyPanelPoints(box, 30, 12);
    expect(pts.length).toBeGreaterThan(100);
    const xs = pts.map((p) => p[0]);
    expect(Math.min(...xs)).toBeLessThan(box.x - 20);
    expect(Math.min(...xs)).toBeGreaterThan(box.x - 31);
    const leftEdge = pts.filter(([, y]) => y > 400 && y < 1000).map(([x]) => x).filter((x) => x < 300);
    expect(Math.max(...leftEdge)).toBeGreaterThan(box.x + 20);
  });
});
