/**
 * The Declutter handover chat (owner 2026-10-28, Q2462 / issue #3730: "let them chat to figure it out"; migration
 * 20261028235249_declutter_handover_talk). When none of the ways the seller ticked works for a buyer, either of the
 * two opens a private chat; the buyer's checkout time waits for it (72 hours), the seller may add a way, and a sale
 * that runs out after it ends with no strike for anyone.
 *
 * The server is the protection: only the buyer and seller read a talk and its messages (RLS), nobody writes the
 * tables directly, and every message goes through declutter_send_handover_message, which runs the contact-leak filter
 * (a phone number, email or payment handle is refused with words the member reads), the rate limit and the notice.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { rpcData, type SellerHandover } from "@/lib/declutter/api";

export interface HandoverTalk {
  id: string;
  buyer_id: string;
  seller_id: string;
  opened_by: string;
  opened_at: string;
  expires_at: string;
  closed_at: string | null;
}

export interface HandoverMessage {
  id: string;
  talk_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

const TALK_COLUMNS = "id, buyer_id, seller_id, opened_by, opened_at, expires_at, closed_at";

/** Open (or reopen the same open) chat with the other side of an agreed sale. Returns the talk's id. */
export async function openHandoverTalk(otherId: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_open_handover_talk", { p_other: otherId }),
    (e) => rpcErrorMessage("declutter_open_handover_talk", e)) as string;
}

/** Send one message. A message with contact details is refused by the server's filter (its words are shown). */
export async function sendHandoverMessage(talkId: string, body: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_send_handover_message", { p_talk_id: talkId, p_body: body }),
    (e) => rpcErrorMessage("declutter_send_handover_message", e)) as string;
}

/** The seller adds a way to a listed item (never removes one). Returns the item's ways now. */
export async function addHandover(itemId: string, way: SellerHandover): Promise<SellerHandover[]> {
  return rpcData(await supabase.rpc("declutter_add_handover", { p_item_id: itemId, p_way: way }),
    (e) => rpcErrorMessage("declutter_add_handover", e)) as SellerHandover[];
}

/** One talk (null when the caller is not one of its two people, or it does not exist), with its whole history. */
export async function fetchHandoverTalk(talkId: string): Promise<{ talk: HandoverTalk; messages: HandoverMessage[] } | null> {
  const talk = unwrap(await supabase.from("declutter_handover_talks").select(TALK_COLUMNS).eq("id", talkId).maybeSingle()) as HandoverTalk | null;
  if (!talk) return null;
  const messages = unwrap(await supabase.from("declutter_handover_talk_messages")
    .select("id, talk_id, sender_id, body, created_at").eq("talk_id", talkId)
    .order("created_at", { ascending: true }).order("id", { ascending: true })) as HandoverMessage[];
  return { talk, messages };
}

/** The caller's open talks (either side), newest first. */
export async function fetchMyOpenHandoverTalks(userId: string): Promise<HandoverTalk[]> {
  return unwrap(await supabase.from("declutter_handover_talks").select(TALK_COLUMNS)
    .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`).is("closed_at", null)
    .gt("expires_at", new Date().toISOString()).order("opened_at", { ascending: false })) as HandoverTalk[];
}

/** The seller's items waiting in this buyer's cart (the ones a talk is about), for "Add a way". */
export async function fetchTalkItems(sellerId: string, buyerId: string): Promise<{ item_id: string; title: string; handovers: SellerHandover[] | null; price_cents: number }[]> {
  const lines = unwrap(await supabase.from("declutter_cart_items").select("item_id")
    .eq("seller_id", sellerId).eq("buyer_id", buyerId).eq("status", "in_cart")) as { item_id: string | null }[];
  const ids = lines.map((l) => l.item_id).filter((x): x is string => !!x);
  if (ids.length === 0) return [];
  const items = unwrap(await supabase.from("declutter_items").select("id, title, handovers, price_cents").in("id", ids)) as
    { id: string; title: string; handovers: SellerHandover[] | null; price_cents: number }[];
  return items.map((i) => ({ item_id: i.id, title: i.title, handovers: i.handovers, price_cents: i.price_cents }));
}
