/**
 * S2-016 (Shops audit 2, 11-12): how many shop chats have an unread message for the member, for the Messages badge
 * (useShopTalksInBadge) and Messages' chips. Kept apart from talk.ts so the badge, which every signed-in page mounts, does not carry the
 * Shops error words table. Read only while the member has the shops switch (shops_my_talks refuses without it).
 * Its query key sits UNDER MY_SHOP_TALKS_KEY, so every place that refreshes the shop chat list (sending, opening and
 * reading a chat) refreshes the badge too.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/** Messages' query (its chips and "Unread · n"); under MY_SHOP_TALKS_KEY, so reading or sending a chat refreshes it. */
export const SHOP_TALKS_SUMMARY_KEY = ["shops", "my-talks", "summary"] as const;

/** Messages tells the badge (useShopTalksInBadge) each fresh unread count, as a window event with detail { unread }. */
export const SHOP_TALKS_UNREAD_EVENT = "lh-shop-talks-unread";

export interface ShopTalkSummary {
  /** The member's shop chats, both sides. */
  total: number;
  /** Those whose last message from the other side is unread. */
  unread: number;
}

/** Throws on a failed read (the badge then keeps what it had). */
export async function fetchShopTalkSummary(): Promise<ShopTalkSummary> {
  const res = await supabase.rpc("shops_my_talks");
  if (res.error) {
    // The Shops words load only on a failed read, so the badge every signed-in page mounts carries no error table;
    // unwrap() then throws with those words, the code and the HTTP status kept.
    const { rpcErrorMessage } = await import("./rpcErrorCopy");
    const words = rpcErrorMessage("shops_my_talks", res.error);
    return summarizeShopTalks(unwrap({ ...res, error: words ? { ...res.error, message: words } : res.error }) as unknown);
  }
  return summarizeShopTalks(unwrap(res) as unknown);
}

export function summarizeShopTalks(rows: unknown): ShopTalkSummary {
  if (!Array.isArray(rows)) return { total: 0, unread: 0 };
  return { total: rows.length, unread: rows.filter((r) => !!r && (r as { unread?: unknown }).unread === true).length };
}
