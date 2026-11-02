import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchMyCart } from "@/lib/declutter/api";
import { fetchMyHandover, fetchOrderProblem, type MyHandover, type OrderProblem } from "@/lib/declutter/handover";
import { fetchRefundRequestView, type RefundRequestView } from "@/lib/declutter/refundRequests";
import { useFeature } from "@/hooks/useFeature";
import { useOpenProblems } from "./useOpenProblems";

/**
 * NIGHT-BUYINGopenpr-3: an open problem the seller did not report and has not answered yet. The sale card's
 * "Add your side" (DeclutterProblemSides) is then the seller's move, as problemAwaitsBuyer is the buyer's.
 */
function problemAwaitsSeller(p: Pick<OrderProblem, "status" | "reporter_side" | "other_side_note"> | null): boolean {
  return !!p && p.status === "open" && p.reporter_side !== "seller" && !p.other_side_note;
}

/**
 * A3-78: a buyer's "they didn't show" / "it wasn't delivered" waits on the seller while its answer-by is set
 * (declutter_my_handover; the card's NoShowAnswer shows its button on the same rule).
 */
export function noShowAwaitsSeller(h: Pick<MyHandover, "no_show_reported_at" | "no_show_answer_by"> | null | undefined): boolean {
  return !!h?.no_show_reported_at && !!h.no_show_answer_by;
}

/**
 * A3-78: a refund request waits on the seller while it is open (answer it), or while the item is back at their door
 * and they haven't confirmed it (returning, dropped off, not returned).
 */
export function refundAwaitsSeller(v: Pick<RefundRequestView, "request"> | null | undefined): boolean {
  const r = v?.request;
  if (!r) return false;
  return r.status === "open" || (r.status === "returning" && !!r.return_dropped_off_at && !r.returned_at);
}

/**
 * The seller's paid sales with a report waiting on their side (lead 10-31: they count and list under "To answer";
 * no new chip). The same keys as the sale cards (my-cart, the open problems, declutter_order_problem per order),
 * so the cards that open read nothing again.
 */
export function useSellerReportsToAnswer(): Set<string> {
  // A3-78: also each sale waiting on the seller's answer to a no-show report or a refund request.
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const ids = [...new Set((cart.data ?? []).filter((l) => l.my_side === "seller" && l.status === "paid" && l.order_id).map((l) => l.order_id as string))];
  const problems = useOpenProblems(ids);
  const problemIds = ids.filter((id) => problems.has(id));
  const rows = useQueries({ queries: problemIds.map((id) => ({ queryKey: ["declutter", "problem", id], queryFn: () => fetchOrderProblem(id) })) });
  const out = new Set(problemIds.filter((_, i) => problemAwaitsSeller(rows[i]?.data ?? null)));
  // A3-78: a no-show report on a sale not handed over, and a refund request on one that was (the same keys the sale
  // card and its refund panel read).
  const sellerLines = (cart.data ?? []).filter((l) => l.my_side === "seller" && l.status === "paid" && l.order_id);
  const open = [...new Set(sellerLines.filter((l) => l.order_status === "paid").map((l) => l.order_id as string))];
  const handed = [...new Set(sellerLines.filter((l) => l.order_status === "handed_over").map((l) => l.order_id as string))];
  const handovers = useQueries({ queries: open.map((id) => ({ queryKey: ["declutter", "handover", id], queryFn: () => fetchMyHandover(id) })) });
  const refundsOn = useFeature("declutter_refund_requests");
  const refunds = useQueries({ queries: (refundsOn ? handed : []).map((id) => ({ queryKey: ["declutter", "refund-request", id], queryFn: () => fetchRefundRequestView(id) })) });
  open.forEach((id, i) => { if (noShowAwaitsSeller(handovers[i]?.data)) out.add(id); });
  (refundsOn ? handed : []).forEach((id, i) => { if (refundAwaitsSeller(refunds[i]?.data)) out.add(id); });
  return out;
}
