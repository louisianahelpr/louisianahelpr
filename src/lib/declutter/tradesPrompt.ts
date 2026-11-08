/**
 * The one-time "Turn on trades for all your listings?" card (owner decision 2026-11-08: trades were live but 0 of 265
 * live listings took them, because "Open to trades" starts OFF). Server: 20261108193632.
 *
 *   - Shown to a seller who has NOT answered it yet and has at least one live, priced listing not open to trades.
 *   - The answer is kept on the account (declutter_seller_defaults.trades_prompt_answered_at), never on the device.
 *   - Turn on: the caller's live priced listings and their listing default turn on (declutter_trades_prompt_answer).
 *     Open offers are not touched. Not now: only the answer is kept.
 * Until 20261108193632 is on prod (the column is missing) the card never shows.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcData } from "@/lib/declutter/api";
import { rpcErrorMessage } from "@/lib/declutter/tradeErrors";

export const tradesPromptKey = (userId: string) => ["declutter", "trades-prompt", userId] as const;

const notDeployed = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || e.code === "PGRST205" || e.code === "42P01") && /trade|seller_defaults/.test(e.message ?? "");

/** Whether to show the card to `userId`. */
export async function fetchTradesPromptDue(userId: string): Promise<boolean> {
  const answered = await supabase.from("declutter_seller_defaults").select("trades_prompt_answered_at").eq("member_id", userId).maybeSingle();
  if (notDeployed(answered.error)) return false;
  const row = unwrap(answered) as { trades_prompt_answered_at: string | null } | null;
  if (row?.trades_prompt_answered_at) return false;
  const off = await supabase
    .from("declutter_items")
    .select("id")
    .eq("seller_id", userId)
    .eq("status", "live")
    .gt("price_cents", 0)
    .gt("current_price_cents", 0)
    .eq("accepts_trades", false)
    .limit(1);
  if (notDeployed(off.error)) return false;
  return (unwrap(off) ?? []).length > 0;
}

/** The card's buttons. Returns how many listings were opened to trades (0 for Not now). */
export async function answerTradesPrompt(turnOn: boolean): Promise<number> {
  return rpcData(
    await supabase.rpc("declutter_trades_prompt_answer", { p_turn_on: turnOn }),
    (e) => rpcErrorMessage("declutter_trades_prompt_answer", e),
  ) as number;
}
