/**
 * Board 192, after listing: "Copy link for local groups" with a preview of the
 * link card. Shown only for a LIVE listing (never paused or waiting for a
 * review: the link would open a page buyers can't use). The link is the
 * item's public page; the preview shows the area buyers see, never the
 * pickup address (that is shared after payment).
 */
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { fetchPhotos, photoPublicUrl } from "@/lib/declutter/api";
import { formatPrice } from "@/lib/declutter/distance";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { copyToClipboard, shareNative } from "@/lib/nativeShare";
import { getPublicOrigin } from "@/lib/authRedirects";

export interface ShareableListing {
  id: string;
  title: string;
  current_price_cents: number;
  area_label: string;
  category: string;
  status: string;
}

const listingLink = (id: string) => `${getPublicOrigin()}/declutter/item/${id}`;

/** Copy the public link; if the clipboard refuses, the shared share path surfaces it instead. */
export async function copyListingLink(it: ShareableListing): Promise<void> {
  const url = listingLink(it.id);
  if (await copyToClipboard(url)) {
    toast.success("Link copied. Paste it in your local groups.");
    return;
  }
  await shareNative({ title: it.title, text: `${it.title} · ${formatPrice(it.current_price_cents)} on Louisiana Helpr`, url });
}

/** The preview of what a neighbor sees when the link is pasted. */
export function ListingLinkCard({ item }: { item: ShareableListing }) {
  const photos = useQuery({ queryKey: ["declutter", "item-photos", item.id], queryFn: () => fetchPhotos([item.id]) });
  const cover = photos.data?.[0]?.storage_path ? photoPublicUrl(photos.data[0].storage_path) : null;
  return (
    <div className="mt-3 flex items-center gap-3 rounded-2xl border border-border bg-card p-3" data-link-card="" role="group" aria-label="Preview of the link">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl">
        {cover ? (
          <img src={cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <PhotoPlaceholder icon={categoryIcon(item.category)} seed={item.category} className="h-full w-full" />
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-ds-14 font-semibold" title={item.title}>
          {item.title} · <span className="tabular-nums">{formatPrice(item.current_price_cents)}</span>
        </p>
        <p className="truncate text-ds-13 text-muted-foreground">{item.area_label} · on Louisiana Helpr</p>
      </div>
    </div>
  );
}
