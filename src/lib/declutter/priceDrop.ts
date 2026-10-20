/**
 * When a Declutter listing's price can next drop, and how low it can go, from
 * the REAL rule (board 4, HELPR-DESIGN-SPEC v2 §1.5 truth rule):
 *
 * - pg_cron `declutter-price-drops` runs `declutter_price_drop_sweep()` at
 *   '7 23 * * *' (23:07 UTC; migration 20261014210518, measured live on prod
 *   2026-10-20: schedule '7 23 * * *', active, last success 2026-10-19 23:07Z).
 * - The sweep only touches items that are live, sale_mode 'offers', live for
 *   at least 12 hours (live_at <= now() - 12h), not already dropped on that
 *   Louisiana (America/Chicago) day, and still above the seller's stop.
 * - The new price is greatest(floor, stop, floor(current * 0.95)).
 *
 * The floor and the stop are private (declutter_item_private; the stop is
 * hidden even from the seller, B42), so nobody but the server knows whether a
 * listing has reached its stop. What IS certain: if the price drops at that
 * run, it drops to no less than floor(current * 0.95). So the page says
 * "could drop as low as $X", never "drops to $X".
 */

/** The cron's minute and hour, in UTC (cron.job 'declutter-price-drops'). */
export const PRICE_DROP_RUN_UTC = { hour: 23, minute: 7 } as const;
const MIN_LIVE_MS = 12 * 60 * 60 * 1000;

export interface PriceDropFields {
  status: string;
  sale_mode?: string | null;
  current_price_cents: number;
  live_at: string | null;
  last_price_drop_on?: string | null;
}

/** The Louisiana calendar day (YYYY-MM-DD) an instant falls on. */
function chicagoDay(at: Date): string {
  return at.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

/** The first 23:07 UTC run strictly after `now`. */
function nextRunAfter(now: Date): Date {
  const run = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), PRICE_DROP_RUN_UTC.hour, PRICE_DROP_RUN_UTC.minute));
  if (run.getTime() <= now.getTime()) run.setUTCDate(run.getUTCDate() + 1);
  return run;
}

/**
 * The next run that could lower this item, and the lowest price it could reach
 * there; null when the rule never touches it (not live, fixed price, or no
 * cent left to drop).
 */
export function nextPriceDrop(item: PriceDropFields, now: Date = new Date()): { at: Date; lowestCents: number } | null {
  // (a cron run that failed or an item that was reserved at the last run also
  // hides the line below: hiding is the safe side of the truth rule)
  if (item.status !== "live" || item.sale_mode !== "offers" || !item.live_at) return null;
  const lowestCents = Math.floor(item.current_price_cents * 0.95);
  if (!(lowestCents < item.current_price_cents)) return null;
  const liveAt = new Date(item.live_at).getTime();
  if (Number.isNaN(liveAt)) return null;
  // Already at the seller's stop? The sweep skips such an item without
  // stamping last_price_drop_on, so: eligible at the LAST run (live 12 h by
  // then) yet not dropped that Louisiana day means the sweep passed it over.
  // Hide the line then (money review, design-b-1020 #1): it would promise a
  // drop that never comes. This shows nothing the column does not already.
  const lastRun = new Date(nextRunAfter(now).getTime() - 24 * 60 * 60 * 1000);
  const eligibleAtLastRun = liveAt <= lastRun.getTime() - MIN_LIVE_MS;
  if (eligibleAtLastRun && (!item.last_price_drop_on || item.last_price_drop_on < chicagoDay(lastRun))) return null;
  let run = nextRunAfter(now);
  // Two runs are enough: the 12-hour rule and the once-a-day rule each push it at most one day.
  for (let i = 0; i < 3; i++) {
    const oldEnough = liveAt <= run.getTime() - MIN_LIVE_MS;
    const notToday = !item.last_price_drop_on || item.last_price_drop_on < chicagoDay(run);
    if (oldEnough && notToday) return { at: run, lowestCents };
    run = new Date(run.getTime() + 24 * 60 * 60 * 1000);
  }
  return null;
}

/** "this evening at 6:07 PM" / "tomorrow at 6:07 PM" / "Thursday at 5:07 PM", in Louisiana time. */
export function dropWhenLabel(at: Date, now: Date = new Date()): string {
  const time = at.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
  const today = chicagoDay(now);
  const day = chicagoDay(at);
  if (day === today) return `this evening at ${time}`;
  const tomorrow = chicagoDay(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  if (day === tomorrow) return `tomorrow at ${time}`;
  return `${at.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long" })} at ${time}`;
}
