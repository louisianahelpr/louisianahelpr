/**
 * Shops orders (Shops M1, migration 20261018164442_shops_orders_checkout;
 * docs/specs/local-shops-prep.md L17-L22, L37/F1, L41 + O2).
 *
 * Money moves only through the shop-checkout edge function (it runs the
 * shops_* order RPCs AS the member, then holds, captures or drops the card
 * hold at Stripe). Reads are the member's own rows under RLS (buyer or shop
 * owner), never the Stripe ids (column grants). Every refusal comes back as
 * its code; shopsErrorMessage turns it into plain words.
 */
import { assertNever } from "@/lib/assertNever";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isNativePlatform } from "@/lib/nativeInit";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { rpcErrorMessage } from "./rpcErrorCopy";
import { openShopsIdentityCheckFor } from "./errors";

export type CancelPolicy = "until_24h_before_ready" | "until_accept" | "until_handover";

/** The three presets a shop picks from (O2). S2-030 (Shops audit 2): a rule whose cancel keeps the small card
 * processing cost is worded "Cancel for a refund until ...", never "Free to cancel"; only until_accept is free
 * (the card is only held).  `label`/`detail` are the words a buyer reads before paying; `shop` is
 * the shop's own settings words (S022, Shops audit 11-12: the picker spoke to the buyer, "your order"). */
export const CANCEL_POLICY_TEXT: Record<CancelPolicy, { label: string; detail: string; shop: { label: string; hint: string } }> = {
  until_24h_before_ready: {
    label: "Cancel for a refund until 24 hours before the ready date",
    detail: "After the shop accepts, you can cancel for a refund of the price until 24 hours before the ready date. A small card processing cost isn't refunded.",
    shop: {
      label: "Free cancel until 24 hours before the ready date",
      hint: "After you accept, buyers can cancel for a refund of the price until 24 hours before the ready date.",
    },
  },
  until_accept: {
    label: "Free to cancel until the shop accepts",
    detail: "Once the shop accepts, the order is final.",
    shop: {
      label: "Free cancel until you accept",
      hint: "Buyers can cancel for free until you accept. Once you accept, the order is final.",
    },
  },
  // Owner 2026-10-18 ~22:30Z (Q2155): free cancel closes when the ready date begins, or earlier when the shop
  // marks the order ready, never at pickup. What an early ready tap does is the SHOP's choice (owner 2026-10-19:
  // "LET THE SHOPS DECIDE THIS."): READY_TAP_CANCEL_TEXT, and cancelPolicyText for the buyer's exact words.
  until_handover: {
    label: "Cancel for a refund until your order is ready",
    detail: "After the shop accepts, you can cancel for a refund of the price until your ready date begins, or until the shop marks your order ready if its rule says so. A small card processing cost isn't refunded.",
    shop: {
      label: "Free cancel until the order is ready",
      hint: "After you accept, buyers can cancel for a refund of the price until the ready date begins. Below, choose whether marking an order ready ends it sooner.",
    },
  },
};
export const CANCEL_POLICIES = Object.keys(CANCEL_POLICY_TEXT) as CancelPolicy[];

/** What a shop's early "ready" tap does to the buyer's free cancel under 'until_handover' (shops.ready_tap_cancel,
 * frozen on each order; shop_order_free_cancel_until, 20261019015018). The shop picks; the default is
 * 'from_day_before'. `label`/`hint` are the shop's settings words, `buyer` what the buyer reads before paying. */
export type ReadyTapCancel = "ends_at_tap" | "from_day_before" | "never_shortens";
export const READY_TAP_CANCEL_TEXT: Record<ReadyTapCancel, { label: string; hint: string; buyer: string }> = {
  ends_at_tap: {
    label: "Marking it ready ends free cancel",
    hint: "Buyers can cancel for free until you mark the order ready, or until the ready date begins if that comes first.",
    buyer: "After the shop accepts, you can cancel for a refund of the price until your ready date begins. If the shop marks your order ready sooner, the refund ends then. A small card processing cost isn't refunded.",
  },
  from_day_before: {
    label: "Marking it ready counts from the day before (default)",
    hint: "If you mark an order ready early, buyers can still cancel for free until the day before the ready date begins.",
    buyer: "After the shop accepts, you can cancel for a refund of the price until your ready date begins. If the shop marks your order ready, the refund ends then, but never before the day before your ready date. A small card processing cost isn't refunded.",
  },
  never_shortens: {
    label: "Marking it ready never ends free cancel early",
    hint: "Buyers can cancel for free until the ready date begins, however early you mark the order ready.",
    buyer: "After the shop accepts, you can cancel for a refund of the price until your ready date begins, even if the shop marks your order ready sooner. A small card processing cost isn't refunded.",
  },
};
export const READY_TAP_CANCELS = Object.keys(READY_TAP_CANCEL_TEXT) as ReadyTapCancel[];

/** How paying works, in the words the order sheet and the shop's policies card both show (one source). */
/** S010 (Shops audit 11-12, lead 11-12 by the 10-25 rule and #20 "Words only"): a buyer total says in words that a
 * service fee is inside it, with no fee row, rate or number. */
export const SHOP_SERVICE_FEE_INCLUDED = "Includes a small Louisiana Helpr service fee.";

/** S036 (Shops audit 11-12): the setup fee this order's card really carried (outside total_cents), else 0. */
export function setupFeeChargedCents(o: Pick<ShopOrder, "setup_fee_cents" | "setup_fee_state">): number {
  return o.setup_fee_state === "claimed" ? Math.max(0, Number(o.setup_fee_cents ?? 0)) : 0;
}

/** What the buyer's card paid for this order: total_cents plus a charged setup fee (S036). */
export function buyerPaidCents(o: Pick<ShopOrder, "total_cents" | "setup_fee_cents" | "setup_fee_state">): number {
  return o.total_cents + setupFeeChargedCents(o);
}

export const ORDER_HOLD_TEXT = "Your card is held, not charged. The shop has 24 hours to accept; your card is charged only if it does.";

/** The buyer's words for a shop's cancel rule: the preset, and under 'until_handover' the shop's ready-tap choice. */
export function cancelPolicyText(policy: CancelPolicy, readyTap: ReadyTapCancel | null | undefined): { label: string; detail: string } {
  if (policy !== "until_handover") return CANCEL_POLICY_TEXT[policy];
  const tap = readyTap ?? "from_day_before";
  return {
    label: tap === "never_shortens" ? "Cancel for a refund until your ready date"
      : tap === "ends_at_tap" ? "Cancel for a refund until the shop marks it ready" : CANCEL_POLICY_TEXT.until_handover.label,
    detail: READY_TAP_CANCEL_TEXT[tap].buyer,
  };
}

type OrderStatus =
  | "awaiting_hold" | "held" | "accepted" | "declined" | "expired" | "cancelled" | "superseded" | "handed_over" | "refunded"
  | "partially_refunded";

interface OrderLine {
  id: string;
  item_id: string | null;
  title: string;
  kind: string;
  unit_cents: number;
  quantity: number;
  line_cents: number;
  /** H8 (b): carpet or furniture cleaning done at the buyer's place (frozen on the line). */
  at_buyer?: boolean;
}

export interface ShopOrder {
  id: string;
  buyer_id: string | null;
  seller_id: string | null;
  shop_id: string | null;
  status: OrderStatus;
  close_reason: string | null;
  ready_date: string;
  cancel_policy: CancelPolicy;
  /** 20261019015018: what an early ready tap does to free cancel, frozen when the order was asked for. */
  ready_tap_cancel: ReadyTapCancel;
  note: string;
  decline_reason: string | null;
  items_cents: number;
  premium_cents: number;
  tax_cents: number;
  total_cents: number;
  created_at: string;
  held_at: string | null;
  accept_by: string | null;
  accepted_at: string | null;
  captured_at: string | null;
  closed_at: string | null;
  /** Shops M2 (20261018211820): how this order is handed over, frozen when it was asked for. */
  handover_mode: "porch" | "in_person";
  /** Delivery (20261106180902): pickup, or the shop delivers for its own frozen fee (in total_cents). */
  /** Optional: a row read before the columns deploy has neither (a pickup, no fee). */
  fulfillment?: "pickup" | "shop_delivers" | "helpr_delivers";
  delivery_cents?: number;
  /** Helpr delivery (20261106194913): no Helpr took it, so the order became a pickup and the delivery came back. */
  helpr_unfilled_at?: string | null;
  handed_over_at: string | null;
  /** Custom orders (20261106212437/20261106221300): half when the shop accepts, the rest from the ready date. */
  payment_plan?: "full_hold" | "deposit_50";
  deposit_cents?: number | null;
  balance_cents?: number | null;
  balance_captured_at?: string | null;
  /** The saved card did not take the rest (or none was saved): the buyer pays it from the order. */
  balance_failed_at?: string | null;
  /** H4 (20261105181603): the one-time setup fee this order's page carried, OUTSIDE total_cents; charged only when
   * setup_fee_state is 'claimed'. Optional: an older row read has neither. */
  setup_fee_cents?: number;
  setup_fee_state?: string | null;
  /** Digital downloads (20261108185110): one download, no ready date, pickup or handover. */
  is_digital?: boolean;
  shop_order_lines: OrderLine[];
  /** Preorders (20261108184654): the item this order preorders (paid in full at order), and when its date was pushed. */
  preorder_item_id?: string | null;
  preorder_moved_at?: string | null;
  /** The shop's name (buyer list only); null once the shop is gone or hidden from the buyer. */
  shops?: { name: string } | null;
}

export interface OrderTerms {
  cancel_policy: CancelPolicy;
  /** The shop's ready-tap choice (absent from a server older than 20261019015018: the default). */
  ready_tap_cancel?: ReadyTapCancel;
  paused: boolean;
  open_weekdays: number[];
  daily_order_cap: number | null;
  today: string;
  last_day: string;
  full_days: string[];
}

const ORDER_COLUMNS =
  "id, buyer_id, seller_id, shop_id, status, close_reason, ready_date, cancel_policy, ready_tap_cancel, note, decline_reason, items_cents, " +
  "premium_cents, tax_cents, total_cents, created_at, held_at, accept_by, accepted_at, captured_at, closed_at, handover_mode, fulfillment, delivery_cents, helpr_unfilled_at, handed_over_at, " +
  "payment_plan, deposit_cents, balance_cents, balance_captured_at, balance_failed_at, preorder_item_id, preorder_moved_at, is_digital, setup_fee_cents, setup_fee_state, " +
  "shop_order_lines (id, item_id, title, kind, unit_cents, quantity, line_cents, at_buyer)";

/** The member's orders as a buyer (newest first); a page that was never paid is not an order to show. */
export async function fetchMyOrders(userId: string): Promise<ShopOrder[]> {
  const rows = unwrap(
    await supabase.from("shop_orders").select(`${ORDER_COLUMNS}, shops (name)`).eq("buyer_id", userId)
      .not("status", "in", "(awaiting_hold,superseded)").order("created_at", { ascending: false }).limit(100),
  );
  return (rows ?? []) as unknown as ShopOrder[];
}

/** The orders of the member's own shop (the dashboard), newest first. */
/**
 * S028 (Shops audit 11-12, dashboard CLS 0.63): the shop dashboard's OWN key for the full order rows. The nav badge's
 * one read (my_badge_reads, src/lib/badgeReads.ts) seeds ["shops", "shop-orders", uid] with SHORTER rows (no
 * fulfillment, delivery, deposit, digital, setup-fee or at_buyer columns) after the page's own reads; on the shared
 * key that overwrote the dashboard's cards (the delivery, deposit and payout lines vanished and the page jumped), and
 * within the 60 s staleTime a dashboard opened after Home showed the short rows with no read of its own. A child of
 * the old key, so every ["shops", "shop-orders"] / [..., uid] invalidation still refreshes it.
 */
export const shopDashboardOrdersKey = (uid: string | null) => ["shops", "shop-orders", uid, "full"] as const;

export async function fetchShopOrders(userId: string): Promise<ShopOrder[]> {
  const rows = unwrap(
    await supabase.from("shop_orders").select(ORDER_COLUMNS).eq("seller_id", userId)
      .not("status", "in", "(awaiting_hold,superseded)").order("created_at", { ascending: false }).limit(100),
  );
  return (rows ?? []) as unknown as ShopOrder[];
}

/**
 * Q2104: the buyer's first name for each of the shop's own orders (20261106170629). No entry for a pair that blocked
 * each other or a buyer who deleted their account; another shop's order is skipped by the server.
 */
export async function fetchShopOrderBuyerNames(orderIds: string[]): Promise<Record<string, string>> {
  if (orderIds.length === 0) return {};
  const rows = unwrap(await supabase.rpc("shops_my_order_buyer_names", { p_order_ids: orderIds.slice(0, 100) }));
  return Object.fromEntries((rows ?? []).map((r) => [r.order_id, r.first_name]));
}

/** The RPC's error with its plain-words copy (read at each call site) as userMessage. */
function rpcFail(error: { message: string }, words: string | null | undefined): never {
  throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
}

export async function fetchOrderTerms(shopId: string): Promise<OrderTerms> {
  const { data, error } = await supabase.rpc("shops_order_terms", { p_shop_id: shopId });
  if (error) rpcFail(error, rpcErrorMessage("shops_order_terms", error));
  return data as unknown as OrderTerms;
}

/** The cancel preset the member's own shop shows buyers (shops.cancel_policy, readable by column grant). */
export async function fetchCancelPolicy(shopId: string): Promise<CancelPolicy> {
  const row = unwrap(await supabase.from("shops").select("cancel_policy").eq("id", shopId).maybeSingle());
  return ((row as { cancel_policy?: CancelPolicy } | null)?.cancel_policy ?? "until_24h_before_ready");
}

export async function setCancelPolicy(policy: CancelPolicy): Promise<CancelPolicy> {
  const { data, error } = await supabase.rpc("shops_set_cancel_policy", { p_policy: policy });
  if (error) rpcFail(error, rpcErrorMessage("shops_set_cancel_policy", error));
  return data as CancelPolicy;
}

/** The member's own shop's ready-tap choice (shops.ready_tap_cancel, readable by column grant). */
export async function fetchReadyTapCancel(shopId: string): Promise<ReadyTapCancel> {
  const row = unwrap(await supabase.from("shops").select("ready_tap_cancel").eq("id", shopId).maybeSingle());
  return ((row as { ready_tap_cancel?: ReadyTapCancel } | null)?.ready_tap_cancel ?? "from_day_before");
}

/** Custom orders (20261106202917): whether buyers may ask this shop for something made to order, and how it is paid. */
export const CUSTOM_ORDER_MODES = ["off", "full_hold", "deposit_50"] as const;
export type CustomOrderMode = (typeof CUSTOM_ORDER_MODES)[number];
/**
 * What a shop can pick today. "Half up front" stays hidden while the server refuses it (deposit_not_ready, owner
 * 11-07 "Deposit orders stay off"; shops audit 11-08 #1). A shop already on it was moved to paid in full.
 */
export const PICKABLE_CUSTOM_ORDER_MODES: readonly CustomOrderMode[] = ["off", "full_hold"];
export const CUSTOM_ORDER_TEXT: Record<CustomOrderMode, { label: string; hint: string }> = {
  off: { label: "No custom orders", hint: "Buyers order only what you list." },
  full_hold: {
    label: "Custom orders, paid in full",
    hint: "Buyers can ask you for something made to order. When they order your price, their card is held, and it is charged in full when you accept.",
  },
  deposit_50: {
    label: "Custom orders, half up front",
    hint: "Buyers can ask you for something made to order. Half is charged when you accept and the rest on the ready date. If the rest doesn't go through, the buyer pays it before you hand the order over.",
  },
};

export async function fetchCustomOrders(shopId: string): Promise<CustomOrderMode> {
  const row = unwrap(await supabase.from("shops").select("custom_orders").eq("id", shopId).maybeSingle());
  const v = (row as { custom_orders?: string } | null)?.custom_orders;
  return (CUSTOM_ORDER_MODES as readonly string[]).includes(v ?? "") ? (v as CustomOrderMode) : "off";
}

/** Sets it for the caller's OWN shop only (shops_set_custom_orders: WHERE owner_id = the caller). */
export async function setCustomOrders(mode: CustomOrderMode): Promise<CustomOrderMode> {
  const { data, error } = await supabase.rpc("shops_set_custom_orders", { p_mode: mode });
  if (error) rpcFail(error, rpcErrorMessage("shops_set_custom_orders", error));
  return data as CustomOrderMode;
}

/** Sets it for the caller's OWN shop only (shops_set_ready_tap_cancel: WHERE owner_id = the caller). */
export async function setReadyTapCancel(choice: ReadyTapCancel): Promise<ReadyTapCancel> {
  const { data, error } = await supabase.rpc("shops_set_ready_tap_cancel", { p_choice: choice });
  if (error) rpcFail(error, rpcErrorMessage("shops_set_ready_tap_cancel", error));
  return data as ReadyTapCancel;
}

/**
 * shop-checkout's answer, or its refusal CODE as the error message. The
 * function answers `{ error: "<code>", hint }` on a refusal.
 */
async function invokeShopCheckout(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("shop-checkout", { body: { ...body, native: isNativePlatform } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const parsed: { error?: unknown } | null = ctx && typeof ctx.json === "function"
      ? await ctx.clone().json().catch((parseErr: unknown) => {
          // A body that is not JSON carries no code: the generic message.
          console.warn("[shops] shop-checkout error body was not JSON", parseErr);
          return null;
        })
      : null;
    const refusal = new Error(typeof parsed?.error === "string" && parsed.error ? parsed.error : "payment_unavailable");
    // The first order needs the ID check (20261105174853; shop-checkout answers 403 identity_required_to_buy).
    void openShopsIdentityCheckFor(refusal);
    throw refusal;
  }
  return (data ?? {}) as Record<string, unknown>;
}

/** shop-checkout's other actions (delivery.ts: the Helpr quote and the pickup point), with the same refusal codes. */
export const invokeShopCheckoutAction = invokeShopCheckout;

/** Ask for an order: the Stripe page's URL (a card HOLD; nothing is charged until the shop accepts). */
/** H8 (b): the buyer's service address as the order sheet sends it (Louisiana only; the server checks the same). */
export interface ServiceAddressInput { line1: string; city: string; postal_code: string }

/** The cancel terms the buyer read, as shop-checkout compares them (one copy for both order kinds). */
function termsSent(terms: Pick<OrderTerms, "cancel_policy" | "ready_tap_cancel">) {
  return { cancel_policy: terms.cancel_policy, ready_tap_cancel: terms.ready_tap_cancel ?? "from_day_before" };
}

export async function requestOrder(args: {
  shopId: string; lines: { item_id: string; variant_id?: string; quantity: number }[]; readyDate: string; note: string;
  /** The cancel terms the buyer read (shops_order_terms): shop-checkout answers terms_changed if the shop changed them since. */
  terms: Pick<OrderTerms, "cancel_policy" | "ready_tap_cancel">;
  /** H8 (b): where an at-home carpet or furniture cleaning is done (taxed there); sent only for such an order. */
  serviceAddress?: ServiceAddressInput | null;
  /** Shop delivers (20261106180902): the drop-off address; none for a pickup. */
  delivery?: { line1: string; line2?: string; city: string; postal_code: string } | null;
  /** Helpr delivery (slice 2): a Helpr delivers, at the price the buyer was shown (refused if it moved). */
  helprCents?: number | null;
}): Promise<string> {
  const data = await invokeShopCheckout({
    action: "order", shop_id: args.shopId, lines: args.lines, ready_date: args.readyDate, note: args.note,
    terms: termsSent(args.terms),
    ...(args.serviceAddress ? { service_address: args.serviceAddress } : {}),
    ...(args.delivery ? { delivery: args.delivery } : {}),
    ...(args.delivery && args.helprCents ? { delivery_by: "helpr", delivery_cents: args.helprCents } : {}),
  });
  if (typeof data.url !== "string" || !data.url) throw new Error("payment_unavailable");
  return data.url;
}

/**
 * Custom orders (20261106205852): the buyer orders the shop's price. No lines: shops_order_custom_quote freezes the one
 * line at the quoted price; the rest (terms check, tax, the Stripe page) is the ordinary order path. The ready date is
 * from tomorrow (CUSTOM_ORDER_LEAD_DAYS) to 90 days out, on an open, not full day; the server checks the same.
 */
export const CUSTOM_ORDER_LEAD_DAYS = 1;
export async function requestCustomOrder(args: {
  requestId: string; shopId: string; readyDate: string; note: string;
  terms: Pick<OrderTerms, "cancel_policy" | "ready_tap_cancel">;
}): Promise<string> {
  const data = await invokeShopCheckout({
    action: "order", shop_id: args.shopId, custom_request_id: args.requestId, ready_date: args.readyDate, note: args.note,
    terms: termsSent(args.terms),
  });
  if (typeof data.url !== "string" || !data.url) throw new Error("payment_unavailable");
  return data.url;
}

/** Custom orders (50% deposit): the shop's tap tries the rest on the saved card first. paid=false: the buyer must pay it. */
export async function chargeOrderRest(orderId: string): Promise<{ paid: boolean; waitingOnBuyer: boolean }> {
  const data = await invokeShopCheckout({ action: "charge_rest", order_id: orderId });
  return { paid: data.paid === true, waitingOnBuyer: data.waiting_on_buyer === true };
}

/**
 * Custom orders: the shop declines a request (or its own price), or the buyer withdraws theirs. Through shop-checkout
 * (close_request), never the RPC directly: it also closes the buyer's unpaid page for that price.
 */
export async function closeCustomRequest(requestId: string): Promise<void> {
  await invokeShopCheckout({ action: "close_request", request_id: requestId });
}

/** Custom orders (50% deposit): the buyer's page for the rest (the Stripe page's URL). */
export async function payOrderRest(orderId: string): Promise<string> {
  const data = await invokeShopCheckout({ action: "pay_balance", order_id: orderId });
  if (typeof data.url !== "string" || !data.url) throw new Error("payment_unavailable");
  return data.url;
}

/** The shop accepts: the hold is charged. charged=false means the charge finishes within minutes. */
export async function acceptOrder(orderId: string): Promise<{ charged: boolean }> {
  const data = await invokeShopCheckout({ action: "accept", order_id: orderId });
  return { charged: data.charged === true };
}

export async function declineOrder(orderId: string, reason: string): Promise<void> {
  await invokeShopCheckout({ action: "decline", order_id: orderId, reason: reason.trim() || null });
}

/** The buyer withdraws before the shop answers: the hold drops, nothing is kept. */
export async function cancelOrderRequest(orderId: string): Promise<void> {
  await invokeShopCheckout({ action: "cancel", order_id: orderId });
}

/** What a buyer's cancel of an accepted order would do now (shops_order_cancel_quote, 20261019071055). */
export interface CancelQuote {
  can_cancel: boolean;
  free?: boolean;
  free_until?: string | null;
  paid_cents?: number;
  refund_cents?: number;
  kept_cents?: number;
  /** The quote RPC is not on the server yet (PGRST202, deploy lag): no cancel is offered. */
  unavailable?: boolean;
}

export async function fetchCancelQuote(orderId: string): Promise<CancelQuote> {
  const { data, error } = await supabase.rpc("shops_order_cancel_quote", { p_order_id: orderId });
  // A brand-new RPC the database has not deployed yet (/code-review of shops-m3-v1 #8): say so, offer nothing.
  if (error && isMissingRpcNamed(error, "shops_order_cancel_quote")) return { can_cancel: false, unavailable: true };
  if (error) rpcFail(error, rpcErrorMessage("shops_order_cancel_quote", error));
  return (data ?? { can_cancel: false }) as unknown as CancelQuote;
}

/**
 * Shops M3: the buyer cancels an accepted order. `expect` is what the screen
 * showed ('free' or 'late'); if the window moved since, the server refuses
 * with cancel_terms_changed and nothing happens.
 */
export async function buyerCancelOrder(orderId: string, expect: "free" | "late"): Promise<{ refundCents: number }> {
  const data = await invokeShopCheckout({ action: "buyer_cancel", order_id: orderId, expect });
  return { refundCents: typeof data.refund_cents === "number" ? data.refund_cents : 0 };
}

/** Shops M3 (L42): the shop cancels an accepted order: the buyer gets everything back, the shop pays the card fee + a strike. */
export async function shopCancelOrder(orderId: string, reason: string): Promise<void> {
  await invokeShopCheckout({ action: "shop_cancel", order_id: orderId, reason: reason.trim() || null });
}

/** Shops M3 (O3): the buyer did not come to an in-person pickup: a late cancel (the shop is paid) + a buyer strike. */
export async function reportNoShow(orderId: string): Promise<void> {
  await invokeShopCheckout({ action: "no_show", order_id: orderId });
}

export type AdminRefundReason = "problem_shop_fault" | "problem_no_fault" | "problem_our_mistake" | "shop_removed";

/** Shops M4: an admin refunds an order by reason (the SQL decides who carries the card fee). */
export async function adminRefundOrder(orderId: string, reason: AdminRefundReason, note: string): Promise<void> {
  await invokeShopCheckout({ action: "admin_refund", order_id: orderId, reason, note: note.trim() });
}

/**
 * Shops M3 (/code-review of shops-m3-v1 #1, v2 rule B): an admin records a refund made by hand
 * in the Stripe Dashboard. shop-checkout reads it from Stripe and records it only when it is a
 * live refund on this order's payment for exactly this amount. Answers the outcome.
 */
export async function adminRecordHandRefund(orderId: string, refundId: string, amountCents: number, note: string): Promise<string> {
  const data = await invokeShopCheckout({ action: "admin_record_hand_refund", order_id: orderId, refund_id: refundId, amount_cents: amountCents, note });
  return typeof data.result === "string" ? data.result : "";
}

/**
 * Settle a HELD Shops refund with a refund made in Stripe (admin, Payouts held for review;
 * /code-review of shops-m3 run 3). shop-checkout reads the refund from Stripe and settles the
 * row only when it is live, on the row's payment, and covers the whole refund it owes.
 */
export async function adminSettleHeldShopRefund(refundRowId: string, refundId: string, note: string): Promise<string> {
  const data = await invokeShopCheckout({ action: "admin_settle_held_refund", refund_row_id: refundRowId, refund_id: refundId, note });
  return typeof data.result === "string" ? data.result : "";
}

/** F1 (owner 2026-10-18): 5% of the items, rounded, + 70 cents; the same rule as the order's table CHECK. */
export function buyerFeeCents(itemsCents: number): number {
  return Math.round(itemsCents * 0.05) + 70;
}

export { formatCents } from "./formatCents";

/** M3's endings of a charged order, in each side's words. */
const CLOSE_WORDS: Record<string, { buyer: string; shop: string }> = {
  buyer_cancelled_free: { buyer: "Cancelled by you (refunded, less a small card processing cost)", shop: "Cancelled by the buyer in your free-cancel time" },
  buyer_cancelled_late: { buyer: "Cancelled by you late (not refunded; the shop is paid)", shop: "Cancelled by the buyer late (you are paid)" },
  buyer_no_show: { buyer: "Missed pickup (not refunded; the shop is paid)", shop: "Buyer didn't show (you are paid)" },
  shop_cancelled: { buyer: "Cancelled by the shop (refunded in full)", shop: "Cancelled by you (buyer refunded in full)" },
  no_ready_photo: { buyer: "Refunded in full (the shop never marked it ready)", shop: "Refunded to the buyer (no ready photo)" },
  admin_refunded: { buyer: "Refunded by Louisiana Helpr", shop: "Refunded to the buyer by Louisiana Helpr" },
  // A refund Louisiana Helpr made by hand in Stripe (the shop is not paid until an admin decides).
  refunded_by_hand: { buyer: "Refunded by Louisiana Helpr", shop: "Refunded to the buyer by Louisiana Helpr" },
  // Preorders (20261108184654).
  preorder_cancelled: { buyer: "Preorder cancelled by you (refunded in full)", shop: "Preorder cancelled by the buyer" },
  preorder_date_moved: { buyer: "Preorder cancelled after the date moved (refunded in full)", shop: "Cancelled after you moved the date (buyer refunded in full)" },
  preorder_goal_missed: { buyer: "Preorder didn't reach its goal (refunded in full)", shop: "Goal not reached (buyer refunded in full)" },
  preorder_shop_late: { buyer: "Not ready in time (refunded in full)", shop: "Not marked ready in time (buyer refunded in full)" },
};

/** "Waiting for the shop", "Accepted", ... in the buyer's (or the shop's) words. */
export function orderStatusLabel(
  o: Pick<ShopOrder, "status" | "close_reason" | "captured_at"> & Partial<Pick<ShopOrder, "preorder_item_id">> & { is_digital?: boolean },
  side: "buyer" | "shop" = "buyer",
): string {
  const closed = o.close_reason ? CLOSE_WORDS[o.close_reason] : undefined;
  // Digital downloads (20261108185110): paid means delivered; nothing is picked up.
  if (o.is_digital && o.status === "accepted") {
    if (!o.captured_at) return side === "buyer" ? "Paid (finishing your payment)" : "Sold (the payment is going through)";
    return side === "buyer" ? "Paid. Ready to download" : "Sold. Paid out 72 hours after the sale";
  }
  if (o.is_digital && o.status === "handed_over") return side === "buyer" ? "Paid. Yours to keep" : "Sold and paid out";
  if (closed && o.status === "partially_refunded") {
    return side === "buyer" ? "Partly refunded by Louisiana Helpr" : "Partly refunded to the buyer by Louisiana Helpr";
  }
  if (closed && (o.status === "refunded" || o.status === "cancelled")) return closed[side];
  switch (o.status) {
    case "held": return "Waiting for the shop (card held, not charged)";
    case "accepted":
      if (o.preorder_item_id) return o.captured_at ? (side === "buyer" ? "Preorder, paid in full" : "Preorder, paid") : "Preorder (charging the card)";
      return o.captured_at ? "Accepted and paid" : "Accepted (charging your card)";
    case "declined": return "Declined (nothing charged)";
    // S031 (Shops audit 11-12): say why the order closed, not only "Closed".
    case "expired":
      if (o.close_reason === "no_answer") {
        return side === "buyer" ? "The shop didn't answer in time. Your card was never charged." : "Not answered in time (nothing charged)";
      }
      if (o.close_reason === "day_full") return "That day filled up (nothing charged)";
      if (o.close_reason === "amount_mismatch") return "The payment didn't go through (nothing charged)";
      return "Closed (nothing charged)";
    case "cancelled": return o.close_reason === "buyer_cancelled" ? "Withdrawn (nothing charged)" : "Cancelled (nothing charged)";
    case "handed_over": return "Picked up";
    case "refunded": return "Refunded";
    case "partially_refunded": return "Partly refunded";
    // Never listed (fetchMyOrders / fetchShopOrders leave them out); worded for completeness.
    case "awaiting_hold": return "Not sent (the payment page was not finished)";
    case "superseded": return "Replaced by a newer order";
    default: return assertNever(o.status, "shop order status");
  }
}

/** Hours and minutes left to answer, or null once the window has passed. */
export function timeLeftText(acceptBy: string | null, now: number = Date.now()): string | null {
  if (!acceptBy) return null;
  const ms = new Date(acceptBy).getTime() - now;
  if (!(ms > 0)) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} h ${m} min left to answer` : `${m} min left to answer`;
}

const DAY_MS = 86_400_000;
const isoToUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const utcToIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `YYYY-MM-DD` plus whole days (calendar days, no time zone drift). */
function addDaysIso(iso: string, days: number): string {
  return utcToIso(isoToUtc(iso) + days * DAY_MS);
}

/** The earliest ready date the server accepts (shops_request_order): the shop's today + the longest lead time chosen. */
export function earliestReadyDate(terms: Pick<OrderTerms, "today">, leadDays: number): string {
  return addDaysIso(terms.today, Math.max(0, leadDays));
}

/**
 * Why a ready date would be refused, in the server's order (ready_date_too_soon,
 * ready_date_too_far, shop_closed_that_day, day_full), or null when it is fine.
 * The calendar greys out every day this returns a reason for.
 */
export function readyDateProblem(
  iso: string,
  terms: Pick<OrderTerms, "today" | "last_day" | "open_weekdays" | "full_days">,
  leadDays: number,
): "too_soon" | "too_far" | "closed" | "full" | null {
  if (iso < earliestReadyDate(terms, leadDays)) return "too_soon";
  if (iso > terms.last_day) return "too_far";
  if (!terms.open_weekdays.includes(new Date(isoToUtc(iso)).getUTCDay())) return "closed";
  if (terms.full_days.includes(iso)) return "full";
  return null;
}

/** The first date the shop can fill this order on, or null when none in its window. */
export function firstOpenReadyDate(
  terms: Pick<OrderTerms, "today" | "last_day" | "open_weekdays" | "full_days">,
  leadDays: number,
): string | null {
  for (let d = earliestReadyDate(terms, leadDays); d <= terms.last_day; d = addDaysIso(d, 1)) {
    if (readyDateProblem(d, terms, leadDays) === null) return d;
  }
  return null;
}

/** Digital downloads (20261108185110): the Stripe page for one download, priced at the buyer's billing address. */
export async function requestDigitalPurchase(itemId: string, billing: { line1: string; city: string; state: string; postal_code: string }): Promise<string> {
  const data = await invokeShopCheckout({ action: "buy_digital", item_id: itemId, billing });
  const url = typeof data.url === "string" ? data.url : "";
  if (!url) throw new Error("payment_unavailable");
  return url;
}
