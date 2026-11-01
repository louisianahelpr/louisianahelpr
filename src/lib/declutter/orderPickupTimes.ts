/**
 * A3-18 / A3-19 (lead 11-01 5:01 PM; A3-50: the 7-day rule): when a paid Declutter pickup happens, or by when it must
 * be booked. Read from the order row (declutter_orders.pickup_slot_start / pickup_slot_end, B110; book_by,
 * 20261101230519), never computed on the client.
 *   - A time chosen at checkout and booked: the card names it ("Pickup Sat 11/2, 3–5 PM · porch"), with no "by".
 *   - Nothing booked: the card says "· by <book_by>" (paid + 7 days). Nothing is cancelled at it (owner Q2477).
 * Times are said in Louisiana time, as the notices are (America/Chicago).
 * Guard: src/lib/declutter/orderPickupTimes.test.ts.
 */
import { supabase } from "@/integrations/supabase/client";

export type OrderPickupTimes = {
  id: string;
  book_by: string | null;
  pickup_slot_start: string | null;
  pickup_slot_end: string | null;
};

/** The database answers these while the columns are not deployed yet (the web can ship first): no times, not an error. */
const COLUMN_NOT_YET = new Set(["42703", "PGRST204"]);

export async function fetchOrderPickupTimes(orderIds: string[]): Promise<OrderPickupTimes[]> {
  if (orderIds.length === 0) return [];
  const res = await supabase.from("declutter_orders").select("id, book_by, pickup_slot_start, pickup_slot_end").in("id", orderIds);
  if (res.error) {
    if (COLUMN_NOT_YET.has(res.error.code ?? "")) return [];
    throw res.error;
  }
  // The generated types predate book_by (20261101230519); the row shape is the select above.
  return (res.data ?? []) as unknown as OrderPickupTimes[];
}

export const orderPickupTimesKey = (orderIds: string[]) => ["declutter", "order-pickup-times", orderIds.join(",")] as const;

const TZ = "America/Chicago";
// Some engines put a narrow no-break space before AM/PM; the words use a plain space, as the notices do.
const part = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...o }).format(d).replace(/[\u202f\u00a0]/g, " ");
const day = (d: Date) => `${part(d, { weekday: "short" })} ${part(d, { month: "numeric", day: "numeric" })}`;
const ampm = (d: Date) => (part(d, { hour: "numeric", hour12: true }).endsWith("PM") ? "PM" : "AM");
/** "3" or "3:30", no AM/PM. */
const clock = (d: Date) => {
  const [h, m] = part(d, { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?[AP]M$/, "").split(":");
  return m === "00" ? h : `${h}:${m}`;
};

/** "Sat 11/2, 3–5 PM" for a porch window; "Sat 11/2, 3:30 PM" for an exact time (as declutter_pickup_when says them). */
export function pickupWhenWords(startIso: string, endIso: string | null, porch: boolean): string {
  const a = new Date(startIso);
  if (!porch || !endIso) return `${day(a)}, ${part(a, { hour: "numeric", minute: "2-digit", hour12: true })}`;
  const b = new Date(endIso);
  return ampm(a) === ampm(b)
    ? `${day(a)}, ${clock(a)}–${clock(b)} ${ampm(b)}`
    : `${day(a)}, ${clock(a)} ${ampm(a)}–${clock(b)} ${ampm(b)}`;
}

/** "by Sun 11/8, 5:07 PM". */
export function bookByWords(iso: string): string {
  const d = new Date(iso);
  return `by ${day(d)}, ${part(d, { hour: "numeric", minute: "2-digit", hour12: true })}`;
}

/**
 * What the card says about the time, from the order row and whether a time is booked:
 *   - chosen: the checkout time is the booked one (words, no "by");
 *   - by: nothing booked yet and a book_by is set ("by <date>");
 *   - neither: null (an old booking says its own time, as before).
 */
export function orderTimeWords(t: OrderPickupTimes | null | undefined, handover: string | null, bookedSlotStart: string | null):
  { chosen: string | null; by: string | null } {
  if (!t) return { chosen: null, by: null };
  const booked = !!bookedSlotStart;
  const chosen = booked && t.pickup_slot_start && Date.parse(t.pickup_slot_start) === Date.parse(bookedSlotStart!)
    ? pickupWhenWords(t.pickup_slot_start, t.pickup_slot_end, handover === "porch")
    : null;
  return { chosen, by: !booked && t.book_by ? bookByWords(t.book_by) : null };
}
