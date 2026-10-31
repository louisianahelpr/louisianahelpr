/**
 * Declutter seller delivery: the seller delivers for a flat rate and the buyer
 * picks a date and time (migration 20261027153244; switch
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
import { currentPosition } from "./position";
import { discardRefusedHandoverPhoto } from "./handover";

/** The numbers the owner confirmed on 2026-10-22 (see the SQL function of the same name). */
export const SELLER_DELIVERY_RULES = {
  rate_min_cents: 500,
  rate_max_cents: 15000,
  free_rate_cents: 0,
  free_over_min_cents: 100,
  free_over_max_cents: 1000000,
  radius_choices_miles: [5, 10, 25, 50],
  radius_default_miles: 10,
  slot_minutes: 60,
  lead_hours: 24,
  horizon_days: 14,
  per_slot: 1,
  hold_minutes: 35,
  not_delivered_after_minutes: 15,
  auto_confirm_hours: 24,
  proposals_per_side: 1,
  reminder_hours: [24, 1],
  timezone: "America/Chicago",
} as const;

export type SellerDeliveryRules = {
  rate_min_cents: number;
  rate_max_cents: number;
  /** 0: the seller delivers for free (owner 2026-10-27). */
  free_rate_cents: number;
  /** "Free delivery on orders of $X or more": X from $1 to $10,000, whole dollars. */
  free_over_min_cents: number;
  free_over_max_cents: number;
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

/** The buyer's choice at booking (owner 2026-10-22): left at the door with a photo, or handed to them. */
export type DeliveryHandoff = "leave" | "hand";

export type MySellerDelivery = {
  enabled: boolean;
  /** 0 = free delivery. */
  rate_cents: number | null;
  /** With a paid rate: free on orders of this much or more (items from this seller, before fees). */
  free_over_cents: number | null;
  radius_miles: number;
  windows: DeliveryWindow[];
  days_off: string[];
  items_off: string[];
  rules: SellerDeliveryRules;
};

type SellerDeliveryUnavailable =
  /** Nothing from this seller is waiting for checkout (20261028200440: an answer, no longer an error). */
  | "cart_empty"
  | "seller_not_delivering"
  | "item_not_deliverable"
  | "address_needed"
  | "out_of_range"
  | "no_times";

export type SellerDeliveryOffer = {
  available: boolean;
  reason: SellerDeliveryUnavailable | null;
  /** What THIS order pays for delivery: 0 when free (a $0 rate, or the order reached free_over_cents). */
  rate_cents: number | null;
  /** The seller's own rate (0 = free delivery). */
  base_rate_cents: number | null;
  /** The seller's "free on orders of $X or more", if set. */
  free_over_cents: number | null;
  /** This order's items total from the seller, before fees (what free_over_cents is compared with). */
  items_cents: number | null;
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
  handoff: DeliveryHandoff;
  dropoff_address: string | null;
  proposed_start: string | null;
  proposed_by: "buyer" | "seller" | null;
  proposals_left: number;
  delivered_at: string | null;
  delivered_photo_path: string | null;
  confirmed_at: string | null;
  not_delivered_from: string | null;
};

/**
 * The checkout amounts with the seller's delivery: the buyer's fee counts the
 * rate (declutter_buyer_fee_cents_seller_delivery, 5% of items + rate, + 70c,
 * once), and the rate is its own line. The server's numbers are the ones charged.
 */
export function sellerDeliveryAmounts(itemsCents: number, rateCents: number): { premiumCents: number; totalCents: number } {
  const premiumCents = Math.round((Math.max(0, itemsCents) + Math.max(0, rateCents)) * 0.05) + 70;
  return { premiumCents, totalCents: itemsCents + premiumCents + rateCents };
}

/** $0 (free delivery) or a whole-dollar rate inside the caps (the server checks the same). */
export function rateIsValid(cents: number, rules: SellerDeliveryRules = SELLER_DELIVERY_RULES): boolean {
  if (!Number.isInteger(cents) || cents % 100 !== 0) return false;
  return cents === rules.free_rate_cents || (cents >= rules.rate_min_cents && cents <= rules.rate_max_cents);
}

/** A "free on orders of $X or more" amount: whole dollars inside its caps, and only with a paid rate. */
export function freeOverIsValid(cents: number | null, rateCents: number, rules: SellerDeliveryRules = SELLER_DELIVERY_RULES): boolean {
  if (cents === null) return true;
  return rateCents > 0 && Number.isInteger(cents) && cents % 100 === 0
    && cents >= rules.free_over_min_cents && cents <= rules.free_over_max_cents;
}

/**
 * The rate an order pays (owner 2026-10-27), the mirror of the SQL
 * declutter_seller_delivery_rate_cents: 0 when the seller delivers free, 0 when
 * the order's items total from that seller (before fees) reaches the seller's
 * free-delivery amount, else the rate. The server's number is the one charged.
 */
export function deliveryRateFor(rateCents: number, freeOverCents: number | null, itemsCents: number): number {
  if (rateCents <= 0) return 0;
  if (freeOverCents !== null && itemsCents >= freeOverCents) return 0;
  return rateCents;
}

/** "$12", or "$12.50" if it ever had cents. */
const dollars = (cents: number) => `$${cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)}`;

/**
 * The seller's terms in plain words, for the settings card and the checkout
 * (owner 2026-10-27): "Free delivery", "Free delivery on $50+, otherwise $10",
 * or "$10 delivery".
 */
export function deliveryTermsLabel(rateCents: number, freeOverCents: number | null): string {
  if (rateCents <= 0) return "Free delivery";
  if (freeOverCents !== null) return `Free delivery on ${dollars(freeOverCents)}+, otherwise ${dollars(rateCents)}`;
  return `${dollars(rateCents)} delivery`;
}

const DAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: SELLER_DELIVERY_RULES.timezone, weekday: "short", month: "short", day: "numeric" });
const TIME_FMT = new Intl.DateTimeFormat("en-US", { timeZone: SELLER_DELIVERY_RULES.timezone, hour: "numeric", minute: "2-digit" });
const KEY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: SELLER_DELIVERY_RULES.timezone, year: "numeric", month: "2-digit", day: "2-digit" });

/** "Sat, Oct 25" in Louisiana time. */
function slotDayLabel(iso: string): string {
  return DAY_FMT.format(new Date(iso));
}

const ZONE_FMT = new Intl.DateTimeFormat("en-US", { timeZone: SELLER_DELIVERY_RULES.timezone, timeZoneName: "short" });
const zoneName = (d: Date): string => ZONE_FMT.formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "";
/** Within an hour of a clock change (the 1 AM that happens twice in November, the skipped 2 AM in March). */
function nearClockChange(d: Date): boolean {
  const z = zoneName(d);
  return zoneName(new Date(d.getTime() - 3_600_000)) !== z || zoneName(new Date(d.getTime() + 3_600_000)) !== z;
}

/**
 * "2:00 PM – 3:00 PM" in Louisiana time. On the night the clocks change, a
 * time within an hour of the change names its zone (AUD31-6): "1:00 AM CDT –
 * 1:00 AM CST", never "1:00 AM – 1:00 AM".
 */
export function slotTimeLabel(iso: string, minutes: number = SELLER_DELIVERY_RULES.slot_minutes): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + minutes * 60_000);
  const plain = `${TIME_FMT.format(start)} – ${TIME_FMT.format(end)}`;
  if (!nearClockChange(start) && !nearClockChange(end)) return plain;
  const at = (d: Date) => (nearClockChange(d) ? `${TIME_FMT.format(d)} ${zoneName(d)}` : TIME_FMT.format(d));
  return `${at(start)} – ${at(end)}`;
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

export async function saveSellerDelivery(enabled: boolean, rateCents: number, radiusMiles: number, freeOverCents: number | null = null): Promise<MySellerDelivery> {
  return data(await supabase.rpc("declutter_set_seller_delivery", {
    p_enabled: enabled, p_rate_cents: rateCents, p_radius_miles: radiusMiles,
    // Omitted (never sent as null) when there is none: the RPC's default is null.
    ...(freeOverCents !== null ? { p_free_over_cents: freeOverCents } : {}),
  }),
    (e) => rpcErrorMessage("declutter_set_seller_delivery", e)) as unknown as MySellerDelivery;
}

export async function saveDeliverySchedule(windows: DeliveryWindow[], daysOff: string[]): Promise<MySellerDelivery> {
  return data(await supabase.rpc("declutter_set_delivery_schedule", { p_windows: windows, p_days_off: daysOff }),
    (e) => rpcErrorMessage("declutter_set_delivery_schedule", e)) as unknown as MySellerDelivery;
}

export async function setItemSellerDelivery(itemId: string, on: boolean): Promise<boolean> {
  return data(await supabase.rpc("declutter_set_item_seller_delivery", { p_item_id: itemId, p_on: on }),
    (e) => rpcErrorMessage("declutter_set_item_seller_delivery", e)) === true;
}

export async function fetchSellerDeliveryBooking(orderId: string): Promise<SellerDeliveryBooking> {
  return data(await supabase.rpc("declutter_seller_delivery_booking", { p_order_id: orderId }),
    (e) => rpcErrorMessage("declutter_seller_delivery_booking", e)) as unknown as SellerDeliveryBooking;
}

/** The device's position for the "left at your door" photo; refused location speaks of the buyer's address. */
export async function deliveryPhotoPosition(): Promise<{ lat: number; lng: number }> {
  try {
    return await currentPosition();
  } catch (e) {
    const err = e as Error & { userMessage?: string };
    const words = rpcErrorMessage("declutter_seller_delivered", err);
    if (words && Object.isExtensible(err)) err.userMessage = words;
    throw err;
  }
}

/** With a photo, `where` is the device's position: it is taken at the buyer's door (20261028235709, within 200 m). */
export async function markDelivered(orderId: string, photoPath: string, where: { lat: number; lng: number } | null = null): Promise<void> {
  const res = await supabase.rpc("declutter_seller_delivered", {
    p_order_id: orderId,
    p_photo_path: photoPath,
    p_lat: (where?.lat ?? null) as number,
    p_lng: (where?.lng ?? null) as number,
  });
  // Audit 1a #10: a refused photo is removed from storage (best effort; "" means no photo was taken).
  if (res.error) await discardRefusedHandoverPhoto(photoPath);
  data(res, (e) => rpcErrorMessage("declutter_seller_delivered", e));
}

export async function reportNotDelivered(orderId: string): Promise<void> {
  data(await supabase.rpc("declutter_report_not_delivered", { p_order_id: orderId }),
    (e) => rpcErrorMessage("declutter_report_not_delivered", e));
}


/** The buyer's door choice after paying (owner 2026-10-22); the seller is told. */
export async function setDeliveryHandoff(orderId: string, handoff: DeliveryHandoff): Promise<DeliveryHandoff> {
  return data(await supabase.rpc("declutter_set_delivery_handoff", { p_order_id: orderId, p_handoff: handoff }),
    (e) => rpcErrorMessage("declutter_set_delivery_handoff", e)) as DeliveryHandoff;
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

/** The open times a paid seller delivery can move to (either side; the same list checkout offers). */
export async function fetchDeliveryOpenTimes(orderId: string): Promise<{ slots: string[]; slot_minutes: number }> {
  return data(await supabase.rpc("declutter_delivery_open_times", { p_order_id: orderId }),
    (e) => rpcErrorMessage("declutter_delivery_open_times", e)) as unknown as { slots: string[]; slot_minutes: number };
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
    throw new Error(typeof parsed?.error === "string" && parsed.error ? parsed.error : "delivery_check_unavailable");
  }
  const offer = (body as { offer?: SellerDeliveryOffer } | null)?.offer;
  if (!offer || typeof offer.available !== "boolean" || !Array.isArray(offer.slots)) throw new Error("delivery_check_unavailable");
  return offer;
}
