/**
 * Declutter manager mode (owner 11-01, "Manage my Declutter for me"). A seller asks one person, by a private direct
 * offer, to handle the parts she picks (listing, prices, offers, messages, pickups) for a share of each sale (a
 * percent of the item price, or a flat amount per sold item). The person accepts or declines; either side can end
 * it, and the seller can change the parts later. The manager then acts AS the seller's listings through ONE RPC,
 * declutter_manage(p_seller, p_action, p_args), which checks the part is on and the target is the seller's selling
 * side, then runs the seller's own RPC. Server rules: migration 20261101181005_declutter_manager_mode.sql.
 */
import type { Json } from "@/integrations/supabase/types";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useFeature } from "@/hooks/useFeature";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { rpcData } from "./api";

export type ManagerPart = "list" | "prices" | "offers" | "messages" | "pickups";
export type ShareType = "percent" | "flat";

export interface ManagerParts {
  list: boolean;
  prices: boolean;
  offers: boolean;
  messages: boolean;
  pickups: boolean;
}

/** One grant, from either side. */
export interface ManagerGrant {
  id: string;
  role: "seller" | "manager";
  seller_id: string;
  manager_id: string;
  seller_first_name: string;
  manager_first_name: string;
  status: "offered" | "active" | "declined" | "withdrawn" | "ended";
  share_type: ShareType;
  share_pct: number | null;
  share_cents: number | null;
  can_list: boolean;
  can_prices: boolean;
  can_offers: boolean;
  can_messages: boolean;
  can_pickups: boolean;
  created_at: string;
  responded_at: string | null;
  ended_at: string | null;
}

/** The checklist's words, in the order the offer screen shows them. */
export const MANAGER_PART_LABELS: Record<ManagerPart, string> = {
  list: "Listing (create, edit, post)",
  prices: "Prices",
  offers: "Offers",
  messages: "Messages",
  pickups: "Pickups",
};

/** The parts a grant has on. */
export function grantParts(g: ManagerGrant): ManagerParts {
  return { list: g.can_list, prices: g.can_prices, offers: g.can_offers, messages: g.can_messages, pickups: g.can_pickups };
}

/** "20% of each sale" / "$5 per item sold". */
export function shareWords(g: Pick<ManagerGrant, "share_type" | "share_pct" | "share_cents">): string {
  if (g.share_type === "percent") return `${g.share_pct ?? 0}% of each sale`;
  const cents = g.share_cents ?? 0;
  const dollars = cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
  return `$${dollars} per item sold`;
}

export async function fetchMyManagerGrants(): Promise<ManagerGrant[]> {
  const rows = rpcData(await supabase.rpc("declutter_my_manager_grants"),
    (e) => rpcErrorMessage("declutter_my_manager_grants", e));
  return (rows ?? []) as ManagerGrant[];
}

/** Both sides' grants, newest open first. Empty while the switch is off. */
export function useMyManagerGrants() {
  const on = useFeature("declutter_manager");
  return useQuery({
    queryKey: ["declutter-manager-grants"],
    queryFn: fetchMyManagerGrants,
    enabled: on,
  });
}

/** The seller's private offer. `shareValue` is a whole percent, or cents for a flat share. */
export async function offerToManage(managerId: string, shareType: ShareType, shareValue: number, parts: ManagerParts): Promise<string> {
  return rpcData(await supabase.rpc("declutter_manager_offer", {
    p_manager: managerId, p_share_type: shareType, p_share_value: shareValue,
    p_can_list: parts.list, p_can_prices: parts.prices, p_can_offers: parts.offers,
    p_can_messages: parts.messages, p_can_pickups: parts.pickups,
  }), (e) => rpcErrorMessage("declutter_manager_offer", e)) as string;
}

export async function answerManageOffer(grantId: string, accept: boolean): Promise<"active" | "declined"> {
  return rpcData(await supabase.rpc("declutter_manager_respond", { p_grant_id: grantId, p_accept: accept }),
    (e) => rpcErrorMessage("declutter_manager_respond", e)) as "active" | "declined";
}

/** The seller OKs a draft her manager sent: she attests here and it posts as hers (owner 11-01). */
export async function approveManagerDraft(itemId: string, attest: { personalUse: boolean; notBusiness: boolean; notFrequent: boolean; keepsItem: boolean }): Promise<unknown> {
  return rpcData(await supabase.rpc("declutter_manager_approve", {
    p_item_id: itemId, p_bought_for_personal_use: attest.personalUse, p_not_in_the_business: attest.notBusiness,
    p_not_a_frequent_seller: attest.notFrequent, p_keeps_item_until_handover: attest.keepsItem,
  }), (e) => rpcErrorMessage("declutter_manager_approve", e));
}

/** One draft the seller's manager sent for her OK (declutter_manager_submissions, status waiting). */
export interface WaitingDraft {
  item_id: string;
  title: string;
  price_cents: number;
  submitted_at: string;
}

/** The seller's "Waiting for your OK" list: her own waiting submissions (RLS: the two people read), oldest first. */
export async function fetchWaitingDrafts(sellerId: string): Promise<WaitingDraft[]> {
  const subs = await supabase.from("declutter_manager_submissions").select("item_id, submitted_at")
    .eq("seller_id", sellerId).eq("status", "waiting").order("submitted_at", { ascending: true });
  if (subs.error) throw subs.error;
  const rows = (subs.data ?? []) as { item_id: string; submitted_at: string }[];
  if (rows.length === 0) return [];
  const items = await supabase.from("declutter_items").select("id, title, price_cents").in("id", rows.map((r) => r.item_id));
  if (items.error) throw items.error;
  const byId = new Map(((items.data ?? []) as { id: string; title: string; price_cents: number }[]).map((i) => [i.id, i]));
  return rows.flatMap((r) => {
    const i = byId.get(r.item_id);
    return i ? [{ item_id: r.item_id, title: i.title, price_cents: i.price_cents, submitted_at: r.submitted_at }] : [];
  });
}

/** The seller sends a draft back to her manager with a note. */
export async function sendManagerDraftBack(itemId: string, note: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_manager_send_back", { p_item_id: itemId, p_note: note }),
    (e) => rpcErrorMessage("declutter_manager_send_back", e)) as string;
}

export async function endManaging(grantId: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_manager_end", { p_grant_id: grantId }),
    (e) => rpcErrorMessage("declutter_manager_end", e)) as string;
}

export async function setManagerParts(grantId: string, parts: ManagerParts): Promise<void> {
  rpcData(await supabase.rpc("declutter_manager_set_permissions", {
    p_grant_id: grantId, p_can_list: parts.list, p_can_prices: parts.prices, p_can_offers: parts.offers,
    p_can_messages: parts.messages, p_can_pickups: parts.pickups,
  }), (e) => rpcErrorMessage("declutter_manager_set_permissions", e));
}

/** The actions declutter_manage accepts (the server's fixed list). */
export type ManageAction =
  | "create_item" | "update_draft" | "add_item_photo" | "remove_item_photo" | "submit_for_approval"
  | "edit_listing" | "set_handovers" | "pause_listing" | "withdraw_item"
  | "set_listing_price" | "set_listing_drops"
  | "respond_offer" | "set_offer_rules"
  | "answer_question" | "send_order_message" | "order_talk_view"
  | "set_pickup_windows" | "confirm_handover";

/** One action for the seller. Returns the seller RPC's own result. */
export async function manageForSeller(sellerId: string, action: ManageAction, args: Record<string, unknown>): Promise<unknown> {
  const out = rpcData(await supabase.rpc("declutter_manage", { p_seller: sellerId, p_action: action, p_args: args as Json }),
    (e) => rpcErrorMessage("declutter_manage", e)) as { result?: unknown } | null;
  return out?.result ?? null;
}

/** "Lexi (helping Kaci)" for messages a manager wrote, by message id. */
export async function fetchManagerLabels(kind: "answer" | "order_talk", ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.rpc("declutter_manager_message_labels", { p_kind: kind, p_ids: ids });
  if (error) throw error;
  return new Map(((data ?? []) as { message_id: string; label: string }[]).map((r) => [r.message_id, r.label]));
}

/**
 * "Dana (helping Kaci)" for each of these answers (question ids) or order-chat messages a manager wrote, read only
 * while the switch is on for the viewer (no request otherwise). A failed read leaves the labels off: the message
 * still shows, under the seller's name as before.
 */
export function useManagerLabels(kind: "answer" | "order_talk", ids: string[]) {
  const on = useFeature("declutter_manager");
  const sorted = [...ids].sort();
  return useQuery({
    queryKey: ["declutter-manager-labels", kind, sorted],
    queryFn: () => fetchManagerLabels(kind, sorted),
    enabled: on && sorted.length > 0,
    staleTime: 60_000,
  });
}

/** What the manager sees of the seller (only the parts she turned on are filled). */
export interface ManagedOverview {
  grant_id: string;
  seller_first_name: string;
  parts: ManagerParts;
  items: { id: string; title: string; status: string; price_cents: number; updated_at: string; photo_path: string | null }[];
  offers: { id: string; item_id: string; amount_cents: number; awaiting: "seller" | "buyer"; respond_by: string; buyer_first_name: string }[];
  questions: { id: string; item_id: string; question: string; answer: string | null; answered_at: string | null; created_at: string }[];
  orders: { id: string; status: string; handover: string; items_cents: number; paid_at: string | null; closed_at: string | null; buyer_first_name: string }[];
}

export async function fetchManagedOverview(sellerId: string): Promise<ManagedOverview> {
  return rpcData(await supabase.rpc("declutter_managed_overview", { p_seller: sellerId }),
    (e) => rpcErrorMessage("declutter_managed_overview", e)) as unknown as ManagedOverview;
}

/** One member the seller can ask (search_profiles_by_name: signed in, rate-limited, banned and hidden test accounts left out). */
export interface MemberHit {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
}

/** Members by name for the seller's grant setup. Under 2 letters asks nothing. */
export async function searchMembers(query: string): Promise<MemberHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = rpcData(await supabase.rpc("search_profiles_by_name", { query: q }),
    (e) => rpcErrorMessage("search_profiles_by_name", e));
  return (rows ?? []) as MemberHit[];
}

/**
 * The split of one sale, exactly as the server locks it at paid (20261101230509): a percent share is rounded DOWN
 * to the cent; a flat share is capped at the item money. The seller keeps the rest.
 */
export function splitOf(itemsCents: number, share: { type: ShareType; value: number }): { manager: number; seller: number } {
  const items = Math.max(0, Math.floor(itemsCents));
  const raw = share.type === "percent" ? Math.floor((items * Math.max(0, Math.min(100, share.value))) / 100) : Math.max(0, share.value);
  const manager = Math.min(raw, items);
  return { manager, seller: items - manager };
}

/** "$40 sale · $8 to Dana · $32 to you". */
export function splitWords(itemsCents: number, managerCents: number, managerName: string): string {
  const d = (c: number) => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);
  return `${d(itemsCents)} sale · ${d(managerCents)} to ${managerName} · ${d(itemsCents - managerCents)} to you`;
}

/** One sale's manager share, from either side (RLS: the seller and the manager read). */
export interface OrderManagerShare {
  order_id: string;
  seller_id: string | null;
  manager_id: string | null;
  share_type: ShareType;
  share_pct: number | null;
  share_cents: number | null;
  /** The manager's payout row, once the sale is paid out: what was actually sent (after any refund). */
  paid_cents: number | null;
  payout_status: "pending" | "succeeded" | "failed" | "nothing_due" | null;
}

/** Every sale share the caller is a party to: the terms locked at paid, plus the manager payout once it exists. */
export async function fetchOrderManagerShares(): Promise<OrderManagerShare[]> {
  const shares = await supabase.from("declutter_order_manager_shares")
    .select("order_id, seller_id, manager_id, share_type, share_pct, share_cents");
  if (shares.error) throw shares.error;
  const pays = await supabase.from("declutter_manager_payouts").select("order_id, amount_cents, status");
  if (pays.error) throw pays.error;
  const byOrder = new Map(((pays.data ?? []) as { order_id: string; amount_cents: number; status: OrderManagerShare["payout_status"] }[])
    .map((p) => [p.order_id, p]));
  return ((shares.data ?? []) as Omit<OrderManagerShare, "paid_cents" | "payout_status">[]).map((s) => {
    const p = byOrder.get(s.order_id);
    return { ...s, paid_cents: p ? p.amount_cents : null, payout_status: p ? p.status : null };
  });
}

/** The caller's sale shares; no request while the switch is off. */
export function useOrderManagerShares() {
  const on = useFeature("declutter_manager");
  return useQuery({ queryKey: ["declutter-manager-shares"], queryFn: fetchOrderManagerShares, enabled: on, staleTime: 60_000 });
}

/** The manager's cents of one sale: the payout once it exists, else the locked terms over these items. */
export function shareCentsOf(s: OrderManagerShare, itemsCents: number, itemCount: number): number {
  if (s.paid_cents != null) return s.paid_cents;
  if (s.share_type === "percent") return splitOf(itemsCents, { type: "percent", value: s.share_pct ?? 0 }).manager;
  return splitOf(itemsCents, { type: "flat", value: (s.share_cents ?? 0) * Math.max(1, itemCount) }).manager;
}
