/**
 * The order chat (audit 1028 part 2, D2-1; migration 20261030004216_declutter_order_talk): once an order is paid, its
 * buyer and seller can message each other until 48 hours after the handover (held open while a problem or a refund
 * request on it is open; 24 hours after that resolves). One chat per order, separate from the pre-checkout handover
 * chat (lead, 2026-10-29).
 *
 * The server is the protection: nobody reads or writes the tables directly; declutter_order_talk_view returns the
 * caller's own order's chat (each message as theirs or the other side's, never an id or a name), and
 * declutter_send_order_message runs the contact-leak filter, the block check, the rate limit and the notice.
 */
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { rpcData } from "@/lib/declutter/api";

interface OrderTalkMessage {
  id: string;
  mine: boolean;
  body: string;
  created_at: string;
}

interface OrderTalkView {
  order_id: string;
  side: "buyer" | "seller";
  /** False once the chat has ended (or either side blocked the other). */
  open: boolean;
  /** When it ends; null while it has no end yet (not handed over, or a problem or refund request is open). */
  open_until: string | null;
  messages: OrderTalkMessage[];
}

/** The caller's chat on one of their paid orders. */
export async function fetchOrderTalk(orderId: string): Promise<OrderTalkView> {
  return rpcData(await supabase.rpc("declutter_order_talk_view", { p_order_id: orderId }),
    (e) => rpcErrorMessage("declutter_order_talk_view", e)) as unknown as OrderTalkView;
}

/** Send one message. A message with contact details is refused by the server's filter (its words are shown). */
export async function sendOrderMessage(orderId: string, body: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_send_order_message", { p_order_id: orderId, p_body: body }),
    (e) => rpcErrorMessage("declutter_send_order_message", e)) as string;
}

/** One row of Messages -> Declutter: one of the caller's own order chats (never a person's id or name, never words). */
export interface OrderTalkListRow {
  order_id: string;
  side: "buyer" | "seller";
  /** The order's first item, or null if it was removed. */
  title: string | null;
  last_at: string;
  /** True when the caller sent the last message. */
  last_mine: boolean;
  open: boolean;
}

/** Shared by the Declutter chip's list and the hook that decides whether that chip shows (one request). */
export const MY_ORDER_TALKS_KEY = ["declutter", "my-order-talks"] as const;

/** The caller's order chats, newest first (declutter_my_order_talks, at most 50). No switch gate (row 62). */
export async function fetchMyOrderTalks(): Promise<OrderTalkListRow[]> {
  return (rpcData(await supabase.rpc("declutter_my_order_talks"),
    (e) => rpcErrorMessage("declutter_my_order_talks", e)) ?? []) as unknown as OrderTalkListRow[];
}
