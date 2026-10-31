/** What buyers will see, on the single form and on each item of a bunch: the cover, the title and the price. */
import { itemPriceLabel } from "@/lib/declutter/distance";
import { FallbackImg } from "./FallbackImg";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { categoryIcon } from "@/lib/declutter/categoryIcons";

export function BuyerPreviewCard({ src, title, cents, category = null }: { src: string | null | undefined; title: string; cents: number | null; category?: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-[20px] border border-border bg-card p-3" data-sell-preview="">
      {/* With no cover yet, or while it loads, the tile shows the category on a tint, never a blank box (DA-15). */}
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl">
        <PhotoPlaceholder icon={categoryIcon(category)} seed={category} className="absolute inset-0 h-full w-full" />
        {src && <FallbackImg src={src} alt="" className="relative h-full w-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-ds-13 text-muted-foreground">What buyers see</p>
        <p className="truncate text-ds-15 font-bold text-foreground">{title}</p>
        {cents != null && <p className="text-ds-15 font-bold text-[hsl(var(--burnt-sienna))]">{itemPriceLabel(cents)}</p>}
      </div>
    </div>
  );
}
