/**
 * The shop's own delivery offer (Shops delivery slice 1, migration 20261106180902; owner 11-05 answer 3). Its own
 * file and query so the dashboard keeps one loading gate, as ShopHandoverModePicker does.
 * Free, or a whole-dollar fee from $5 to $150, within 1 to 50 miles of the shop's pin. The server re-checks it.
 *
 * Helpr delivery (slice 3; shops_set_helpr_delivery, 20261106194913): the shop can also let a Helpr deliver, at
 * Declutter's price for the road miles (the buyer pays it). Needs the pickup address found on the map first.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { deliveryFeeProblem, DELIVERY_RADIUS_MAX_MILES, fetchDeliveryOffer, setDeliveryOffer, setHelprDelivery, type DeliveryOffer } from "@/lib/shops/delivery";
import { shopsErrorMessage } from "@/lib/shops/errors";

export default function ShopDeliveryPicker({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const offer = useQuery({ queryKey: ["shops", "delivery-offer", shopId], queryFn: () => fetchDeliveryOffer(shopId) });
  const [delivers, setDelivers] = useState(false);
  const [fee, setFee] = useState("0");
  const [radius, setRadius] = useState("10");
  useEffect(() => {
    if (!offer.data) return;
    setDelivers(offer.data.delivers);
    setFee(String(offer.data.fee_cents / 100));
    setRadius(String(offer.data.radius_miles));
  }, [offer.data]);
  const save = useMutation({
    mutationFn: (o: DeliveryOffer) => setDeliveryOffer(o),
    // No success toast: the app-wide toast policy drops toast.success without an action (declutterHandoverConfirmationsShow ceiling).
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shops", "delivery-offer", shopId] });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  const helpr = useMutation({
    mutationFn: (on: boolean) => setHelprDelivery(on),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shops", "delivery-offer", shopId] });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  const feeCents = Math.round(Number(fee) * 100);
  const miles = Number(radius);
  const feeProblem = fee.trim() === "" || !Number.isFinite(feeCents) ? "Enter a fee, or 0 for free." : deliveryFeeProblem(feeCents);
  const radiusProblem = Number.isInteger(miles) && miles >= 1 && miles <= DELIVERY_RADIUS_MAX_MILES ? null : `Use 1 to ${DELIVERY_RADIUS_MAX_MILES} miles.`;
  const canSave = !save.isPending && (!delivers || (feeProblem === null && radiusProblem === null));

  return (
    <section className="space-y-2" aria-labelledby="shop-delivery-offer">
      <h2 id="shop-delivery-offer" className="text-ds-13 font-semibold">Delivery</h2>
      <p className="text-ds-11 text-muted-foreground">You deliver the order yourself. Orders already placed keep the delivery they were placed with.</p>
      {offer.isLoading ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : offer.isError ? (
        <ErrorState variant="inline" title="We couldn't load this setting." body={shopsErrorMessage(offer.error)} onRetry={() => void offer.refetch()} />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Do you deliver?">
            {[false, true].map((on) => (
              <Button key={String(on)} type="button" variant={delivers === on ? "default" : "outline"}
                className={delivers === on ? "btn-grad-primary" : ""} aria-pressed={delivers === on} onClick={() => setDelivers(on)}>
                {on ? "I deliver" : "Pickup only"}
              </Button>
            ))}
          </div>
          {delivers ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="shop-delivery-price">Delivery price ($)</Label>
                <Input id="shop-delivery-price" inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)}
                  aria-invalid={feeProblem !== null} aria-describedby="shop-delivery-price-help" />
                <p id="shop-delivery-price-help" className="text-ds-11 text-muted-foreground">{feeProblem ?? "0 for free, or $5 to $150."}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="shop-delivery-radius">Up to (miles)</Label>
                <Input id="shop-delivery-radius" inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)}
                  aria-invalid={radiusProblem !== null} aria-describedby="shop-delivery-radius-help" />
                <p id="shop-delivery-radius-help" className="text-ds-11 text-muted-foreground">{radiusProblem ?? "Road miles from your shop."}</p>
              </div>
            </div>
          ) : null}
          <Button type="button" variant="outline" disabled={!canSave}
            onClick={() => save.mutate({ delivers, fee_cents: delivers ? feeCents : offer.data?.fee_cents ?? 0, radius_miles: delivers ? miles : offer.data?.radius_miles ?? 10 })}>
            {save.isPending ? "Saving…" : "Save delivery"}
          </Button>
          <div className="space-y-2 border-t border-border pt-3" data-testid="shop-helpr-delivery">
            <p className="text-ds-13 font-semibold">Helpr delivery</p>
            <p className="text-ds-11 text-muted-foreground">
              A Helpr picks the order up at your pickup address and delivers it within 50 miles. The buyer pays $6 plus $1.50 a mile; you get your items' price as usual.
            </p>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Helpr delivery">
              {[false, true].map((on) => {
                const active = (offer.data?.helpr_delivery === true) === on;
                return (
                  <Button key={String(on)} type="button" variant={active ? "default" : "outline"}
                    className={active ? "btn-grad-primary" : ""} aria-pressed={active} disabled={helpr.isPending}
                    onClick={() => { if (!active) helpr.mutate(on); }}>
                    {on ? "Offer it" : "Don't offer"}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
