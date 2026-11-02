/**
 * Manager mode phase 3: on the seller's sold order, the split of the sale with her manager, in one line:
 * "$40 sale · $8 to Dana · $32 to you". The share is the manager payout once it exists (what was really sent, after
 * any refund), else the terms locked at paid over these items. Nothing shows for a sale with no manager share.
 * Loaded only while declutter_manager is on (ManagerSaleShareGate).
 */
import { shareCentsOf, splitWords, useMyManagerGrants, useOrderManagerShares } from "@/lib/declutter/managerMode";

export default function ManagerSaleShare({ orderId, itemsCents, itemCount }: { orderId: string; itemsCents: number; itemCount: number }) {
  const shares = useOrderManagerShares();
  const grants = useMyManagerGrants();
  const s = (shares.data ?? []).find((x) => x.order_id === orderId);
  if (!s || itemsCents <= 0) return null;
  const cents = shareCentsOf(s, itemsCents, itemCount);
  if (cents <= 0) return null;
  const name = (grants.data ?? []).find((g) => g.manager_id === s.manager_id)?.manager_first_name || "your manager";
  return <p className="text-sm" data-manager-sale-share={orderId}>{splitWords(itemsCents, cents, name)}</p>;
}
