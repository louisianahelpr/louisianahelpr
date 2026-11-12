/**
 * Shop reviews and the shop's own rating (Shops H9, migration 20261105230819_shops_reviews_and_rating). Either side of a
 * handed-over order reviews once; reviews stay hidden until both sides reviewed or 14 days after the handover; the
 * shop's rating is its buyers' public reviews only, shown at 3 or more. The server is the protection: nobody reads the
 * table directly, and no person id comes back.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "./rpcErrorCopy";
import type { ReportedReview } from "@/lib/declutter/api";
import { loadAdminRpcErrorCopy } from "@/lib/lifecycleErrors";

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

interface ShopReview {
  id: string;
  stars: number;
  comment: string | null;
  created_at: string;
  /** S052: "First L." (member_display_name); absent until 20261112201612 is deployed. */
  reviewer_name?: string;
}

export interface ShopReviews {
  /** The average, only at 3 or more public reviews; null below that. */
  rating: number | null;
  review_count: number;
  reviews: ShopReview[];
}

export interface MyOrderReview {
  side: "buyer" | "shop";
  can_review: boolean;
  mine: { stars: number; comment: string | null; created_at: string } | null;
}

export const shopReviewsKey = (shopId: string) => ["shops", "reviews", shopId] as const;
export const myOrderReviewKey = (orderId: string) => ["shops", "my-order-review", orderId] as const;

export async function fetchShopReviews(shopId: string): Promise<ShopReviews> {
  return rpcData(await supabase.rpc("shops_shop_reviews", { p_shop_id: shopId }),
    (e) => rpcErrorMessage("shops_shop_reviews", e)) as unknown as ShopReviews;
}

export async function fetchMyOrderReview(orderId: string): Promise<MyOrderReview> {
  return rpcData(await supabase.rpc("shops_my_order_review", { p_order_id: orderId }),
    (e) => rpcErrorMessage("shops_my_order_review", e)) as unknown as MyOrderReview;
}

/** One review of a handed-over order. A comment with contact details is refused by the server (its words are shown). */
export async function leaveShopReview(orderId: string, stars: number, comment: string | null): Promise<string> {
  return rpcData(await supabase.rpc("shops_leave_review", { p_order_id: orderId, p_stars: stars, p_comment: comment ?? "" }),
    (e) => rpcErrorMessage("shops_leave_review", e)) as string;
}

/** Q1948 (L46): the Shops reviews behind shop review reports, read as admin (members can't read the table). Same row
 * shape as Declutter's (ReportedReview), so the reports queue hydrates both the same way. */
export async function fetchReportedShopReviews(reviewIds: string[]): Promise<ReportedReview[]> {
  if (!reviewIds.length) return [];
  const res = await supabase.rpc("shops_admin_reported_reviews", { p_review_ids: reviewIds });
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return (rpcData(res, (e) => admin?.rpcErrorMessage("shops_admin_reported_reviews", e) ?? null) ?? []) as ReportedReview[];
}

/** Q1948: an admin removes a reported Shops review (members stop seeing it; it leaves the shop's rating); the report resolves. */
export async function removeReportedShopReview(reviewId: string, reportId: string): Promise<string> {
  const res = await supabase.rpc("shops_admin_remove_review", { p_review_id: reviewId, p_note: "", p_report_id: reportId });
  const admin = res.error ? await loadAdminRpcErrorCopy() : null;
  return rpcData(res, (e) => admin?.rpcErrorMessage("shops_admin_remove_review", e) ?? null) as string;
}
