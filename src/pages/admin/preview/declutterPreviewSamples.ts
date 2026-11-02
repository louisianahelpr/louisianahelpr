/**
 * Q2585 (Auditor 1, audit 1102a): the made-up Declutter orders the admin stage preview draws
 * (/admin/preview/declutter). One sample per order stage, for either side. Nothing here is read from or written to the
 * server: declutterPreviewBackend.ts answers the real Buying / Selling views' reads from these rows.
 *
 * The ids are fixed fake UUIDs in the 0000...d0 range, so a sample row can never collide with a real one.
 */
import type { CartLine, DeclutterItem, Handover, MyOffer } from "@/lib/declutter/api";
import type { MyHandover, OpenProblem } from "@/lib/declutter/handover";
import type { HaulAwayRow } from "@/lib/declutter/haulAwayParam";
import type { MyDonation } from "@/lib/declutter/donate";

export type DeclutterPreviewSide = "buyer" | "seller";

export const DECLUTTER_PREVIEW_STAGES = [
  { key: "checkout", label: "In the cart (to pay)" },
  { key: "paid", label: "Paid, pickup not booked" },
  { key: "booked", label: "Pickup booked" },
  { key: "porch", label: "Porch pickup" },
  { key: "porch_set_out", label: "Porch: set out" },
  { key: "meetup", label: "Safe meeting spot" },
  { key: "seller_delivery", label: "Seller delivers" },
  { key: "helpr_delivery", label: "Helpr delivery" },
  { key: "handed_over", label: "Handed over" },
  { key: "refund", label: "Refunded" },
  { key: "problem", label: "Problem reported" },
  { key: "cancelled", label: "Ran out (cancelled)" },
  { key: "haul_away", label: "Haul-away" },
  { key: "donation", label: "Donation" },
] as const;

export type DeclutterPreviewStage = (typeof DECLUTTER_PREVIEW_STAGES)[number]["key"];

export function isDeclutterPreviewStage(v: string | null): v is DeclutterPreviewStage {
  return DECLUTTER_PREVIEW_STAGES.some((s) => s.key === v);
}

export interface DeclutterPreviewSample {
  stage: DeclutterPreviewStage;
  side: DeclutterPreviewSide;
  /** The signed-in admin, standing in as the member on this side. */
  userId: string;
  cart: CartLine[];
  offers: MyOffer[];
  items: DeclutterItem[];
  bookings: { order_id: string; slot_start: string; slot_end: string; porch_mode: string | null; porch_until: string | null }[];
  handovers: Record<string, MyHandover>;
  problems: OpenProblem[];
  paidCents: { order_id: string; paid_cents: number }[];
  haulAway: HaulAwayRow[];
  donations: MyDonation[];
  profiles: { id: string; first_name: string; last_name: string; avatar_url: string | null }[];
}

const OTHER = "00000000-0000-4000-d000-000000000002";
const ITEM_ID = "00000000-0000-4000-d000-000000000010";
const ORDER_ID = "00000000-0000-4000-d000-000000000020";
const LINE_ID = "00000000-0000-4000-d000-000000000030";

const hoursFrom = (now: number, h: number) => new Date(now + h * 3_600_000).toISOString();

function item(sellerId: string, now: number, over: Partial<DeclutterItem> = {}): DeclutterItem {
  return {
    id: ITEM_ID, seller_id: sellerId, status: "live", title: "Oak rocking chair (sample)", description: "Solid oak, rocks smooth.",
    category: "furniture", condition_stars: 4, delivery_size: "small", price_cents: 4000, current_price_cents: 4000,
    area_label: "Mid-City, Baton Rouge", area_lat: 30.45, area_lng: -91.15, created_at: hoursFrom(now, -24 * 20),
    live_at: hoursFrom(now, -24 * 20), porch_ok: true, accepts_offers: true, handovers: ["porch", "meetup", "delivery"], ...over,
  };
}

function handover(side: DeclutterPreviewSide, over: Partial<MyHandover> = {}): MyHandover {
  return { order_id: ORDER_ID, status: "paid", side, confirmed_at: null, set_out_at: null, set_out_photo_path: null, picked_up_at: null, ...over };
}

/** The sample for one stage, seen from one side, with the admin standing in as that side's member. */
export function declutterPreviewSample(stage: DeclutterPreviewStage, side: DeclutterPreviewSide, userId: string, now: number = Date.now()): DeclutterPreviewSample {
  const sellerId = side === "seller" ? userId : OTHER;
  const line = (over: Partial<CartLine>): CartLine => ({
    line_id: LINE_ID, item_id: ITEM_ID, item_title: "Oak rocking chair (sample)", my_side: side, seller_id: sellerId, price_cents: 4000,
    status: "paid", checkout_by: hoursFrom(now, 20), order_id: ORDER_ID, order_status: "paid", handover: "pickup_home",
    premium_cents: null, total_cents: 4270, porch_ok: true, handovers: ["porch", "meetup", "delivery"], delivery_cents: 0,
    delivery_task_id: null, source: "buy", closed_at: null, ...over,
  });
  const paid = (h: Handover, over: Partial<CartLine> = {}) => line({ handover: h, ...over });
  const base: DeclutterPreviewSample = {
    stage, side, userId, cart: [], offers: [], items: side === "seller" ? [item(sellerId, now, { status: "sold" })] : [],
    bookings: [], handovers: {}, problems: [], paidCents: [{ order_id: ORDER_ID, paid_cents: 4270 }], haulAway: [], donations: [],
    profiles: [{ id: OTHER, first_name: side === "seller" ? "Dana" : "Marie", last_name: "Sample", avatar_url: null }],
  };
  switch (stage) {
    case "checkout":
      return { ...base, cart: [line({ status: "in_cart", order_id: null, order_status: null, handover: null, total_cents: null })], items: side === "seller" ? [item(sellerId, now, { status: "reserved" })] : [], paidCents: [] };
    case "paid":
      return { ...base, cart: [paid("pickup_home")], handovers: { [ORDER_ID]: handover(side) } };
    case "booked":
      return { ...base, cart: [paid("pickup_home")], handovers: { [ORDER_ID]: handover(side) },
        bookings: [{ order_id: ORDER_ID, slot_start: hoursFrom(now, 26), slot_end: hoursFrom(now, 27), porch_mode: null, porch_until: null }] };
    case "porch":
      return { ...base, cart: [paid("porch")], handovers: { [ORDER_ID]: handover(side) },
        bookings: [{ order_id: ORDER_ID, slot_start: hoursFrom(now, 26), slot_end: hoursFrom(now, 30), porch_mode: "day", porch_until: hoursFrom(now, 30) }] };
    case "porch_set_out":
      return { ...base, cart: [paid("porch")], handovers: { [ORDER_ID]: handover(side, { set_out_at: hoursFrom(now, -1), set_out_note: "On the left of the steps." }) },
        bookings: [{ order_id: ORDER_ID, slot_start: hoursFrom(now, -2), slot_end: hoursFrom(now, 3), porch_mode: "day", porch_until: hoursFrom(now, 3) }] };
    case "meetup":
      return { ...base, cart: [paid("meetup")], handovers: { [ORDER_ID]: handover(side) },
        bookings: [{ order_id: ORDER_ID, slot_start: hoursFrom(now, 26), slot_end: hoursFrom(now, 27), porch_mode: null, porch_until: null }] };
    case "seller_delivery":
      return { ...base, cart: [paid("seller_delivery", { delivery_cents: 800, total_cents: 5070 })], handovers: { [ORDER_ID]: handover(side) } };
    case "helpr_delivery":
      return { ...base, cart: [paid("delivery", { delivery_cents: 900, total_cents: 5170, delivery_task_id: "00000000-0000-4000-d000-000000000040" })], handovers: { [ORDER_ID]: handover(side) } };
    case "handed_over":
      return { ...base, cart: [paid("pickup_home", { order_status: "handed_over" })],
        handovers: { [ORDER_ID]: handover(side, { status: "handed_over", confirmed_at: hoursFrom(now, -3), confirmed_by: "buyer", picked_up_at: hoursFrom(now, -3) }) } };
    case "refund":
      return { ...base, cart: [paid("pickup_home", { order_status: "refunded", closed_at: hoursFrom(now, -5) })], handovers: { [ORDER_ID]: handover(side) } };
    case "problem":
      return { ...base, cart: [paid("pickup_home")], handovers: { [ORDER_ID]: handover(side) },
        problems: [{ id: "00000000-0000-4000-d000-000000000050", order_id: ORDER_ID, reporter_side: side === "buyer" ? "buyer" : "buyer", reason: "not_as_described" }] };
    case "cancelled":
      return { ...base, cart: [line({ status: "missed", order_id: null, order_status: null, handover: null, total_cents: null, closed_at: hoursFrom(now, -6) })], items: [], paidCents: [] };
    case "haul_away":
      return { ...base, cart: [], paidCents: [], items: side === "seller" ? [item(sellerId, now, { delivery_size: "large" })] : [],
        haulAway: side === "seller" ? [{ item_id: ITEM_ID, title: "Oak rocking chair (sample)", description: "Solid oak.", delivery_size: "large", item_status: "live",
          state: "eligible", eligible_at: hoursFrom(now, -24), job_id: null, pickup_group: "g1", photo_paths: [], job_hold: null }] : [] };
    case "donation":
      return { ...base, cart: [], paidCents: [], items: side === "seller" ? [item(sellerId, now, { status: "withdrawn" })] : [],
        donations: side === "seller" ? [{ item_id: ITEM_ID, item_title: "Oak rocking chair (sample)", partner_name: "St. Vincent de Paul (sample)",
          partner_address: "220 St Vincent St, Baton Rouge", chosen_at: hoursFrom(now, -30), donated_at: null, receipt: false }] : [] };
  }
}
