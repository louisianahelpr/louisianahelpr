/**
 * The moving-sale banner on a seller's profile (/user/:id), moving-out mode
 * (docs/specs/declutter-moving-out.md): the move-out date over the seller's
 * moving-sale items that are for sale now. Nothing at all unless both hidden
 * switches are on for the viewer and the seller has such items. Never the
 * address (spec row 27). It shows the exact move-out date (owner, 2026-10-17)
 * and nothing once that date has passed; spec M6 (spec row 27, M6).
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Share2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shareNative } from "@/lib/nativeShare";
import { getPublicOrigin } from "@/lib/authRedirects";
import { useFeature } from "@/hooks/useFeature";
import { fetchPhotos, photoPublicUrl } from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/distance";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { fetchSellerMovingSale, louisianaToday, movingSaleLine } from "@/lib/declutter/movingSale";

const SHOWN = 6;

export function MovingSaleBanner({ sellerId }: { sellerId: string }) {
  const declutter = useFeature("declutter");
  const moving = useFeature("declutter_moving_out");
  const on = declutter && moving;
  const [all, setAll] = useState(false);
  const sale = useQuery({ queryKey: ["declutter", "moving-sale", sellerId], queryFn: () => fetchSellerMovingSale(sellerId), enabled: on });
  const ids = (sale.data?.items ?? []).map((i) => i.id);
  const photos = useQuery({ queryKey: ["declutter", "photos", ids.join(",")], queryFn: () => fetchPhotos(ids), enabled: on && ids.length > 0 });
  // Shown only once there is something to show: no loading or error frame
  // for a section most profiles never have (its absence is the empty state).
  if (!on || !sale.data || photos.isLoading) return null;
  const cover = new Map<string, string>();
  for (const p of photos.data ?? []) if (!cover.has(p.item_id)) cover.set(p.item_id, p.storage_path);
  const items = all ? sale.data.items : sale.data.items.slice(0, SHOWN);
  // The area buyers already see on each listing (never an address), when the items agree on one.
  const areas = new Set(sale.data.items.map((i) => i.area_label).filter(Boolean));
  const area = areas.size === 1 ? [...areas][0] : null;
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-labelledby="moving-sale-title" data-testid="moving-sale-banner">
      <div className="flex items-start gap-3">
        <Truck className="h-5 w-5 shrink-0 mt-1" aria-hidden />
        <div className="min-w-0">
          <h2 id="moving-sale-title" className="text-ds-22 font-bold leading-snug">Moving sale</h2>
          <p className="text-ds-13 text-muted-foreground [overflow-wrap:anywhere]">
            {area ? `${area} · ` : ""}{movingSaleLine(sale.data.moveOutOn, sale.data.items.length, louisianaToday(), sale.data.more)}
          </p>
        </div>
      </div>
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {items.map((it) => (
          <li key={it.id} className="min-w-0">
            <Link
              to={`/declutter/item/${it.id}`}
              className="block rounded-2xl border border-border bg-background p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="aspect-square overflow-hidden rounded-xl bg-photo-empty">
                {cover.get(it.id) ? (
                  <img src={photoPublicUrl(cover.get(it.id)!)} alt="" loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <PhotoPlaceholder icon={categoryIcon(it.category)} seed={it.category} className="h-full w-full" />
                )}
              </div>
              <div className="px-1 pt-2 min-w-0">
                <p className="text-ds-15 font-bold tabular-nums text-[hsl(var(--burnt-sienna))]">{formatPrice(it.current_price_cents)}</p>
                <p className="text-ds-13 font-semibold truncate" title={it.title}>{it.title}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {sale.data.items.length > SHOWN && (
          <button type="button" className="min-h-11 px-2 text-sm font-semibold underline" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${sale.data.items.length}`}
          </button>
        )}
        {/* Board 164's "Share sale": the seller's profile, where this sale lives. ("Follow sale" does not exist yet.) */}
        <Button
          type="button"
          variant="outline"
          onClick={() => void shareNative({ title: "Moving sale", text: "A moving sale on Louisiana Helpr", url: `${getPublicOrigin()}/user/${sellerId}` })}
        >
          <Share2 className="h-4 w-4" aria-hidden />
          Share sale
        </Button>
      </div>
    </section>
  );
}
