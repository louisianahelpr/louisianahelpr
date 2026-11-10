/**
 * Audit 11-10 F376 (High): a handed-over order in the buyer's 24 hours to check it showed only "Handed over. It's
 * yours." and "Leave a review": no deadline and no way to report a problem from the order. The server takes a buyer's
 * problem report in those 24 hours whatever the refund switch says (declutter_report_problem:
 * declutter_problem_window_open), and the seller's payout waits for them (declutter_sale_final). This block says until
 * when, and opens the same "Report a problem" form the rest of the card uses.
 *
 * The order card shows it on a handed-over buyer order when the refund panel is not there (that panel's "Ask for a
 * refund" line already names the deadline) and no problem is open. Once the 24 hours are over it renders nothing.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchMyHandover } from "@/lib/declutter/handover";
import { checkWindowEnds, orderWhen } from "@/lib/declutter/timeLeft";
import { ProblemForm } from "./DeclutterProblemForm";

/** When the buyer's 24 hours end, from the handover row (the same key the order card reads); null once over. */
export function useBuyerCheckWindow(orderId: string, enabled: boolean): string | null {
  const row = useQuery({ queryKey: ["declutter", "handover", orderId], queryFn: () => fetchMyHandover(orderId), enabled });
  return enabled ? checkWindowEnds(row.data?.confirmed_at) : null;
}

export function BuyerCheckWindow({ orderId }: { orderId: string }) {
  const endsAt = useBuyerCheckWindow(orderId, true);
  if (!endsAt) return null;
  return (
    <div className="space-y-2 rounded-xl border border-border p-3" data-check-window="">
      <p className="text-sm font-semibold">Check it over: you can report a problem until {orderWhen(endsAt)}.</p>
      <p className="text-ds-12 text-muted-foreground">After that the sale is final and the seller is paid.</p>
      <ProblemForm orderId={orderId} side="buyer" stage="handover" />
    </div>
  );
}
