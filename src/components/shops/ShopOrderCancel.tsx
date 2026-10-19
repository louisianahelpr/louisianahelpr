/**
 * Cancelling an ACCEPTED, charged Shops order (Shops M3, migration
 * 20261019071055_shops_refunds_cancels_strikes; spec O2, O3, L42).
 *
 *   Buyer: "Cancel order". The dialog reads shops_order_cancel_quote first and
 *          says plainly what happens: inside the shop's free-cancel time the
 *          price comes back less the card-processing cost (and the sales tax
 *          on it); after it, nothing comes back and the shop is paid. The tap
 *          sends what the dialog showed ('free' / 'late'); if the window moved
 *          in between, the server refuses (cancel_terms_changed) and the dialog
 *          shows the new answer instead of charging the buyer for a stale one.
 *   Shop:  "Cancel order" (the buyer gets everything back, the card fee comes
 *          out of the shop's payout, a Shops strike), and "Buyer didn't show"
 *          on an in-person order the shop marked ready, once its ready date is
 *          over (O3: a late cancel, the shop is paid, the buyer gets a strike;
 *          the server refuses an order never marked ready: not_ready).
 *
 * Hidden while a problem report is open (Louisiana Helpr decides those) and
 * before the card is charged.
 */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import {
  buyerCancelOrder,
  fetchCancelQuote,
  formatCents,
  reportNoShow,
  shopCancelOrder,
  type CancelQuote,
  type ShopOrder,
} from "@/lib/shops/orders";
import { fetchHandovers } from "@/lib/shops/handover";
import { shopsErrorMessage } from "@/lib/shops/errors";

const REASON_MAX = 200;

/** Today in Louisiana (ready dates are local dates). */
function louisianaToday(now: number = Date.now()): string {
  return new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

/** The buyer's words for what a cancel does now. */
export function cancelQuoteText(q: CancelQuote): string {
  if (q.unavailable) return "Cancelling a paid order isn't available yet. Please try again in a few minutes.";
  if (!q.can_cancel) return "This order can't be cancelled any more.";
  if (q.free) {
    return `You're inside the shop's free-cancel time. You get ${formatCents(q.refund_cents ?? 0)} back, `
      + "less the card-processing cost and the sales tax on it. The shop is told not to make it.";
  }
  return "The shop's free-cancel time is over. If you cancel now, nothing is refunded and the shop is paid.";
}

function useOpenOrder(order: ShopOrder): { cancellable: boolean; markedReady: boolean } {
  const open = order.status === "accepted" && !!order.captured_at && !order.handed_over_at;
  const handover = useQuery({
    queryKey: ["shops", "handover", order.id],
    queryFn: async () => (await fetchHandovers([order.id])).get(order.id) ?? null,
    enabled: open,
  });
  return { cancellable: open && !handover.data?.problem_at && !handover.isLoading, markedReady: !!handover.data?.ready_at };
}

export function BuyerCancelOrder({ order }: { order: ShopOrder }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [changed, setChanged] = useState(false);
  const { cancellable } = useOpenOrder(order);
  const quote = useQuery({
    queryKey: ["shops", "cancel-quote", order.id],
    queryFn: () => fetchCancelQuote(order.id),
    enabled: asking,
    staleTime: 0,
  });
  const done = () => {
    setAsking(false);
    setChanged(false);
    void qc.invalidateQueries({ queryKey: ["shops", "my-orders"] });
  };
  const cancel = useMutation({
    mutationFn: (expect: "free" | "late") => buyerCancelOrder(order.id, expect),
    onSuccess: ({ refundCents }) => {
      toast.success(refundCents > 0
        ? `Order cancelled. ${formatCents(refundCents)} is on its way back to your card.`
        : "Order cancelled. Nothing is refunded; the shop is paid.");
      done();
    },
    onError: (err) => {
      if (err instanceof Error && err.message === "cancel_terms_changed") {
        // The window moved since the dialog opened: show the new answer, cancel nothing.
        setChanged(true);
        void quote.refetch();
        return;
      }
      toast.error(shopsErrorMessage(err));
      done();
    },
  });
  if (!cancellable) return null;
  const q = quote.data;
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => { setChanged(false); setAsking(true); }}>
        Cancel order
      </Button>
      <BrandConfirmDialog
        open={asking}
        onOpenChange={(o) => { if (!o) setAsking(false); }}
        title="Cancel this order?"
        description={quote.isLoading || !q ? (quote.isError ? shopsErrorMessage(quote.error) : "Checking the shop's cancel terms…") : cancelQuoteText(q)}
        primaryLabel={cancel.isPending ? "Cancelling…" : q?.can_cancel && !q.free ? "Cancel without a refund" : "Cancel order"}
        primaryDisabled={cancel.isPending || !q?.can_cancel || quote.isFetching}
        onPrimary={(e) => {
          e.preventDefault();
          if (q?.can_cancel) cancel.mutate(q.free ? "free" : "late");
        }}
        secondaryLabel="Keep it"
      >
        {changed && (
          <p className="text-sm font-semibold" role="alert" data-testid="shop-cancel-terms-changed">
            The free-cancel time for this order changed while you were looking. Here's what happens now.
          </p>
        )}
      </BrandConfirmDialog>
    </>
  );
}

export function ShopCancelOrder({ order }: { order: ShopOrder }) {
  const qc = useQueryClient();
  const reasonId = useId();
  const [asking, setAsking] = useState<"cancel" | "no_show" | null>(null);
  const [reason, setReason] = useState("");
  const { cancellable, markedReady } = useOpenOrder(order);
  const done = () => {
    setAsking(null);
    setReason("");
    void qc.invalidateQueries({ queryKey: ["shops", "shop-orders"] });
    void qc.invalidateQueries({ queryKey: ["shops", "payouts"] });
  };
  const act = useMutation({
    mutationFn: (what: "cancel" | "no_show") => (what === "cancel" ? shopCancelOrder(order.id, reason) : reportNoShow(order.id)),
    onSuccess: (_v, what) => {
      toast.success(what === "cancel" ? "Order cancelled. The buyer is refunded in full." : "No-show recorded. You are paid for the order.");
      done();
    },
    onError: (err) => {
      toast.error(shopsErrorMessage(err));
      done();
    },
  });
  if (!cancellable) return null;
  // Only an order the shop marked ready can be a no-show (the server says not_ready otherwise).
  const noShowOpen = order.handover_mode === "in_person" && markedReady && louisianaToday() > order.ready_date;
  return (
    <div className="flex flex-wrap gap-2" data-testid="shop-cancel-actions">
      {noShowOpen && (
        <Button type="button" size="sm" variant="outline" disabled={act.isPending} onClick={() => setAsking("no_show")}>
          Buyer didn't show
        </Button>
      )}
      <Button type="button" size="sm" variant="outline" disabled={act.isPending} onClick={() => { setReason(""); setAsking("cancel"); }}>
        Cancel order
      </Button>
      <BrandConfirmDialog
        open={asking === "cancel"}
        onOpenChange={(o) => { if (!o) setAsking(null); }}
        title="Cancel this accepted order?"
        description="The buyer gets everything back. The card fee comes out of your next payout, and it counts as a Shops strike (3 strikes pause Shops for you)."
        primaryLabel={act.isPending ? "Cancelling…" : "Cancel and refund"}
        primaryDisabled={act.isPending || reason.length > REASON_MAX}
        onPrimary={(e) => {
          e.preventDefault();
          act.mutate("cancel");
        }}
        secondaryLabel="Keep the order"
      >
        <div className="space-y-1">
          <Label htmlFor={reasonId}>Tell the buyer why (optional)</Label>
          <Textarea id={reasonId} value={reason} maxLength={REASON_MAX} onChange={(e) => setReason(e.target.value)} placeholder="Our oven broke" />
        </div>
      </BrandConfirmDialog>
      <BrandConfirmDialog
        open={asking === "no_show"}
        onOpenChange={(o) => { if (!o) setAsking(null); }}
        title="The buyer didn't come?"
        description="A missed pickup counts as a late cancel: you are paid for the order, and the buyer gets a Shops strike. Only report this if they really didn't come."
        primaryLabel={act.isPending ? "Saving…" : "Report a no-show"}
        primaryDisabled={act.isPending}
        onPrimary={(e) => {
          e.preventDefault();
          act.mutate("no_show");
        }}
        secondaryLabel="Cancel"
      />
    </div>
  );
}
