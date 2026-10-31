/**
 * The delivery chat (BUY-36, migration 20261031231948_helpr_delivery_talk): the Helpr, the buyer and the seller of one
 * delivery, from accept until it ends. The server is the protection: only the three read or write it, and the
 * contact-leak filter, the block check, the rate limit and the notice all run there.
 */
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { rpcData } from "@/lib/declutter/api";

export type TalkSide = "helpr" | "buyer" | "seller";

export interface DeliveryTalkView {
  task_id: string;
  side: TalkSide;
  open: boolean;
  messages: Array<{ id: string; side: TalkSide; mine: boolean; body: string; created_at: string }>;
}

export async function fetchDeliveryTalk(taskId: string): Promise<DeliveryTalkView> {
  return rpcData(await supabase.rpc("helpr_task_talk_view", { p_task_id: taskId }),
    (e) => rpcErrorMessage("helpr_task_talk_view", e)) as unknown as DeliveryTalkView;
}

export async function sendDeliveryMessage(taskId: string, body: string): Promise<string> {
  return rpcData(await supabase.rpc("helpr_task_send_message", { p_task_id: taskId, p_body: body }),
    (e) => rpcErrorMessage("helpr_task_send_message", e)) as string;
}
