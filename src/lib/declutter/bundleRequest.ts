/**
 * Q2268 bundle requests (migration 20261104103528, Board 161): a buyer asks ONE seller for several items in one
 * ask; the seller answers Accept all, Pick some or Decline within 48 hours; each accepted item lands in the
 * buyer's cart like an accepted offer (24 hours to pay, owner BUY-1 10-31), so the existing one checkout / one
 * pickup / one fee carry it from there. Nothing is charged here.
 *
 * Reads go to the two tables (RLS: only the buyer and the seller of a request read it). Before the migration is
 * on the server, a missing table or RPC reads as null and the screens show nothing (never an error).
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { rpcData } from "@/lib/declutter/api";
import { rpcErrorMessage } from "@/lib/declutter/bundleErrors";

export type BundleRequestStatus = "open" | "answered" | "declined" | "expired" | "withdrawn";
export type BundleItemOutcome = "accepted" | "not_picked" | "unavailable" | null;

export interface BundleRequestItem {
  item_id: string;
  price_cents: number;
  outcome: BundleItemOutcome;
  title: string | null;
}

export interface BundleRequest {
  id: string;
  buyer_id: string;
  seller_id: string;
  status: BundleRequestStatus;
  respond_by: string;
  created_at: string;
  closed_at: string | null;
  items: BundleRequestItem[];
}

/** The fewest and most items one ask may hold (the server's bundle_size bound). */
export const BUNDLE_MIN_ITEMS = 2;
export const BUNDLE_MAX_ITEMS = 20;

type Row = Omit<BundleRequest, "items"> & {
  declutter_bundle_request_items: { item_id: string; price_cents: number; outcome: BundleItemOutcome; declutter_items: { title: string | null } | null }[] | null;
};

/** PostgREST before the tables exist: 42P01 (undefined table) or PGRST205 (not in the schema cache). */
function tableMissing(error: { code?: string } | null): boolean {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST200");
}

/**
 * The signed-in member's bundle requests on one side, newest first: as the seller only the open ones (what is
 * left to answer); as the buyer the last 7 days (so an answer, a no or an expiry is still told). Null before the
 * migration is on the server.
 */
export async function fetchBundleRequests(side: "buyer" | "seller", userId: string): Promise<BundleRequest[] | null> {
  let q = supabase
    .from("declutter_bundle_requests")
    .select("id,buyer_id,seller_id,status,respond_by,created_at,closed_at,declutter_bundle_request_items(item_id,price_cents,outcome,declutter_items(title))")
    .eq(side === "seller" ? "seller_id" : "buyer_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  q = side === "seller"
    ? q.eq("status", "open").gt("respond_by", new Date().toISOString())
    : q.gt("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
  const res = await q;
  if (tableMissing(res.error)) return null;
  const data = unwrap(res);
  return ((data ?? []) as unknown as Row[]).map(({ declutter_bundle_request_items: lines, ...r }) => ({
    ...r,
    items: (lines ?? [])
      .map((l) => ({ item_id: l.item_id, price_cents: l.price_cents, outcome: l.outcome, title: l.declutter_items?.title ?? null }))
      .sort((a, b) => b.price_cents - a.price_cents || a.item_id.localeCompare(b.item_id)),
  }));
}

/** The buyer's ask: 2 to 20 live items of one seller, at today's prices. Returns the request id. */
export async function requestBundle(itemIds: string[]): Promise<string> {
  return rpcData(
    await supabase.rpc("declutter_request_bundle", { p_item_ids: itemIds }),
    (e) => rpcErrorMessage("declutter_request_bundle", e),
  ) as string;
}

/**
 * The seller's answer: `null` = Accept all, a non-empty list = Pick some, `[]` = Decline.
 * Returns how many items went to the buyer's cart (an item sold meanwhile is never charged).
 */
export async function answerBundle(requestId: string, acceptItemIds: string[] | null): Promise<number> {
  return rpcData(
    await supabase.rpc("declutter_answer_bundle", { p_request_id: requestId, p_accept_item_ids: acceptItemIds }),
    (e) => rpcErrorMessage("declutter_answer_bundle", e),
  ) as number;
}

/** The buyer takes an open ask back. */
export async function withdrawBundle(requestId: string): Promise<void> {
  rpcData(await supabase.rpc("declutter_withdraw_bundle", { p_request_id: requestId }), (e) => rpcErrorMessage("declutter_withdraw_bundle", e));
}

/** True when the server does not have the ask yet (the button then says nothing and stays hidden). */
export function bundleAskMissing(error: unknown): boolean {
  return isMissingRpcNamed(error, "declutter_request_bundle");
}

/** "$12.00" total of the asked prices. */
export function bundleTotalCents(items: { price_cents: number }[]): number {
  return items.reduce((n, i) => n + i.price_cents, 0);
}

/** The buyer's status line for one request (both sides read the same facts; only the buyer reads closed ones). */
export function buyerStatusWords(r: BundleRequest): string {
  const n = r.items.length;
  const accepted = r.items.filter((i) => i.outcome === "accepted").length;
  const gone = r.items.filter((i) => i.outcome === "unavailable").length;
  switch (r.status) {
    case "open":
      return new Date(r.respond_by).getTime() <= Date.now()
        ? "The seller didn't answer in 48 hours. Nothing was charged."
        : `Waiting for the seller. They have until ${whenWords(r.respond_by)} to answer.`;
    case "answered":
      return `The seller accepted ${accepted} of ${n}${gone > 0 ? ` (${gone} sold meanwhile)` : ""}. They are in your cart: pay within 24 hours.`;
    case "declined":
      return gone > 0 && accepted === 0 && r.items.every((i) => i.outcome !== "not_picked")
        ? "These items are no longer available. Nothing was charged."
        : "The seller said no this time. Nothing was charged.";
    case "expired":
      return "The seller didn't answer in 48 hours. Nothing was charged.";
    case "withdrawn":
      return "You took this request back.";
  }
}

/** "Thu 3:15 PM", Louisiana time. */
export function whenWords(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}
