/**
 * The giver's open free asks, one row per item with how many asked (the To-do "Pick who gets it"), from the raw
 * declutter_free_requests rows. Shared by fetchFreeAsksToPick (src/lib/declutter/api.ts) and the nav badge's one read
 * (src/lib/badgeReads.ts), so both give the same answer.
 */
import type { FreeAskToPick } from "@/lib/declutter/api";

export type FreeAskRow = { item_id: string; created_at: string; declutter_items: { title: string } | null };

export function groupFreeAsks(rows: FreeAskRow[]): FreeAskToPick[] {
  const out = new Map<string, FreeAskToPick>();
  for (const r of rows) {
    const had = out.get(r.item_id);
    if (had) had.asked++;
    else out.set(r.item_id, { item_id: r.item_id, title: r.declutter_items?.title ?? "your free item", asked: 1, first_at: r.created_at });
  }
  return [...out.values()];
}
