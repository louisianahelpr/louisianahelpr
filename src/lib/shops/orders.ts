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
import { rpcErrorMessage } from "./rpcErrorCopy";

export type CancelPolicy = "until_24h_before_ready" | "until_accept" | "until_handover";

/** The three presets a shop picks from (O2), in the words a buyer reads before paying. */
export const CANCEL_POLICY_TEXT: Record<CancelPolicy, { label: string; detail: string }> = {
  until_24h_before_ready: {
    label: "Free to cancel until 24 hours before the ready date",
    detail: "After the shop accepts, you can cancel for a refund of the price until 24 hours before the ready date. The card fee is not refunded.",
  },
  until_accept: {
    label: "Free to cancel until the shop accepts",
    detail: "Once the shop accepts, the order is final.",
  },
  // Owner 2026-10-18 ~22:30Z (Q2155): free cancel closes when the ready date begins or when the shop
  // marks the order ready, whichever is first, never at pickup (shop_order_free_cancel_until, 20261018211820).
  until_handover: {
    label: "Free to cancel until your order is ready",
    detail: "After the shop accepts, you can cancel for a refund of the price until your ready date begins, or until the shop marks your order ready if that comes first. The card fee is not refunded.",
  },
};
export const CANCEL_POLICIES = Object.keys(CANCEL_POLICY_TEXT) as CancelPolicy[];

type OrderStatus =
  | "awaiting_hold" | "held" | "accepted" | "declined" | "expired" | "cancelled" | "superseded" | "handed_over" | "refunded";

interface OrderLine {
  id: string;
  item_id: string | null;
  title: string;
  kind: string;
  unit_cents: number;
  quantity: number;
  line_cents: number;
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
  handed_over_at: string | null;
  shop_order_lines: OrderLine[];
  /** The shop's name (buyer list only); null once the shop is gone or hidden from the buyer. */
  shops?: { name: string } | null;
}

export interface OrderTerms {
  cancel_policy: CancelPolicy;
  paused: boolean;
  open_weekdays: number[];
  daily_order_cap: number | null;
  today: string;
  last_day: string;
  full_days: string[];
}

const ORDER_COLUMNS =
  "id, buyer_id, seller_id, shop_id, status, close_reason, ready_date, cancel_policy, note, decline_reason, items_cents, " +
  "premium_cents, tax_cents, total_cents, created_at, held_at, accept_by, accepted_at, captured_at, closed_at, handover_mode, handed_over_at, " +
  "shop_order_lines (id, item_id, title, kind, unit_cents, quantity, line_cents)";

/** The member's orders as a buyer (newest first); a page that was never paid is not an order to show. */
export async function fetchMyOrders(userId: string): Promise<ShopOrder[]> {
  const rows = unwrap(
    await supabase.from("shop_orders").select(`${ORDER_COLUMNS}, shops (name)`).eq("buyer_id", userId)
      .not("status", "in", "(awaiting_hold,superseded)").order("created_at", { ascending: false }).limit(100),
  );
  return (rows ?? []) as unknown as ShopOrder[];
}

/** The orders of the member's own shop (the dashboard), newest first. */
export async function fetchShopOrders(userId: string): Promise<ShopOrder[]> {
  const rows = unwrap(
    await supabase.from("shop_orders").select(ORDER_COLUMNS).eq("seller_id", userId)
      .not("status", "in", "(awaiting_hold,superseded)").order("created_at", { ascending: false }).limit(100),
  );
  return (rows ?? []) as unknown as ShopOrder[];
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
    throw new Error(typeof parsed?.error === "string" && parsed.error ? parsed.error : "payment_unavailable");
  }
  return (data ?? {}) as Record<string, unknown>;
}

/** Ask for an order: the Stripe page's URL (a card HOLD; nothing is charged until the shop accepts). */
export async function requestOrder(args: {
  shopId: string; lines: { item_id: string; quantity: number }[]; readyDate: string; note: string;
}): Promise<string> {
  const data = await invokeShopCheckout({
    action: "order", shop_id: args.shopId, lines: args.lines, ready_date: args.readyDate, note: args.note,
  });
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

/** F1 (owner 2026-10-18): 5% of the items, rounded, + 70 cents; the same rule as the order's table CHECK. */
export function buyerFeeCents(itemsCents: number): number {
  return Math.round(itemsCents * 0.05) + 70;
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "Waiting for the shop", "Accepted", ... in the buyer's words. */
export function orderStatusLabel(o: Pick<ShopOrder, "status" | "close_reason" | "captured_at">): string {
  switch (o.status) {
    case "held": return "Waiting for the shop (card held, not charged)";
    case "accepted": return o.captured_at ? "Accepted and paid" : "Accepted (charging your card)";
    case "declined": return "Declined (nothing charged)";
    case "expired": return o.close_reason === "no_answer" ? "Not answered in time (nothing charged)" : "Closed (nothing charged)";
    case "cancelled": return o.close_reason === "buyer_cancelled" ? "Withdrawn (nothing charged)" : "Cancelled (nothing charged)";
    case "handed_over": return "Picked up";
    case "refunded": return "Refunded";
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
