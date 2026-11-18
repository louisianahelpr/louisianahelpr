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
import { RadioCardList } from "@/components/ui/RadioCardList";
import { deliveryFeeProblem, DELIVERY_RADIUS_MAX_MILES, fetchDeliveryOffer, setDeliveryOffer, setHelprDelivery, type DeliveryOffer } from "@/lib/shops/delivery";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { ShopSettingSaved } from "./shopSettingsUi";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enShopsBrowse";

export default function ShopDeliveryPicker({ shopId }: { shopId: string }) {
  const { t } = useLanguage();
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
    // No success toast (the app-wide toast policy); the shared inline "Saved" line says it (Area 07 M5).
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
  const feeProblem = fee.trim() === "" || !Number.isFinite(feeCents) ? t("shb.set.priceProblem") : deliveryFeeProblem(feeCents);
  const radiusProblem = Number.isInteger(miles) && miles >= 1 && miles <= DELIVERY_RADIUS_MAX_MILES ? null : t("shb.set.milesProblem", { max: DELIVERY_RADIUS_MAX_MILES });
  const canSave = !save.isPending && feeProblem === null && radiusProblem === null;
  // Area 07 M5: "Pickup only" is a radio card that saves on tap, like every other shop setting (same payload the old
  // Save sent with delivery off: the stored price and miles stay as they were). "I deliver" opens the price and miles;
  // those are typed, so they keep one button, shown only until what is typed matches what is saved.
  const pickDelivers = (on: boolean) => {
    setDelivers(on);
    if (!on && offer.data?.delivers && !save.isPending) {
      save.mutate({ delivers: false, fee_cents: offer.data.fee_cents, radius_miles: offer.data.radius_miles });
    }
  };
  const unsaved = delivers && (!offer.data?.delivers || feeCents !== offer.data.fee_cents || miles !== offer.data.radius_miles);

  return (
    <section className="space-y-2" aria-labelledby="shop-delivery-offer">
      <h3 id="shop-delivery-offer" className="text-ds-13 font-semibold">{t("shb.set.deliveryTitle")}</h3>
      <p className="text-ds-11 text-muted-foreground">{t("shb.set.deliverySub")}</p>
      {offer.isLoading ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : offer.isError ? (
        <ErrorState variant="inline" title={t("shb.set.loadFailed")} body={shopsErrorMessage(offer.error)} onRetry={() => void offer.refetch()} />
      ) : (
        <div className="space-y-3">
          <RadioCardList
            label={t("shb.set.deliverQ")}
            options={[
              { value: "pickup", label: t("shb.set.pickupOnly"), sub: t("shb.set.pickupOnlySub") },
              { value: "deliver", label: t("shb.set.iDeliver"), sub: t("shb.set.iDeliverSub") },
            ]}
            value={delivers ? "deliver" : "pickup"}
            onChange={(v) => pickDelivers(v === "deliver")}
          />
          {delivers ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="shop-delivery-price">{t("shb.set.price")}</Label>
                <Input id="shop-delivery-price" inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)}
                  aria-invalid={feeProblem !== null} aria-describedby="shop-delivery-price-help" />
                <p id="shop-delivery-price-help" className="text-ds-11 text-muted-foreground">{feeProblem ?? t("shb.set.priceHelp")}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="shop-delivery-radius">{t("shb.set.miles")}</Label>
                <Input id="shop-delivery-radius" inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)}
                  aria-invalid={radiusProblem !== null} aria-describedby="shop-delivery-radius-help" />
                <p id="shop-delivery-radius-help" className="text-ds-11 text-muted-foreground">{radiusProblem ?? t("shb.set.milesHelp")}</p>
              </div>
            </div>
          ) : null}
          {unsaved ? (
            <Button type="button" variant="outline" disabled={!canSave} data-testid="shop-delivery-save"
              onClick={() => save.mutate({ delivers: true, fee_cents: feeCents, radius_miles: miles })}>
              {save.isPending ? t("shb.set.saving") : t("shb.set.saveDelivery")}
            </Button>
          ) : null}
          <ShopSettingSaved show={save.isSuccess && !unsaved} />
          <div className="space-y-2 border-t border-border pt-3" data-testid="shop-helpr-delivery">
            <p className="text-ds-13 font-semibold">{t("shb.set.helprTitle")}</p>
            <p className="text-ds-11 text-muted-foreground">{t("shb.set.helprSub")}</p>
            <RadioCardList
              label={t("shb.set.helprTitle")}
              options={[
                { value: "off", label: t("shb.set.helprOff"), sub: t("shb.set.helprOffSub") },
                { value: "on", label: t("shb.set.helprOn"), sub: t("shb.set.helprOnSub") },
              ]}
              value={offer.data?.helpr_delivery === true ? "on" : "off"}
              onChange={(v) => {
                const on = v === "on";
                if (on !== (offer.data?.helpr_delivery === true) && !helpr.isPending) helpr.mutate(on);
              }}
            />
            <ShopSettingSaved show={helpr.isSuccess} />
          </div>
        </div>
      )}
    </section>
  );
}
