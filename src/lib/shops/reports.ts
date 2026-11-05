/**
 * The admin reports queue's Shops half (Shops H2, 20261105182210): read reported shops and items, take a reported
 * item down, hide a reported shop. Every call is an admin-only RPC; the server is the protection. Members file the
 * reports themselves through the shared ReportDialog (reported_type 'shop' / 'shop_item').
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { unwrapMutation } from "@/lib/mutationResult";
import { loadAdminRpcErrorCopy } from "@/lib/lifecycleErrors";

export type ReportedShop = {
  reported_id: string;
  /** Q1947: shop_talk_message is a message in a shop chat (owner_id is then the person who wrote it). */
  kind: "shop" | "shop_item" | "shop_talk_message";
  shop_id: string;
  owner_id: string;
  label: string;
  /** A shop: open, paused or hidden. An item: its status (live, rejected, ...). A chat message: who wrote it (buyer or shop). */
  status: string;
  shop_hidden: boolean;
  is_seed: boolean;
};

type AdminCopy = NonNullable<Awaited<ReturnType<typeof loadAdminRpcErrorCopy>>>;

/** Throws the RPC's error with the admin copy's words for it (read at each call site with rpcErrorMessage). */
async function adminRpc<T>(res: { data: T; error: { message: string } | null },
  words: (admin: AdminCopy, e: { message: string }) => string | null): Promise<T> {
  if (!res.error) return res.data;
  const admin = await loadAdminRpcErrorCopy();
  const msg = admin ? words(admin, res.error) : null;
  try {
    unwrap(res);
  } catch (thrown) {
    const e = thrown as Error & { userMessage?: string };
    if (msg && Object.isExtensible(e)) e.userMessage = msg;
    throw e;
  }
  return res.data;
}

export async function fetchReportedShops(ids: string[]): Promise<ReportedShop[]> {
  if (!ids.length) return [];
  const res = await supabase.rpc("shops_admin_reported", { p_ids: ids });
  return ((await adminRpc(res, (a, e) => a.rpcErrorMessage("shops_admin_reported", e))) ?? []) as ReportedShop[];
}

/** The item comes off the shop with the admin's reason (the owner reads it); the report resolves. */
export async function takeDownShopItem(itemId: string, note: string, reportId: string): Promise<string> {
  const res = await supabase.rpc("shops_admin_take_down_item", { p_item_id: itemId, p_note: note, p_report_id: reportId });
  return (await adminRpc(res, (a, e) => a.rpcErrorMessage("shops_admin_take_down_item", e))) as string;
}

/** Hide a reported shop (its owner sees the reason), then resolve the report. */
export async function hideReportedShop(shopId: string, reason: string, reportId: string): Promise<void> {
  const res = await supabase.rpc("shops_admin_set_hidden", { p_shop_id: shopId, p_hidden: true, p_reason: reason });
  await adminRpc(res, (a, e) => a.rpcErrorMessage("shops_admin_set_hidden", e));
  // The shop is hidden either way; a report that didn't resolve stays in the queue for the next look.
  unwrapMutation(await supabase.from("reports").update({ status: "resolved" }).eq("id", reportId).select("id"),
    { action: "close this report", context: { reportId } });
}
