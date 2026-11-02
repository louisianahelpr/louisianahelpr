/**
 * A shipped order's card body (docs/specs/shipping-draft.md section 6; Q2259; B134). Before this a ship order fell
 * into the pickup branch of the order card: "Pickup at the seller's home", a pickup booking panel and door tips.
 *
 * Seller: the tracker (Paid -> Packed -> Shipped -> Delivered), ONE next-step line with the Ship-by day
 *   - before Packed: "Next: print the label and pack it · Ship by Wed, Nov 4"
 *   - after Packed:  "Next: drop it off at USPS · by Wed, Nov 4"
 *   - after the carrier's acceptance scan: "On its way." with the carrier's status; delivered: when the payout comes,
 * the tracking number, and the buttons: "Print label" (outline; the label file in the browser) and "Packed" (green
 * primary, on the RIGHT). Nothing to print until the label is bought and the payment taken (the server says so).
 * Buyer: the tracking number and "Track" (USPS's own page). The buyer's tracker and line sit in the card head
 * (BuyingOrders buyerNextStep), so this part only adds the number.
 * Every rule is the server's: declutter_my_ship_label / declutter_mark_packed (20261102023246),
 * declutter_my_ship_tracking (20261102025148).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { NextStep, type NextStepValue } from "@/components/ui/NextStep";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import {
  fetchMyShipLabel,
  fetchMyShipTracking,
  markPacked,
  shipByWords,
  shipLabelKey,
  shipTrackingKey,
  trackingStatusWords,
  uspsTrackingUrl,
  type ShipLabel,
} from "@/lib/declutter/shipOrder";
import { OrderSteps } from "./OrderSteps";

const outline = "min-h-11 rounded-full border border-border px-5 text-sm font-semibold";
const primary = "btn-grad-primary !text-[hsl(var(--parchment))] min-h-11 rounded-full px-5 text-sm font-semibold";

/** The seller's next-step line for a shipped order. Pure: tested apart from the screen. */
export function sellerShipNext(l: Pick<ShipLabel, "label_url" | "label_state" | "ship_by" | "packed_at" | "accepted_at" | "delivered_at" | "tracking_status"> | null): NextStepValue {
  if (!l) return { who: "info", text: "Loading the label." };
  if (l.delivered_at) return { who: "info", text: "Delivered. You get paid 24 hours later if nothing's wrong." };
  if (l.accepted_at) return { who: "info", text: `On its way. ${trackingStatusWords(l.tracking_status) ?? "In transit"}.` };
  if (l.label_state === "void_requested" || l.label_state === "voided" || l.label_state === "void_rejected") {
    return { who: "info", text: "This label was cancelled. Don't ship it." };
  }
  if (!l.label_url) return { who: "info", text: "Your shipping label is being made." };
  const by = shipByWords(l.ship_by);
  return l.packed_at
    ? { who: "you", text: "Drop it off at USPS", by: by ? `by ${by}` : null }
    : { who: "you", text: "Print the label and pack it", by: by ? `Ship by ${by}` : null };
}

export function ShipOrderPanel({ orderId, side }: { orderId: string; side: "buyer" | "seller" }) {
  return side === "seller" ? <SellerShip orderId={orderId} /> : <BuyerShip orderId={orderId} />;
}

function SellerShip({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const label = useQuery({ queryKey: shipLabelKey(orderId), queryFn: () => fetchMyShipLabel(orderId) });
  const pack = useMutation({
    mutationFn: () => markPacked(orderId),
    onSuccess: () => {
      toast("Marked packed.");
      void qc.invalidateQueries({ queryKey: shipLabelKey(orderId) });
    },
    onError: (e) => toast.error(declutterErrorMessage(e)),
  });
  if (label.isPending) return <HelprSpinner />;
  if (label.isError) {
    return <ErrorState variant="inline" title="We couldn't load the label." body={declutterErrorMessage(label.error)} onRetry={() => void label.refetch()} />;
  }
  const l = label.data;
  const canPack = !!l.label_url && !l.packed_at && !l.accepted_at;
  return (
    <div className="space-y-2" data-ship-panel="seller">
      <OrderSteps facts={{ handover: "ship", side: "seller", booked: false, packed: !!l.packed_at, pickedUp: !!l.accepted_at, delivered: !!l.delivered_at, done: l.order_status === "handed_over" }} />
      <NextStep value={sellerShipNext(l)} className="!text-ds-14" />
      {l.tracking_code && <p className="text-ds-13 text-muted-foreground">Tracking <span className="font-mono">{l.tracking_code}</span></p>}
      {l.label_url && !l.accepted_at && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button type="button" className={outline} onClick={() => void openExternalUrl(l.label_url as string)} data-print-label="">
            Print label
          </button>
          {canPack && (
            <button type="button" className={primary} disabled={pack.isPending} onClick={() => pack.mutate()} data-packed="">
              Packed
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BuyerShip({ orderId }: { orderId: string }) {
  // The card head reads the same key (useBuyingTracker), so this is no second read.
  const t = useQuery({ queryKey: shipTrackingKey(orderId), queryFn: () => fetchMyShipTracking(orderId) });
  if (t.isPending) return null;
  if (t.isError) {
    return <ErrorState variant="inline" title="We couldn't load the tracking." body={declutterErrorMessage(t.error)} onRetry={() => void t.refetch()} />;
  }
  const code = t.data.tracking_code;
  if (!code) return <p className="text-ds-13 text-muted-foreground" data-ship-panel="buyer">The tracking number shows here once the label is made.</p>;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3" data-ship-panel="buyer">
      <p className="text-ds-13 text-muted-foreground">USPS tracking <span className="font-mono">{code}</span></p>
      <button type="button" className={`${outline} ml-auto`} onClick={() => void openExternalUrl(uspsTrackingUrl(code))} data-track="">
        Track
      </button>
    </div>
  );
}
