/**
 * Messages with a shop (Shops H1, migration 20261105185006_shops_talk; owner L48 "any time", before and after
 * ordering). One thread per shop and member. The server is the protection: nobody reads or writes the tables
 * directly; shops_talk_view returns only the caller's own thread (each message theirs or not, never a person's id),
 * and shops_send_talk_message runs the contact-leak filter, the block check, the rate limit and the notice.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "./rpcErrorCopy";

function rpcData<T>(result: { data: T; error: { message: string } | null }, words: (e: unknown) => string | null): T {
  if (!result.error) return result.data;
  try {
    unwrap(result);
  } catch (thrown) {
    const e = thrown as Error & { userMessage?: string };
    const msg = words(thrown);
    if (msg && Object.isExtensible(e)) e.userMessage = msg;
    throw e;
  }
  return result.data;
}

interface ShopTalkMessage {
  id: string;
  mine: boolean;
  body: string;
  created_at: string;
}

export interface ShopTalkView {
  talk_id: string;
  shop_id: string;
  side: "buyer" | "shop";
  /** The shop's name for the member; the member's first name for the shop. */
  other_label: string;
  /** False while the shop is hidden or either side has blocked the other. */
  open: boolean;
  messages: ShopTalkMessage[];
}

export interface ShopTalkRow {
  talk_id: string;
  side: "buyer" | "shop";
  other_label: string;
  last_at: string;
  last_mine: boolean;
  unread: boolean;
}

export const MY_SHOP_TALKS_KEY = ["shops", "my-talks"] as const;

/**
 * Q1947: the chat for a shop order, from its card, for either side (shops_open_order_talk, 20261105225245): the buyer's
 * thread with the shop, or the shop owner's thread with that buyer. Made on first use.
 */
export async function openShopOrderTalk(orderId: string): Promise<string> {
  return rpcData(await supabase.rpc("shops_open_order_talk", { p_order_id: orderId }),
    (e) => rpcErrorMessage("shops_open_order_talk", e)) as string;
}

/**
 * S2-018 (Shops audit 2, 20261112223654): the chat about a custom request, for either side (shops_open_request_talk):
 * the same one thread per shop and member. Made on first use.
 */
export async function openShopRequestTalk(requestId: string): Promise<string> {
  return rpcData(await supabase.rpc("shops_open_request_talk", { p_request_id: requestId }),
    (e) => rpcErrorMessage("shops_open_request_talk", e)) as string;
}

/** The caller's thread with a shop, made on first use. */
export async function openShopTalk(shopId: string): Promise<string> {
  return rpcData(await supabase.rpc("shops_open_talk", { p_shop_id: shopId }), (e) => rpcErrorMessage("shops_open_talk", e)) as string;
}

export async function fetchShopTalk(talkId: string): Promise<ShopTalkView> {
  return rpcData(await supabase.rpc("shops_talk_view", { p_talk_id: talkId }),
    (e) => rpcErrorMessage("shops_talk_view", e)) as unknown as ShopTalkView;
}

/** Send one message. A message with contact details is refused by the server's filter (its words are shown). */
export async function sendShopTalkMessage(talkId: string, body: string): Promise<string> {
  return rpcData(await supabase.rpc("shops_send_talk_message", { p_talk_id: talkId, p_body: body }),
    (e) => rpcErrorMessage("shops_send_talk_message", e)) as string;
}

/** The caller's threads, both sides, newest first (at most 50). */
export async function fetchMyShopTalks(): Promise<ShopTalkRow[]> {
  return (rpcData(await supabase.rpc("shops_my_talks"), (e) => rpcErrorMessage("shops_my_talks", e)) ?? []) as unknown as ShopTalkRow[];
}

export async function markShopTalkRead(talkId: string): Promise<void> {
  rpcData(await supabase.rpc("shops_mark_talk_read", { p_talk_id: talkId }), (e) => rpcErrorMessage("shops_mark_talk_read", e));
}
