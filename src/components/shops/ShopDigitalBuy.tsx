/**
 * Buy a digital download from a shop's page (owner 11-08; migrations 20261108182917 + 20261108185110).
 *
 * Website: Buy asks for the buyer's billing address (a download's sales tax is figured where the buyer lives) and
 * opens the Stripe page (shop-checkout 'buy_digital'). After paying, the download is in Shops > My orders.
 *
 * iPhone app: Buy opens this same page on louisianahelpr.com, where the buyer pays by card. No Apple in-app purchase.
 * This is the one place the app branches on the platform, because the App Store rule is platform-specific: App Review
 * Guideline 3.1.1(a) says the purchase-link entitlements "are not required for developers to include buttons,
 * external links, or other calls to action in their United States storefront apps", and 3.1.3 lets apps on the United
 * States storefront encourage other purchase methods (both as revised after the 2025 Epic v. Apple injunction; text
 * read on developer.apple.com/app-store/review/guidelines on 2026-11-08). shop-checkout also refuses a download page
 * asked for by the app itself.
 *
 * The server re-checks every rule; nothing here is the protection.
 */
import { useEffect, useId, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isNativePlatform } from "@/lib/nativeInit";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { fetchShopItems, formatItemPrice, type ShopItem } from "@/lib/shops/items";
import { buyerFeeCents, formatCents, requestDigitalPurchase, SHOP_SERVICE_FEE_INCLUDED } from "@/lib/shops/orders";
import { billingAddressProblem, digitalBuyUrl, type BillingAddress } from "@/lib/shops/digitalFiles";
import { shopsErrorMessage } from "@/lib/shops/errors";

export default function ShopDigitalBuy({ shopId }: { shopId: string }) {
  const headId = useId();
  const [params] = useSearchParams();
  const items = useQuery({ queryKey: ["shops", "items", shopId], queryFn: () => fetchShopItems(shopId), enabled: !!shopId });
  const downloads = (items.data ?? []).filter((i) => i.kind === "digital" && i.status === "live");
  const [picked, setPicked] = useState<ShopItem | null>(null);
  const [addr, setAddr] = useState<BillingAddress>({ line1: "", city: "", state: "LA", postal_code: "" });
  const [opening, setOpening] = useState(false);

  // The app's link-out lands here with ?buy=<item>: open that item's address step.
  const buyParam = params.get("buy");
  useEffect(() => {
    if (!buyParam || picked || isNativePlatform) return;
    const hit = downloads.find((d) => d.id === buyParam);
    if (hit) setPicked(hit);
  }, [buyParam, downloads, picked]);

  if (downloads.length === 0) return null;

  const tapBuy = (item: ShopItem) => {
    if (isNativePlatform) {
      void openExternalUrl(digitalBuyUrl(shopId, item.id)).catch(() => toast.error("We couldn't open the website. Please try again."));
      return;
    }
    setPicked(item);
  };

  const pay = async () => {
    if (!picked) return;
    const problem = billingAddressProblem(addr);
    if (problem) {
      toast.error(problem);
      return;
    }
    setOpening(true);
    try {
      const url = await requestDigitalPurchase(picked.id, { ...addr, state: addr.state.trim().toUpperCase() });
      await openExternalUrl(url);
    } catch (err) {
      toast.error(shopsErrorMessage(err));
      setOpening(false);
    }
  };

  return (
    <section className="space-y-3" aria-labelledby={headId} data-testid="shop-digital-buy">
      <h2 id={headId} className="text-sm font-semibold">Downloads</h2>
      <ul className="space-y-2">
        {downloads.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-border p-3">
            <FileDown className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{d.title}</p>
              <p className="text-xs text-muted-foreground">Digital download · yours to keep</p>
            </div>
            <Button type="button" className="btn-grad-primary" onClick={() => tapBuy(d)} disabled={opening}>
              Buy · {formatItemPrice(d.price_cents)}
            </Button>
          </li>
        ))}
      </ul>
      {picked && !isNativePlatform && (
        <div className="space-y-3 rounded-2xl border border-border p-4" data-testid="shop-digital-billing">
          <p className="text-sm font-medium">{picked.title}</p>
          <p className="text-sm">
            {`You pay ${formatCents(picked.price_cents + buyerFeeCents(picked.price_cents))} plus sales tax where you live. ${SHOP_SERVICE_FEE_INCLUDED}`} You can download it in Shops &gt; My orders as soon as you pay.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="dl-line1">Billing street address</Label>
            <Input id="dl-line1" autoComplete="billing address-line1" value={addr.line1} onChange={(e) => setAddr((a) => ({ ...a, line1: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="dl-city">City</Label>
              <Input id="dl-city" autoComplete="billing address-level2" value={addr.city} onChange={(e) => setAddr((a) => ({ ...a, city: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dl-state">State</Label>
              <Input id="dl-state" autoComplete="billing address-level1" maxLength={2} value={addr.state} onChange={(e) => setAddr((a) => ({ ...a, state: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dl-zip">ZIP code</Label>
              <Input id="dl-zip" inputMode="numeric" autoComplete="billing postal-code" maxLength={5} value={addr.postal_code} onChange={(e) => setAddr((a) => ({ ...a, postal_code: e.target.value }))} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={() => setPicked(null)} disabled={opening}>Cancel</Button>
            <Button type="button" className="btn-grad-primary" onClick={() => void pay()} disabled={opening}>
              {opening ? "Opening…" : "Continue to payment"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
