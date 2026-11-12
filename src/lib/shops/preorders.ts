/**
 * Shops preorders (migration 20261108184654_shops_preorders; owner 11-08). A shop sells an item before it is made:
 * the buyer pays in full at order, the shop sets a "ready by" date, and may set a goal (a number ordered by a date)
 * and a limit. Every rule is the server's (shops_set_item_preorder, shops_push_preorder_date, shops_item_preorders,
 * and shop-checkout's 'order' with preorder: true and 'preorder_cancel'); this file only calls them and words them.
 */
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { rpcErrorMessage } from "./rpcErrorCopy";
import { formatCents } from "./formatCents";
import { invokeShopCheckoutAction, setupFeeChargedCents, type OrderTerms, type ShopOrder } from "./orders";

/** The most days out a ready-by may be when it is set, and the one push (the SQL's limits). */
export const PREORDER_MAX_DAYS = 120;
export const PREORDER_MAX_PUSH_DAYS = 30;
/** The shop's ready tap counts from this many days before ready-by (shop_handovers_preorder_ready_guard). */
const PREORDER_READY_TAP_DAYS = 14;
/** Days after ready-by before an order not marked ready is refunded automatically (shop_preorder_sweep). */
export const PREORDER_LATE_DAYS = 7;

/** One item's preorder as the product page and the shop's settings read it (shops_item_preorders). */
export interface ItemPreorder {
  item_id: string;
  ready_by: string;
  goal: number | null;
  goal_by: string | null;
  cap: number | null;
  /** Paid units (the goal counts items, not orders). */
  ordered: number;
  goal_met: boolean;
  goal_missed: boolean;
  moved: boolean;
  open: boolean;
}

function rpcFail(error: { message: string }, words: string | null | undefined): never {
  throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
}

/**
 * Each preorder item of a shop, by item id. A database that has not deployed the RPC yet (PGRST202) has no preorders:
 * an empty map, never an error the shop page has to show.
 */
export async function fetchItemPreorders(shopId: string): Promise<Map<string, ItemPreorder>> {
  const { data, error } = await supabase.rpc("shops_item_preorders", { p_shop_id: shopId });
  if (error && isMissingRpcNamed(error, "shops_item_preorders")) return new Map();
  if (error) rpcFail(error, rpcErrorMessage("shops_item_preorders", error));
  return new Map(((data ?? []) as unknown as ItemPreorder[]).map((p) => [p.item_id, p]));
}

export interface PreorderSettings {
  readyBy: string;
  goal: number | null;
  goalBy: string | null;
  cap: number | null;
}

/** The shop turns a preorder on (settings) or off (null). Refused while the item has open preorders. */
export async function setItemPreorder(itemId: string, s: PreorderSettings | null): Promise<void> {
  const { error } = await supabase.rpc("shops_set_item_preorder", {
    p_item_id: itemId,
    // The generated types say string/number; NULL (off, no goal, no limit) is what the RPC takes.
    p_ready_by: (s?.readyBy ?? null) as string,
    p_goal: (s?.goal ?? null) as number,
    p_goal_by: (s?.goalBy ?? null) as string,
    p_cap: (s?.cap ?? null) as number,
  });
  if (error) rpcFail(error, rpcErrorMessage("shops_set_item_preorder", error));
}

/** The shop moves ready-by later ONCE (at most 30 days); every buyer is told and may cancel for a full refund. */
export async function pushPreorderDate(itemId: string, newReadyBy: string): Promise<number> {
  const { data, error } = await supabase.rpc("shops_push_preorder_date", { p_item_id: itemId, p_new_ready_by: newReadyBy });
  if (error) rpcFail(error, rpcErrorMessage("shops_push_preorder_date", error));
  const orders = (data as { orders?: unknown } | null)?.orders;
  return typeof orders === "number" ? orders : 0;
}

/** The buyer preorders ONE item: the Stripe page's URL (charged in full when it is paid). Pickup only in v1. */
export async function requestPreorder(args: {
  shopId: string; itemId: string; quantity: number; readyBy: string; note: string;
  terms: Pick<OrderTerms, "cancel_policy" | "ready_tap_cancel">;
}): Promise<string> {
  const data = await invokeShopCheckoutAction({
    action: "order", preorder: true, shop_id: args.shopId, lines: [{ item_id: args.itemId, quantity: args.quantity }],
    ready_date: args.readyBy, note: args.note,
    terms: { cancel_policy: args.terms.cancel_policy, ready_tap_cancel: args.terms.ready_tap_cancel ?? "from_day_before" },
  });
  if (typeof data.url !== "string" || !data.url) throw new Error("payment_unavailable");
  return data.url;
}

/** The buyer cancels a paid preorder before the shop marks it ready. Answers what comes back, in cents. */
export async function cancelPreorder(orderId: string): Promise<{ refundCents: number | null }> {
  const data = await invokeShopCheckoutAction({ action: "preorder_cancel", order_id: orderId });
  return { refundCents: typeof data.refund_cents === "number" ? data.refund_cents : null };
}

const DAY_MS = 86_400_000;
const isoToUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** `YYYY-MM-DD` plus whole calendar days. */
export function addDays(iso: string, days: number): string {
  return new Date(isoToUtc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** "Dec 1" for a calendar date (no time zone drift). */
export function shortDate(iso: string): string {
  return new Date(isoToUtc(iso)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Preorder · ready by Dec 15". */
export function preorderLabel(p: Pick<ItemPreorder, "ready_by">): string {
  return `Preorder · ready by ${shortDate(p.ready_by)}`;
}

/** "12 of 20 ordered · ends Dec 1", "Goal reached: 20 ordered", or null without a goal. */
export function goalProgressText(p: Pick<ItemPreorder, "goal" | "goal_by" | "ordered" | "goal_met" | "goal_missed">): string | null {
  if (p.goal == null || p.goal_by == null) return null;
  if (p.goal_missed) return `Didn't reach ${p.goal} by ${shortDate(p.goal_by)}. Everyone was refunded.`;
  if (p.goal_met) return `Goal reached: ${p.ordered} ordered`;
  return `${p.ordered} of ${p.goal} ordered · ends ${shortDate(p.goal_by)}`;
}

/** Where a preorder stands for a buyer who has not ordered it, when it can't be ordered: closed, full, or missed. */
export function preorderClosedText(p: ItemPreorder): string | null {
  if (p.open) return null;
  if (p.goal_missed) return "This preorder didn't reach its goal.";
  if (p.cap != null && p.ordered >= p.cap) return "This preorder is full.";
  return "This preorder is closed.";
}

/** The plain charge and refund words the product page shows before the buyer pays. */
export function preorderChargeText(p: Pick<ItemPreorder, "ready_by" | "goal" | "goal_by" | "goal_met">): string[] {
  const words = ["You're charged now, in full."];
  if (p.goal != null && p.goal_by != null && !p.goal_met) {
    words.push(`If it doesn't reach ${p.goal} by ${shortDate(p.goal_by)}, you get a full refund automatically.`);
  }
  words.push(`If the shop doesn't have it ready by ${shortDate(addDays(p.ready_by, PREORDER_LATE_DAYS))}, you get a full refund automatically.`);
  // S2-019 (owner-approved preorder rule): a buyer cancel before ready is a full refund; the shop carries the card cost.
  words.push("You can cancel until the shop marks it ready, for a full refund.");
  return words;
}

/** The buyer's order: what Cancel preorder gives back now (the server files the refund; this says the same).
 * S2-019 (20261112220952, owner-approved): every preorder cancel before ready is a full refund, the one-time setup
 * fee the charge carried included (shop_write_refund's full_shop_pays_fee rule). */
export function preorderCancelText(
  order: { total_cents: number; ready_date: string; preorder_moved_at?: string | null } & Partial<Pick<ShopOrder, "setup_fee_cents" | "setup_fee_state">>,
  _today: string,
): string {
  const back = order.total_cents + setupFeeChargedCents({ setup_fee_cents: order.setup_fee_cents ?? 0, setup_fee_state: order.setup_fee_state ?? null } as Pick<ShopOrder, "setup_fee_cents" | "setup_fee_state">);
  return `You get everything you paid back: ${formatCents(back)}. The shop is told.`;
}

/** The first day the shop may mark a preorder ready (ready-by - 14), for "You can mark it ready from Dec 1". */
export function preorderReadyFrom(readyDate: string): string {
  return addDays(readyDate, -PREORDER_READY_TAP_DAYS);
}

/** Today in Louisiana as `YYYY-MM-DD` (preorder dates are Louisiana calendar dates). */
export function louisianaToday(now: number = Date.now()): string {
  return new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}
