/**
 * SH12: a shop's FAQs on its page, for members (ShopView) and for anyone with
 * the link (PublicShopView); one read, shops_shop_faqs, which answers only
 * for a shop the viewer may see. Sits at the END of the page, so arriving on
 * its own moves nothing above it. No FAQs, no card.
 */
import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { fetchShopFaqs } from "@/lib/shops/faqs";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { ShopCard } from "./ShopProfile";

export default function ShopFaqs({ shopId }: { shopId: string }) {
  // One heading id per instance (A0-L1): the error card and the list never share a literal.
  const headId = useId();
  const faqs = useQuery({ queryKey: ["shops", "faqs", shopId], queryFn: () => fetchShopFaqs(shopId) });
  if (faqs.isError && !faqs.data) {
    return (
      <ShopCard id={headId} title="Questions">
        <ErrorState variant="inline" title="We couldn't load this shop's questions." body={shopsErrorMessage(faqs.error)} onRetry={() => void faqs.refetch()} />
      </ShopCard>
    );
  }
  const list = faqs.data ?? [];
  if (list.length === 0) return null;
  return (
    <ShopCard id={headId} title="Questions">
      <ul className="divide-y divide-border">
        {list.map((f, i) => (
          <li key={i}>
            <details className="group py-2">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <span className="[overflow-wrap:anywhere]">{f.question}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="pb-1 text-sm text-muted-foreground whitespace-pre-line [overflow-wrap:anywhere]">{f.answer}</p>
            </details>
          </li>
        ))}
      </ul>
    </ShopCard>
  );
}
