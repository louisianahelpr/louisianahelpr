/**
 * How many people saw each Declutter item (owner request 11-05: "add a way for me to see how many people saw each
 * item"). Migration 20261105163501: one row per (item, person) in declutter_item_views; the server never counts the
 * seller, an admin, a test account or a test listing.
 *
 * recordItemView: the item page reports one view, fire-and-forget, only once the page has settled (whenPageSettled),
 * so it never competes with the page's own reads (owner rule: nothing slow). Once per item per tab session. A guest
 * is told apart by a random id kept on the device (localStorage); a member by their account.
 *
 * fetchMyItemViewCounts: the seller's own counts (item id -> people), read only for the seller.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchMyItemViewCounts, sendItemViewRpc } from "@/lib/declutter/api";
import { whenPageSettled } from "@/lib/routePrefetch";
import { resetSentItemViews, sent } from "@/lib/declutter/itemViewsSent";
import { viewerDeviceId } from "@/lib/declutter/viewerDevice";
import { trackFunnel } from "@/lib/declutter/funnel";


/** Sends the view itself. Never throws: a view that fails to record is not something the viewer should ever see. */
async function sendItemView(itemId: string, signedIn: boolean): Promise<void> {
  const device = signedIn ? null : viewerDeviceId();
  if (!signedIn && !device) return;
  try {
    await sendItemViewRpc(itemId, device);
  } catch {
    // fire-and-forget by design (lead decision 11-05): an uncounted view costs nothing a viewer could act on
  }
}

/** The item page's call: once per item per session, after the page has finished loading. Returns a cancel. */
export function recordItemView(itemId: string, signedIn: boolean): () => void {
  const key = `${signedIn ? "m" : "g"}:${itemId}`;
  if (sent.has(key)) return () => {};
  return whenPageSettled(() => {
    if (sent.has(key)) return;
    sent.add(key);
    void sendItemView(itemId, signedIn);
    trackFunnel("item_view", { itemId }); // H3 (audit 11-08): the funnel's first step, same once-per-session rule
  });
}

export { resetSentItemViews };

/** The seller's counts, one read shared by the Selling rows and their own item page. */
export function useMyItemViewCounts(userId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["declutter", "my-item-views", userId],
    queryFn: () => fetchMyItemViewCounts(),
    enabled: !!userId && enabled,
  });
}

/** "1 view" / "N views": people, not page loads. */
export function viewsLabel(n: number): string {
  return `${n} ${n === 1 ? "view" : "views"}`;
}
