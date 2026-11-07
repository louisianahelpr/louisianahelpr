/**
 * How many members saved each item (owner 11-07, after reviewing Vinted: each Browse card's heart shows its save
 * count). One read per 200 items (declutter_item_save_counts, 20261107232700), which answers only a number per item
 * the caller can already see, never who saved it. An item missing from the answer has no saves.
 *
 * Browse asks only AFTER its cards have painted (never part of the first screen's loading gate), so a slow answer
 * costs the guest nothing. Before the read is deployed (PGRST202) the answer is "no counts", so the hearts show no
 * number rather than a wrong zero.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";

const PER_READ = 200;

export async function fetchSaveCounts(itemIds: string[]): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  if (itemIds.length === 0) return out;
  const chunks: string[][] = [];
  for (let i = 0; i < itemIds.length; i += PER_READ) chunks.push(itemIds.slice(i, i + PER_READ));
  const answers = await Promise.all(chunks.map((ids) => supabase.rpc("declutter_item_save_counts", { p_item_ids: ids })));
  for (const res of answers) {
    if (res.error && isMissingRpcNamed(res.error, "declutter_item_save_counts")) return null;
    for (const row of unwrap(res) ?? []) out.set(row.item_id, row.saves);
  }
  return out;
}

/**
 * The number a heart shows: the server's count, moved by the viewer's own heart taps since it was read (so a tap
 * shows at once, without asking again). `savedAtRead` is whether the viewer's own save was in that count.
 */
export function shownSaves(serverCount: number, savedAtRead: boolean, savedNow: boolean): number {
  return Math.max(0, serverCount - (savedAtRead ? 1 : 0) + (savedNow ? 1 : 0));
}
