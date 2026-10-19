/**
 * SH12 (lead 2026-10-19): an Etsy-style "Shop policies" card on the shop page,
 * for members and for anyone with the link. One short line per rule, in the
 * order sheet's own words (shopPolicyLines -> cancelPolicyText, ORDER_HOLD_TEXT).
 * Only for a shop that sells. Sits near the end of the page with the FAQs, so
 * arriving on its own moves nothing above it.
 */
import { useQuery } from "@tanstack/react-query";
import { CalendarX2, CreditCard } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchShopPolicies, shopPolicyLines } from "@/lib/shops/faqs";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { ShopCard } from "./ShopProfile";

export default function ShopPolicies({ shopId }: { shopId: string }) {
  const policies = useQuery({ queryKey: ["shops", "policies", shopId], queryFn: () => fetchShopPolicies(shopId) });
  if (policies.isError && !policies.data) {
    return (
      <ShopCard id="shop-policies" title="Shop policies">
        <ErrorState variant="inline" title="We couldn't load this shop's policies." body={shopsErrorMessage(policies.error)} onRetry={() => void policies.refetch()} />
      </ShopCard>
    );
  }
  if (!policies.data) return null;
  return (
    <ShopCard id="shop-policies" title="Shop policies">
      <ul className="space-y-2">
        {shopPolicyLines(policies.data).map((l) => (
          <li key={l.key} className="flex gap-2.5 text-sm" data-testid={`shop-policy-${l.key}`}>
            {l.key === "cancel" ? <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
            <p className="min-w-0"><span className="font-semibold">{l.label}:</span> <span className="text-muted-foreground">{l.text}</span></p>
          </li>
        ))}
      </ul>
    </ShopCard>
  );
}
