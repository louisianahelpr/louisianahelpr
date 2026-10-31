import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchMyCart } from "@/lib/declutter/api";
import { fetchOrderProblem, type OrderProblem } from "@/lib/declutter/handover";
import { useOpenProblems } from "./useOpenProblems";

/**
 * NIGHT-BUYINGopenpr-3: an open problem the seller did not report and has not answered yet. The sale card's
 * "Add your side" (DeclutterProblemSides) is then the seller's move, as problemAwaitsBuyer is the buyer's.
 */
function problemAwaitsSeller(p: Pick<OrderProblem, "status" | "reporter_side" | "other_side_note"> | null): boolean {
  return !!p && p.status === "open" && p.reporter_side !== "seller" && !p.other_side_note;
}

/**
 * The seller's paid sales with a report waiting on their side (lead 10-31: they count and list under "To answer";
 * no new chip). The same keys as the sale cards (my-cart, the open problems, declutter_order_problem per order),
 * so the cards that open read nothing again.
 */
export function useSellerReportsToAnswer(): Set<string> {
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart });
  const ids = [...new Set((cart.data ?? []).filter((l) => l.my_side === "seller" && l.status === "paid" && l.order_id).map((l) => l.order_id as string))];
  const problems = useOpenProblems(ids);
  const problemIds = ids.filter((id) => problems.has(id));
  const rows = useQueries({ queries: problemIds.map((id) => ({ queryKey: ["declutter", "problem", id], queryFn: () => fetchOrderProblem(id) })) });
  return new Set(problemIds.filter((_, i) => problemAwaitsSeller(rows[i]?.data ?? null)));
}
