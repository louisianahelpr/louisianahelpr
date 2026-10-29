import { useQuery } from "@tanstack/react-query";
import { fetchOpenProblems, type OpenProblem } from "@/lib/declutter/handover";

/**
 * Audit 1b D2-2: the open problem on each of these orders (one at most: declutter_problems_one_open), keyed by order.
 * The Buying tracker and the order cards read it with one key, so a card reads nothing again. Empty while loading or
 * on a failed read: the card then shows what it showed before, and the server still refuses booking, a second report
 * and a no-show while a problem is open (problem_open).
 */
export function useOpenProblems(orderIds: string[], enabled = true): Map<string, OpenProblem> {
  const ids = [...new Set(orderIds)].sort();
  const q = useQuery({
    queryKey: ["declutter", "problems", ids.join(",")],
    queryFn: () => fetchOpenProblems(ids),
    enabled: enabled && ids.length > 0,
  });
  return new Map((q.data ?? []).map((p) => [p.order_id, p]));
}
