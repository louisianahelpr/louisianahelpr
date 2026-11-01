/**
 * CMP-4 instant book: the limits the server holds, the plain words for every
 * refusal its RPCs raise, and the 2-hour decline clock.
 *
 * Server: 20261101063725_instant_book_floors.sql (floors, top 3),
 * 20261101065105_instant_book_booking.sql (Book now, decline),
 * 20261101071621_instant_book_decline_race.sql (decline_window_closed),
 * 20261101074901_instant_book_captured_refund.sql (charged, not hired: refunded in full).
 * The refusals' words live in RPC_ERROR_COPY (src/lib/lifecycleErrors.ts).
 * Guard: src/test/instantBookScreens.test.tsx.
 */

/** rpc_set_instant_book_floor: 1000..100000 cents. */
export const INSTANT_BOOK_FLOOR_MIN_DOLLARS = 10;
export const INSTANT_BOOK_FLOOR_MAX_DOLLARS = 1000;
/** rpc_set_instant_book_floor: too_many_categories past 3. */
export const INSTANT_BOOK_MAX_CATEGORIES = 3;
/** rpc_instant_book: instant_decline_until = now() + 2 h. */
export const INSTANT_BOOK_DECLINE_HOURS = 2;

/** create-payment capture_hold's answer when a booked Helpr's Confirm was charged and the hire then refused. */
export const BOOKING_ENDED_COPY = "Your booking didn't go through, so you aren't booked. Nothing is owed and no strike.";

/** For a refusal RPC_ERROR_COPY has no words for (each call site reads rpcErrorMessage first). */
export const INSTANT_BOOK_GENERIC_ERROR = "Something went wrong. Nothing changed. Try again.";

/** "1 h 42 min left" / "12 min left" / "Less than a minute left"; null once the window is over. */
export function declineTimeLeft(declineUntil: string | null | undefined, now: number = Date.now()): string | null {
  if (!declineUntil) return null;
  const ms = Date.parse(declineUntil) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "Less than a minute left";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${m} min left` : `${m} min left`;
}

/** "3:50 PM", the time the decline window ends, in the viewer's clock. */
export function declineUntilClock(declineUntil: string): string {
  return new Date(declineUntil).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
