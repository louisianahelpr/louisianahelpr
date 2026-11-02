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
  /**
   * Audit 1102c P1: every other read RPC the views make on this stage, by name, with the answer the server would give
   * (null where the real answer is "nothing"). A read missing here is reported (declutterPreviewChecks.onUnlisted)
   * and fails declutterPreviewPage.test.tsx.
   */
  reads: Record<string, unknown>;
  /** Every other table the views read on this stage, with its rows ([] where the real answer is none). */
  tables: Record<string, unknown[]>;
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

const TASK_ID = "00000000-0000-4000-d000-000000000040";
const PROBLEM_ID = "00000000-0000-4000-d000-000000000050";
const WEEKDAYS = [1, 2, 3, 4, 5, 6];

/** The reads every stage answers the same way: the seller's pickup set-up and the buyer's account state. */
function baseReads(now: number): Record<string, unknown> {
  return {
    declutter_my_free_pause: null,
    declutter_bundle_rule: null,
    declutter_refund_request_view: null,
    declutter_order_problem: null,
    // Platform-wide settings, not Declutter's: null reads as "not known yet" (fees and build gate keep their defaults).
    get_public_platform_settings: null,
    declutter_checkout_porch_days: WEEKDAYS,
    declutter_item_pickup_windows: WEEKDAYS.map((weekday) => ({ weekday, starts: "09:00", ends: "18:00" })),
    declutter_seller_porch_places: [{ id: "00000000-0000-4000-d000-000000000060", label: "Front porch", area: "Mid-City, Baton Rouge", weekdays: WEEKDAYS, chosen: true, windows: null }],
    declutter_meetup_spots_near: [{ id: "00000000-0000-4000-d000-000000000061", name: "BRPD 1st District lobby (sample)", address: "3255 Choctaw Dr, Baton Rouge", parish: "East Baton Rouge", kind: "police", note: null, miles: 2.1, chosen: false }],
    declutter_seller_delivery_offer: { available: true, reason: null, rate_cents: 800, base_rate_cents: 800, free_over_cents: null, items_cents: 4000, radius_miles: 10, dropoff_area: "Mid-City, Baton Rouge", slot_minutes: 60, slots: [hoursFrom(now, 26), hoursFrom(now, 28)], held_slot: null },
    declutter_order_place: [{ label: null, area: "Mid-City, Baton Rouge", address: "1234 Sample St, Baton Rouge, LA 70806", lat: 30.45, lng: -91.15, weekdays: WEEKDAYS }],
    declutter_item_address: [{ pickup_address: "1234 Sample St, Baton Rouge, LA 70806", pickup_lat: 30.45, pickup_lng: -91.15 }],
    declutter_donation_partners_near: [{ id: "00000000-0000-4000-d000-000000000062", name: "St. Vincent de Paul (sample)", address: "220 St Vincent St, Baton Rouge", parish: "East Baton Rouge", takes: "Furniture, housewares", miles: 3.4, chosen: false }],
    declutter_seller_delivery_booking: null,
    helpr_task_view: null,
    declutter_delivery_raise_status: null,
  };
}

/** The tables every stage reads: the order row (its pickup times), its lines, and lists that are empty here. */
function baseTables(buyerId: string, sellerId: string, now: number, slot: { start: string | null; end: string | null } = { start: null, end: null }): Record<string, unknown[]> {
  return {
    declutter_orders: [{ id: ORDER_ID, buyer_id: buyerId, seller_id: sellerId, status: "paid", total_cents: 4270, paid_at: hoursFrom(now, -2), book_by: hoursFrom(now, 46), pickup_slot_start: slot.start, pickup_slot_end: slot.end }],
    declutter_cart_items: [{ order_id: ORDER_ID, item_id: ITEM_ID, item_title: "Oak rocking chair (sample)", created_at: hoursFrom(now, -3) }],
    declutter_order_meetups: [],
    declutter_free_requests: [],
    declutter_watchlist: [],
    declutter_item_photos: [],
    declutter_handover_talks: [],
    declutter_payouts: [],
    declutter_questions: [],
  };
}

/** The sample for one stage, seen from one side, with the admin standing in as that side's member. */
export function declutterPreviewSample(stage: DeclutterPreviewStage, side: DeclutterPreviewSide, userId: string, now: number = Date.now()): DeclutterPreviewSample {
  const sellerId = side === "seller" ? userId : OTHER;
  const buyerId = side === "buyer" ? userId : OTHER;
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
    reads: baseReads(now), tables: baseTables(buyerId, sellerId, now),
  };
  const withReads = (smp: DeclutterPreviewSample, reads: Record<string, unknown>, tables: Record<string, unknown[]> = {}): DeclutterPreviewSample =>
    ({ ...smp, reads: { ...smp.reads, ...reads }, tables: { ...smp.tables, ...tables } });
  switch (stage) {
    case "checkout":
      return { ...base, cart: [line({ status: "in_cart", order_id: null, order_status: null, handover: null, total_cents: null })], items: side === "seller" ? [item(sellerId, now, { status: "reserved" })] : [], paidCents: [] };
    case "paid":
      return { ...base, cart: [paid("pickup_home")], handovers: { [ORDER_ID]: handover(side) } };
    case "booked":
      return withReads({ ...base, cart: [paid("pickup_home")], handovers: { [ORDER_ID]: handover(side) },
        bookings: [{ order_id: ORDER_ID, slot_start: hoursFrom(now, 26), slot_end: hoursFrom(now, 27), porch_mode: null, porch_until: null }] },
        {}, { declutter_orders: baseTables(buyerId, sellerId, now, { start: hoursFrom(now, 26), end: hoursFrom(now, 27) }).declutter_orders });
    case "porch":
      return withReads({ ...base, cart: [paid("porch")], handovers: { [ORDER_ID]: handover(side) },
        bookings: [{ order_id: ORDER_ID, slot_start: hoursFrom(now, 26), slot_end: hoursFrom(now, 30), porch_mode: "day", porch_until: hoursFrom(now, 30) }] },
        {}, { declutter_orders: baseTables(buyerId, sellerId, now, { start: hoursFrom(now, 26), end: hoursFrom(now, 30) }).declutter_orders });
    case "porch_set_out":
      return withReads({ ...base, cart: [paid("porch")], handovers: { [ORDER_ID]: handover(side, { set_out_at: hoursFrom(now, -1), set_out_note: "On the left of the steps." }) },
        bookings: [{ order_id: ORDER_ID, slot_start: hoursFrom(now, -2), slot_end: hoursFrom(now, 3), porch_mode: "day", porch_until: hoursFrom(now, 3) }] },
        {}, { declutter_orders: baseTables(buyerId, sellerId, now, { start: hoursFrom(now, -2), end: hoursFrom(now, 3) }).declutter_orders });
    case "meetup":
      return withReads({ ...base, cart: [paid("meetup")], handovers: { [ORDER_ID]: handover(side) },
        bookings: [{ order_id: ORDER_ID, slot_start: hoursFrom(now, 26), slot_end: hoursFrom(now, 27), porch_mode: null, porch_until: null }] },
        {}, {
          declutter_orders: baseTables(buyerId, sellerId, now, { start: hoursFrom(now, 26), end: hoursFrom(now, 27) }).declutter_orders,
          declutter_order_meetups: [{ order_id: ORDER_ID, spot_name: "BRPD 1st District lobby (sample)", spot_address: "3255 Choctaw Dr, Baton Rouge", spot_lat: 30.47, spot_lng: -91.14, buyer_here_at: null, seller_here_at: null }],
        });
    case "seller_delivery":
      return withReads({ ...base, cart: [paid("seller_delivery", { delivery_cents: 800, total_cents: 5070 })], handovers: { [ORDER_ID]: handover(side) } }, {
        declutter_seller_delivery_booking: {
          order_id: ORDER_ID, side, order_status: "paid", status: "booked", slot_start: hoursFrom(now, 26), slot_end: hoursFrom(now, 27), delivery_cents: 800,
          dropoff_area: "Mid-City, Baton Rouge", handoff: "hand", dropoff_address: "1500 Sample Ave, Baton Rouge, LA 70806", proposed_start: null, proposed_by: null,
          proposals_left: 2, delivered_at: null, delivered_photo_path: null, confirmed_at: null, not_delivered_from: null,
        },
      });
    case "helpr_delivery":
      return withReads({ ...base, cart: [paid("delivery", { delivery_cents: 900, total_cents: 5170, delivery_task_id: TASK_ID })], handovers: { [ORDER_ID]: handover(side) } }, {
        helpr_task_view: {
          task_id: TASK_ID, source_kind: "declutter_order", source_id: ORDER_ID, role: side === "buyer" ? "customer" : "pickup_contact", status: "accepted", size: "small", title: "Oak rocking chair (sample)",
          pickup_area: "Mid-City, Baton Rouge", dropoff_area: "Garden District, Baton Rouge", trip_miles: 3.2, take_home_cents: null, pay_cents: 900, fee_cents: null,
          open_until: hoursFrom(now, 20), latest_pickup_at: hoursFrom(now, 30), pickup_slot_start: hoursFrom(now, 26), accepted_at: hoursFrom(now, -1), picked_up_at: null,
          delivered_at: null, confirmed_at: null, confirmed_by: null, helpr_first_name: "Jordan", pickup_address: null, pickup_lat: null, pickup_lng: null,
          dropoff_address: null, dropoff_lat: null, dropoff_lng: null, pickup_photo_path: null, dropoff_photo_path: null, handed_over_at: null, problem_open: false,
        },
        declutter_delivery_raise_status: { order_id: ORDER_ID, task_status: "accepted", open_until: hoursFrom(now, 20), delivery_cents: 900, raised_cents: 0, can_raise: false, room_cents: 0, raises: [] },
      });
    case "handed_over":
      return { ...base, cart: [paid("pickup_home", { order_status: "handed_over" })],
        handovers: { [ORDER_ID]: handover(side, { status: "handed_over", confirmed_at: hoursFrom(now, -3), confirmed_by: "buyer", picked_up_at: hoursFrom(now, -3) }) } };
    case "refund":
      return { ...base, cart: [paid("pickup_home", { order_status: "refunded", closed_at: hoursFrom(now, -5) })], handovers: { [ORDER_ID]: handover(side) } };
    case "problem":
      return withReads({ ...base, cart: [paid("pickup_home")], handovers: { [ORDER_ID]: handover(side) },
        problems: [{ id: PROBLEM_ID, order_id: ORDER_ID, reporter_side: "buyer", reason: "not_as_described" }] }, {
        declutter_order_problem: { id: PROBLEM_ID, reporter_side: "buyer", reason: "not_as_described", note: "The back leg is cracked (sample).", photo_paths: [], status: "open", created_at: hoursFrom(now, -2), other_side_note: null, other_side_photo_paths: [], other_side_at: null },
      });
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
