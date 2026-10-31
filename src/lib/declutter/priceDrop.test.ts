/**
 * Board 4's price-drop line comes from the REAL nightly rule, never a promise
 * the server may not keep. The rule is pg_cron 'declutter-price-drops'
 * ('7 23 * * *', measured live 2026-10-20) running declutter_price_drop_sweep():
 * live + sale_mode 'offers' + live >= 12 h + not dropped that Louisiana day,
 * new price >= the step: current less the seller's drop_pct (0 = off; 5 when
 * absent), down to a whole dollar (20261028160637, owner 2026-10-28). These pin
 * nextPriceDrop to that rule and to the cron schedule in the migration.
 *
 * @mutate src/lib/declutter/priceDrop.ts | export const PRICE_DROP_RUN_UTC = { hour: 23, minute: 7 } as const; | export const PRICE_DROP_RUN_UTC = { hour: 19, minute: 0 } as const;
 * @mutate src/lib/declutter/priceDrop.ts |   if (item.status !== "live" \|\| item.sale_mode !== "offers" \|\| !item.live_at) return null; |   if (item.status !== "live" \|\| !item.live_at) return null;
 * @mutate src/lib/declutter/priceDrop.ts |   return Math.floor((currentCents * (100 - pct)) / 10000) * 100; |   return Math.floor((currentCents * (100 - pct)) / 100);
 * @mutate src/lib/declutter/priceDrop.ts |   if (pct <= 0) return null; |   if (false) return null;
 * @mutate src/lib/declutter/priceDrop.ts |   return typeof item.drop_pct === "number" ? item.drop_pct : DEFAULT_DROP_PCT; |   return DEFAULT_DROP_PCT;
 * @mutate src/lib/declutter/priceDrop.ts |     const oldEnough = liveAt <= run.getTime() - MIN_LIVE_MS; |     const oldEnough = true;
 * @mutate src/lib/declutter/priceDrop.ts |     const notToday = !item.last_price_drop_on \|\| item.last_price_drop_on < chicagoDay(run); |     const notToday = true;
 * @mutate src/lib/declutter/priceDrop.ts |   if (eligibleAtLastRun && (!item.last_price_drop_on \|\| item.last_price_drop_on < chicagoDay(lastRun))) return null; |   void eligibleAtLastRun;
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "@/test/helpers/blankNonCode";
import { DROP_PCT_CHOICES, PRICE_DROP_RUN_UTC, dropStepCents, dropWhenLabel, nextPriceDrop } from "./priceDrop";

const LIVE = { status: "live", sale_mode: "offers", current_price_cents: 3800, live_at: "2026-10-10T12:00:00Z", last_price_drop_on: "2026-10-19" };
// 2026-10-20 04:00Z = 2026-10-19 11 PM in Louisiana (CDT).
const NOW = new Date("2026-10-20T15:00:00Z"); // 10 AM CDT on the 20th

describe("nextPriceDrop follows declutter_price_drop_sweep", () => {
  it("the next 23:07 UTC run, at no less than the step, in whole dollars ($38 at 5% is $36, never $36.10)", () => {
    const d = nextPriceDrop(LIVE, NOW);
    expect(d?.at.toISOString()).toBe("2026-10-20T23:07:00.000Z");
    expect(d?.lowestCents).toBe(3600);
    expect(d?.pct).toBe(5);
    expect(dropWhenLabel(d!.at, NOW)).toBe("this evening at 6:07 PM");
  });

  it("the seller's own step (owner 2026-10-28), and none at all when they turned drops off", () => {
    expect(nextPriceDrop({ ...LIVE, drop_pct: 10 }, NOW)?.lowestCents).toBe(3400);
    expect(nextPriceDrop({ ...LIVE, drop_pct: 20 }, NOW)?.lowestCents).toBe(3000);
    expect(nextPriceDrop({ ...LIVE, drop_pct: 20 }, NOW)?.pct).toBe(20);
    expect(nextPriceDrop({ ...LIVE, drop_pct: 0 }, NOW)).toBeNull();
    // Not left to the rounding: off at $18.50 never says "as low as $18" (money review 2026-10-28 #4).
    expect(nextPriceDrop({ ...LIVE, current_price_cents: 1850, drop_pct: 0 }, NOW)).toBeNull();
    // A row read before the column reached prod keeps the old 5% step.
    expect(nextPriceDrop({ ...LIVE, drop_pct: null }, NOW)?.pct).toBe(5);
    expect(DROP_PCT_CHOICES).toEqual([5, 10, 15, 20]);
    expect(dropStepCents(1900, 5)).toBe(1800);
    expect(dropStepCents(10000, 15)).toBe(8500);
  });

  it("already dropped this Louisiana day: tomorrow's run", () => {
    const d = nextPriceDrop({ ...LIVE, last_price_drop_on: "2026-10-20" }, NOW);
    expect(d?.at.toISOString()).toBe("2026-10-21T23:07:00.000Z");
    expect(dropWhenLabel(d!.at, NOW)).toBe("tomorrow at 6:07 PM");
  });

  it("live under 12 hours at the run: the run after", () => {
    const d = nextPriceDrop({ ...LIVE, live_at: "2026-10-20T14:00:00Z", last_price_drop_on: null }, NOW);
    expect(d?.at.toISOString()).toBe("2026-10-21T23:07:00.000Z");
  });

  it("after today's run: tomorrow", () => {
    const late = new Date("2026-10-20T23:30:00Z");
    expect(nextPriceDrop({ ...LIVE, last_price_drop_on: "2026-10-20" }, late)?.at.toISOString()).toBe("2026-10-21T23:07:00.000Z");
  });

  it("winter (CST): the same UTC run reads 5:07 PM", () => {
    const now = new Date("2026-12-10T15:00:00Z");
    const d = nextPriceDrop({ ...LIVE, last_price_drop_on: "2026-12-09" }, now);
    expect(dropWhenLabel(d!.at, now)).toBe("this evening at 5:07 PM");
  });

  it("at the seller's stop (eligible at the last run, not dropped that day): no line, never a promise that won't come", () => {
    // Live since the 10th, last dropped on the 18th: the 19th's 23:07Z run skipped it.
    expect(nextPriceDrop({ ...LIVE, last_price_drop_on: "2026-10-18" }, NOW)).toBeNull();
    expect(nextPriceDrop({ ...LIVE, last_price_drop_on: null }, NOW)).toBeNull();
  });

  it("never for a fixed-price, reserved or not-yet-live item, or one with no cent left to drop", () => {
    expect(nextPriceDrop({ ...LIVE, sale_mode: "fixed" }, NOW)).toBeNull();
    // POST-DROPFLAG: a seller's stop hides the line at once, not after the next sweep passes it over.
    expect(nextPriceDrop({ ...LIVE, drops_stopped: true }, NOW)).toBeNull();
    expect(nextPriceDrop({ ...LIVE, drops_stopped: false }, NOW)).not.toBeNull();
    expect(nextPriceDrop({ ...LIVE, drops_stopped: null }, NOW)).not.toBeNull();
    expect(nextPriceDrop({ ...LIVE, sale_mode: null }, NOW)).toBeNull();
    expect(nextPriceDrop({ ...LIVE, status: "reserved" }, NOW)).toBeNull();
    expect(nextPriceDrop({ ...LIVE, live_at: null }, NOW)).toBeNull();
    expect(nextPriceDrop({ ...LIVE, current_price_cents: 0 }, NOW)).toBeNull();
  });

  it("the schedule and the 5% / 12-hour / offers-only rule match the newest migrations", () => {
    const dir = resolve(__dirname, "..", "..", "..", "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    expect(files.length).toBeGreaterThan(100);
    let schedule: string | null = null;
    let sweep: string | null = null;
    for (const f of files) {
      const sql = blankSqlComments(readFileSync(join(dir, f), "utf8"));
      const s = sql.match(/cron\.schedule\(\s*'declutter-price-drops'\s*,\s*'([^']+)'/);
      if (s) schedule = s[1];
      const body = sql.match(/FUNCTION\s+public\.declutter_price_drop_sweep\(\)[\s\S]*?AS\s+(\$[A-Za-z_]*\$)([\s\S]*?)\1/i);
      if (body) sweep = body[2];
    }
    expect(schedule).toBe(`${PRICE_DROP_RUN_UTC.minute} ${PRICE_DROP_RUN_UTC.hour} * * *`);
    // The same step as dropStepCents, and the off switch (20261028160637).
    expect(sweep).toContain("(floor(i.current_price_cents * (100 - i.drop_pct) / 10000.0) * 100)::integer");
    expect(sweep).toContain("AND i.drop_pct > 0");
    expect(sweep).toMatch(/i\.sale_mode = 'offers'/);
    expect(sweep).toMatch(/i\.live_at <= now\(\) - interval '12 hours'/);
    expect(sweep).toMatch(/America\/Chicago/);
  });
});
