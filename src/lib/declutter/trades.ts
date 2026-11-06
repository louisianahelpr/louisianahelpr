/**
 * Declutter trades (owner 10-31, OWNER-DECISIONS "Declutter trades"; server 20261106163703): a buyer offers ONE of
 * their own live listings for a seller's listing; the seller accepts or declines. Item for item, free. In the code it
 * is a "swap" (declutter_swap_offers) so it is never confused with the trade_* names that mean a sale; members read
 * "trade".
 *
 * The one client helper for it. Every RPC refusal is thrown with RPC_ERROR_COPY's words on `userMessage` (api.ts
 * rpcData), never dropped. Until 20261106163703 is on prod (42703 / PGRST202 / PGRST204), reads answer "not open to
 * trades" and the switch says it can't be saved yet.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcData } from "@/lib/declutter/api";
import { rpcErrorMessage } from "@/lib/declutter/tradeErrors";

export const TRADES_TITLE = "Open to trades";

/** What "Open to trades" means, on or off (Settings and Manage listing say it the same way). */
export const tradesSettingLine = (on: boolean) =>
  on ? "Buyers can offer one of their listings in trade. No money changes hands." : "Off. Buyers can't offer a trade.";

/** The column or RPC is not on this database yet. */
const notDeployed = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42703" || e.code === "PGRST202" || e.code === "PGRST204") && /trade|swap/.test(e.message ?? "");

/** Whether one listing is open to trades (false before the column is live). */
export async function fetchAcceptsTrades(itemId: string): Promise<boolean> {
  const res = await supabase.from("declutter_items").select("accepts_trades").eq("id", itemId).maybeSingle();
  if (notDeployed(res.error)) return false;
  const row = unwrap(res) as { accepts_trades?: boolean } | null;
  return row?.accepts_trades === true;
}

/** The seller's own listing (draft, live or paused; never a free one): on or off. Off closes its open trade offers. */
export async function setTradeRules(itemId: string, on: boolean): Promise<void> {
  rpcData(
    await supabase.rpc("declutter_set_trade_rules", { p_item_id: itemId, p_accepts_trades: on }),
    (e) => rpcErrorMessage("declutter_set_trade_rules", e),
  );
}

/** The buyer offers their own live listing `offeredItemId` for `itemId`. Returns the trade offer's id. */
export async function offerSwap(itemId: string, offeredItemId: string): Promise<string> {
  return rpcData(
    await supabase.rpc("declutter_offer_swap", { p_item_id: itemId, p_offered_item_id: offeredItemId }),
    (e) => rpcErrorMessage("declutter_offer_swap", e),
  ) as string;
}

/** Which of the member's listings they can offer: live and priced (a free item is claimed, never traded). */
export function tradeableListings<T extends { id: string; status: string; current_price_cents: number }>(
  mine: readonly T[],
  excludeId?: string,
): T[] {
  return mine.filter((it) => it.status === "live" && it.current_price_cents > 0 && it.id !== excludeId);
}

export type SwapAction = "accept" | "decline" | "withdraw";

/** The seller accepts or declines; the buyer takes it back. Returns the new status. */
export async function respondSwap(swapId: string, action: SwapAction): Promise<string> {
  return rpcData(
    await supabase.rpc("declutter_respond_swap", { p_swap_id: swapId, p_action: action }),
    (e) => rpcErrorMessage("declutter_respond_swap", e),
  ) as string;
}

type TradeItem = { id: string; title: string; current_price_cents: number };
type TradeLine = { status: string } | null;

/** One trade offer as a side reads it (RLS: the two sides read their own rows). */
export interface MyTrade {
  id: string;
  status: "open" | "accepted" | "declined" | "expired" | "withdrawn" | "voided" | "lapsed" | "completed";
  respond_by: string;
  created_at: string;
  my_side: "buyer" | "seller";
  /** The seller's listing. */
  item: TradeItem | null;
  /** The buyer's listing offered for it. */
  offered: TradeItem | null;
  /** Once accepted: this member's own $0 line for the item they get ('in_cart' until they check out, then 'paid'). */
  my_line_status: string | null;
}

const TRADE_COLUMNS =
  "id, status, respond_by, created_at, item:declutter_items!declutter_swap_offers_item_id_fkey(id, title, current_price_cents), offered:declutter_items!declutter_swap_offers_offered_item_id_fkey(id, title, current_price_cents), buyer_line:declutter_cart_items!declutter_swap_offers_buyer_line_id_fkey(status), seller_line:declutter_cart_items!declutter_swap_offers_seller_line_id_fkey(status)";

type TradeRow = Omit<MyTrade, "my_side" | "my_line_status"> & { buyer_line: TradeLine; seller_line: TradeLine };

/**
 * Selling (side "seller"): the open trade offers to answer and the accepted ones. Buying (side "buyer"): the member's
 * trade offers from the last 7 days, whatever became of them. Before 20261106163703 is on prod: none.
 */
export async function fetchMyTrades(side: "buyer" | "seller", userId: string): Promise<MyTrade[]> {
  const base = supabase.from("declutter_swap_offers").select(TRADE_COLUMNS).eq(side === "seller" ? "seller_id" : "buyer_id", userId);
  const res = side === "seller"
    ? await base.in("status", ["open", "accepted"]).order("created_at", { ascending: false }).limit(50)
    : await base.gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(50);
  if (res.error && (res.error.code === "PGRST205" || res.error.code === "PGRST200" || res.error.code === "42P01")) return [];
  const rows = (unwrap(res) ?? []) as unknown as TradeRow[];
  return rows.map(({ buyer_line, seller_line, ...r }) => ({
    ...r,
    my_side: side,
    my_line_status: (side === "seller" ? seller_line : buyer_line)?.status ?? null,
  }));
}

/** What became of a closed trade offer, in one line. */
export function tradeStatusWords(t: Pick<MyTrade, "status" | "my_side">): string {
  switch (t.status) {
    case "accepted": return "Accepted. Each of you picks up the other's item, free.";
    case "completed": return "Done. You both have your items.";
    case "declined": return "Declined. Nothing changed hands.";
    case "expired": return t.my_side === "buyer" ? "The seller didn't answer in 48 hours." : "You didn't answer in 48 hours.";
    case "withdrawn": return "Taken back.";
    case "voided": return "Closed: one of the items is no longer available.";
    case "lapsed": return "Ended: the trade didn't finish, so it closed. Nothing was charged.";
    default: return "";
  }
}
