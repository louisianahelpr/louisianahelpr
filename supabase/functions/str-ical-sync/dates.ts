// Calendar-date arithmetic for the iCal sync.
//
// Split out of index.ts so it can be unit-tested: index.ts calls `Deno.serve`
// at module load, so vitest cannot import it, and the bug this module exists to
// fix was a one-character comparison that no code read caught.

/** Parse `YYYYMMDD` or `YYYYMMDDTHHmmssZ` into UTC midnight of that calendar day. */
export function parseIcalDate(icalDate: string): Date {
  const clean = icalDate.replace(/[TZ]/g, '');
  const year  = parseInt(clean.slice(0, 4), 10);
  const month = parseInt(clean.slice(4, 6), 10) - 1;
  const day   = parseInt(clean.slice(6, 8), 10);
  // Use UTC to avoid local-tz drift shifting the calendar day
  return new Date(Date.UTC(year, month, day));
}

/** UTC midnight of the calendar day an instant falls on. */
export function utcDay(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
}

/**
 * The look-ahead window for turnovers worth acting on, as two UTC midnights.
 *
 * THE BUG THIS REPLACES: `parseIcalDate` returns UTC MIDNIGHT of the checkout
 * date, and the caller compared it against `new Date()` — an instant. So on the
 * checkout day itself, midnight is always already in the past and
 * `checkoutDate < now` dropped it. The cron fires at minute 44 of every sixth
 * hour (20260831193040) — 00:44, 06:44, 12:44, 18:44 UTC — so EVERY run is
 * past midnight: today's turnover, the most urgent cleaning job there is, was
 * the one job this sync could never create, on every run, since it shipped.
 *
 * Both ends are UTC midnights so the window is a whole number of days rather
 * than a boundary that slides with whichever minute the cron happens to fire.
 */
export function lookAheadWindow(now: Date, days = 7): { from: Date; to: Date } {
  const from = utcDay(now);
  return { from, to: new Date(from.getTime() + days * 24 * 60 * 60 * 1000) };
}

/** Is a parsed checkout date inside the look-ahead window, TODAY included? */
export function isInLookAhead(checkoutDate: Date, now: Date, days = 7): boolean {
  const { from, to } = lookAheadWindow(now, days);
  return checkoutDate >= from && checkoutDate <= to;
}
