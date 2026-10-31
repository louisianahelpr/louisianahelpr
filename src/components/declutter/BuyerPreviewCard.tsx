/** What buyers will see, on the single form and on each item of a bunch: the cover, the title and the price. */
import { itemPriceLabel } from "@/lib/declutter/distance";
import { FallbackImg } from "./FallbackImg";

export function BuyerPreviewCard({ src, title, cents }: { src: string | null | undefined; title: string; cents: number | null }) {
  return (
    <div className="flex items-center gap-3 rounded-[20px] border border-border bg-card p-3" data-sell-preview="">
      {src && <FallbackImg src={src} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />}
      <div className="min-w-0 flex-1">
        <p className="text-ds-13 text-muted-foreground">What buyers see</p>
        <p className="truncate text-ds-15 font-bold text-foreground">{title}</p>
        {cents != null && <p className="text-ds-15 font-bold text-[hsl(var(--burnt-sienna))]">{itemPriceLabel(cents)}</p>}
      </div>
    </div>
  );
}
