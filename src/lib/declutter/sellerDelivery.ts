/**
 * Declutter seller delivery: the seller delivers for a flat rate and the buyer
 * picks a date and time (migration 20261021181258; switch
 * declutter_seller_delivery; spec docs/specs/declutter-seller-delivery.md).
 *
 * The SERVER decides everything: the rules live in ONE SQL function,
 * declutter_seller_delivery_rules(), which the settings and offer answers
 * carry. SELLER_DELIVERY_RULES below mirrors it only so a screen can draw
 * before the answer arrives; src/test/declutterSellerDelivery.test.ts pins
 * the two to each other, value by value.
 */
import { supabase } from "@/integrations/supabase/client";
import { isNativePlatform } from "@/lib/nativeInit";
import { rpcErrorMessage } from "./sellerDeliveryErrors";

/** The [DEFAULT]s the owner confirms (see the SQL function of the same name). */
export const SELLER_DELIVERY_RULES = {
  rate_min_cents: 500,
  rate_max_cents: 15000,
  radius_choices_miles: [5, 10, 25, 50],
  radius_default_miles: 10,
  slot_minutes: 60,
  lead_hours: 24,
  horizon_days: 14,
  per_slot: 1,
  hold_minutes: 35,
  not_delivered_after_minutes: 15,
  auto_confirm_hours: 24,
  proposals_per_side: 3,
  reminder_hours: [24, 1],
  timezone: "America/Chicago",
} as const;

export type SellerDeliveryRules = {
  rate_min_cents: number;
  rate_max_cents: number;
  radius_choices_miles: readonly number[];
  radius_default_miles: number;
  slot_minutes: number;
  lead_hours: number;
  horizon_days: number;
  per_slot: number;
  hold_minutes: number;
  not_delivered_after_minutes: number;
  auto_confirm_hours: number;
  proposals_per_side: number;
  reminder_hours: readonly number[];
  timezone: string;
};

export type DeliveryWindow = { weekday: number; starts: string; ends: string };

export type MySellerDelivery = {
  enabled: boolean;
  rate_cents: number | null;
  radius_miles: number;
  windows: DeliveryWindow[];
  days_off: string[];
  items_off: string[];
  rules: SellerDeliveryRules;
};

export type SellerDeliveryUnavailable =
  | "seller_not_delivering"
  | "item_not_deliverable"
  | "address_needed"
  | "out_of_range"
  | "no_times";

export type SellerDeliveryOffer = {
  available: boolean;
  reason: SellerDeliveryUnavailable | null;
  rate_cents: number | null;
  radius_miles: number | null;
  dropoff_area: string | null;
  slot_minutes: number;
  slots: string[];
  held_slot: string | null;
};

export type SellerDeliveryBooking = {
  order_id: string;
  side: "buyer" | "seller";
  order_status: string;
  status: "held" | "booked" | "needs_time" | "released" | "cancelled" | "done";
  slot_start: string | null;
  slot_end: string | null;
  delivery_cents: number;
  dropoff_area: string;
  dropoff_address: string | null;
  proposed_start: string | null;
  proposed_by: "buyer" | "seller" | null;
  proposals_left: number;
  delivered_at: string | null;
  delivered_photo_path: string | null;
  confirmed_at: string | null;
  not_delivered_from: string | null;
};

/** A whole-dollar rate inside the caps (the server checks the same). */
export function rateIsValid(cents: number, rules: SellerDeliveryRules = SELLER_DELIVERY_RULES): boolean {
  return Number.isInteger(cents) && cents % 100 === 0 && cents >= rules.rate_min_cents && cents <= rules.rate_max_cents;
}

const DAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: SELLER_DELIVERY_RULES.timezone, weekday: "short", month: "short", day: "numeric" });
const TIME_FMT = new Intl.DateTimeFormat("en-US", { timeZone: SELLER_DELIVERY_RULES.timezone, hour: "numeric", minute: "2-digit" });
const KEY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: SELLER_DELIVERY_RULES.timezone, year: "numeric", month: "2-digit", day: "2-digit" });

/** "Sat, Oct 25" in Louisiana time. */
export function slotDayLabel(iso: string): string {
  return DAY_FMT.format(new Date(iso));
}

/** "2:00 PM – 3:00 PM" in Louisiana time. */
export function slotTimeLabel(iso: string, minutes: number = SELLER_DELIVERY_RULES.slot_minutes): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + minutes * 60_000);
  return `${TIME_FMT.format(start)} – ${TIME_FMT.format(end)}`;
}

/** "Sat, Oct 25, 2:00 PM – 3:00 PM". */
export function slotLabel(iso: string, minutes: number = SELLER_DELIVERY_RULES.slot_minutes): string {
  return `${slotDayLabel(iso)}, ${slotTimeLabel(iso, minutes)}`;
}

/** The open times grouped by their Louisiana day, in order. */
export function groupSlotsByDay(slots: readonly string[]): { day: string; label: string; slots: string[] }[] {
  const out: { day: string; label: string; slots: string[] }[] = [];
  for (const s of [...slots].sort((a, b) => Date.parse(a) - Date.parse(b))) {
    const day = KEY_FMT.format(new Date(s));
    const last = out[out.length - 1];
    if (last && last.day === day) last.slots.push(s);
    else out.push({ day, label: slotDayLabel(s), slots: [s] });
  }
  return out;
}

/** Same instant (the server's text and the browser's ISO may differ in form). */
export function sameSlot(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && Date.parse(a) === Date.parse(b);
}

/** An RPC's data, or a throw carrying the plain words for its refusal on `userMessage` (the original error as `cause`). */
function data<T>(r: { data: T; error: { message: string } | null }, words: (e: unknown) => string | null): T {
  if (r.error) {
    const err = new Error(r.error.message) as Error & { userMessage?: string; cause?: unknown };
    const w = words(r.error);
    if (w) err.userMessage = w;
    err.cause = r.error;
    throw err;
  }
  return r.data;
}

export async function fetchMySellerDelivery(): Promise<MySellerDelivery> {
  return data(await supabase.rpc("declutter_my_seller_delivery"),
    (e) => rpcErrorMessage("declutter_my_seller_delivery", e)) as unknown as MySellerDelivery;
}

export async function saveSellerDelivery(enabled: boolean, rateCents: number, radiusMiles: number): Promise<MySellerDelivery> {
  return data(await supabase.rpc("declutter_set_seller_delivery", { p_enabled: enabled, p_rate_cents: rateCents, p_radius_miles: radiusMiles }),
    (e) => rpcErrorMessage("declutter_set_seller_delivery", e)) as unknown as MySellerDelivery;
}

export async function saveDeliverySchedule(windows: DeliveryWindow[], daysOff: string[]): Promise<MySellerDelivery> {
  return data(await supabase.rpc("declutter_set_delivery_schedule", { p_windows: windows, p_days_off: daysOff }),
    (e) => rpcErrorMessage("declutter_set_delivery_schedule", e)) as unknown as MySellerDelivery;
}

export async function setItemSellerDelivery(itemId: string, on: boolean): Promise<boolean> {
  return data(await supabase.rpc("declutter_set_item_seller_delivery", { p_item_id: itemId, p_on: on }),
    (e) => rpcErrorMessage("declutter_set_item_seller_delivery", e));
}

export async function fetchSellerDeliveryBooking(orderId: string): Promise<SellerDeliveryBooking> {
  return data(await supabase.rpc("declutter_seller_delivery_booking", { p_order_id: orderId }),
    (e) => rpcErrorMessage("declutter_seller_delivery_booking", e)) as unknown as SellerDeliveryBooking;
}

export async function markDelivered(orderId: string, photoPath: string): Promise<void> {
  data(await supabase.rpc("declutter_seller_delivered", { p_order_id: orderId, p_photo_path: photoPath }),
    (e) => rpcErrorMessage("declutter_seller_delivered", e));
}

export async function reportNotDelivered(orderId: string): Promise<void> {
  data(await supabase.rpc("declutter_report_not_delivered", { p_order_id: orderId }),
    (e) => rpcErrorMessage("declutter_report_not_delivered", e));
}

export async function sellerCancelDelivery(orderId: string): Promise<void> {
  data(await supabase.rpc("declutter_seller_cancel_delivery", { p_order_id: orderId }),
    (e) => rpcErrorMessage("declutter_seller_cancel_delivery", e));
}

export async function proposeDeliveryTime(orderId: string, slotStart: string): Promise<"proposed" | "booked"> {
  const out = data(await supabase.rpc("declutter_propose_delivery_time", { p_order_id: orderId, p_slot_start: slotStart }),
    (e) => rpcErrorMessage("declutter_propose_delivery_time", e)) as unknown as { result: "proposed" | "booked" };
  return out.result;
}

export async function answerDeliveryTime(orderId: string, accept: boolean): Promise<"moved" | "kept" | "slot_taken"> {
  const out = data(await supabase.rpc("declutter_answer_delivery_time", { p_order_id: orderId, p_accept: accept }),
    (e) => rpcErrorMessage("declutter_answer_delivery_time", e)) as unknown as { result: "moved" | "kept" | "slot_taken" };
  return out.result;
}

/** The open times of a SELLER for the order being moved (the same list checkout offers). */
export async function fetchSellerDeliveryOffer(sellerId: string): Promise<SellerDeliveryOffer> {
  return data(await supabase.rpc("declutter_seller_delivery_offer", { p_seller_id: sellerId }),
    (e) => rpcErrorMessage("declutter_seller_delivery_offer", e)) as unknown as SellerDeliveryOffer;
}

/**
 * The buyer's offer at checkout, optionally storing a new drop-off address
 * first (geocoded on the server by declutter-checkout, as Helpr delivery's).
 * Throws an Error whose message is the server's code.
 */
export async function quoteSellerDelivery(sellerId: string, address?: string): Promise<SellerDeliveryOffer> {
  const { data: body, error } = await supabase.functions.invoke("declutter-checkout", {
    body: { action: "seller_delivery_quote", seller_id: sellerId, ...(address ? { address } : {}), native: isNativePlatform },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const parsed: { error?: unknown } | null = ctx && typeof ctx.json === "function"
      ? await ctx.clone().json().catch((parseErr: unknown) => {
          // A body that is not JSON carries no code: the generic message is shown.
          console.warn("[declutter] seller delivery quote error body was not JSON", parseErr);
          return null;
        })
      : null;
    throw new Error(typeof parsed?.error === "string" && parsed.error ? parsed.error : "payment_unavailable");
  }
  const offer = (body as { offer?: SellerDeliveryOffer } | null)?.offer;
  if (!offer || typeof offer.available !== "boolean" || !Array.isArray(offer.slots)) throw new Error("payment_unavailable");
  return offer;
}
