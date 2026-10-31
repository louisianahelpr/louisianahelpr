/**
 * Board 192, after listing: "Copy link for local groups" with a preview of the
 * link card. Shown only for a LIVE listing (never paused or waiting for a
 * review: the link would open a page buyers can't use). The link is the
 * item's public page; the preview shows the area buyers see, never the
 * pickup address (that is shared after payment).
 *
 * Q2426 (owner 2026-10-27), share to Facebook: the seller's own live listing
 * carries ShareListingRow, "Share this item" (the phone's share sheet, where
 * Facebook, Messenger and the groups are) and "Post to Facebook" (Facebook's
 * own share page with the link, one tap on every device). The link card a
 * group shows (photo, title, price or Free, town) is built server-side by
 * api/share.ts from declutter_public_item_card (20261027194426).
 */
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { fetchPhotos, photoPublicUrl } from "@/lib/declutter/api";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { copyToClipboard, shareNative } from "@/lib/nativeShare";
import { getPublicOrigin } from "@/lib/authRedirects";
import { isNativePlatform } from "@/lib/nativeInit";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { FallbackImg } from "./FallbackImg";

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
    toast("Link copied. Paste it in your local groups.");
    return;
  }
  await shareNative({ title: it.title, text: shareText(it), url });
}

const shareText = (it: Pick<ShareableListing, "title" | "current_price_cents">) =>
  `${it.title} · ${itemPriceLabel(it.current_price_cents)} on Louisiana Helpr`;

/** The phone's share sheet (Facebook, Messenger, texts), else copy the link: the item's own address. */
export function shareListing(it: Pick<ShareableListing, "id" | "title" | "current_price_cents">): void {
  void shareNative({ title: it.title, text: shareText(it), url: listingLink(it.id) });
}

/** Facebook's own share page for the item's link: its card is the item (api/share.ts). */
function facebookShareUrl(itemId: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(listingLink(itemId))}`;
}

/** One tap to Facebook: a new tab on the web, the in-app browser sheet in the app (the app stays underneath). */
function postListingToFacebook(itemId: string): void {
  const url = facebookShareUrl(itemId);
  if (isNativePlatform) {
    void openExternalUrl(url);
    return;
  }
  const win = window.open(url, "_blank", "noopener,noreferrer");
  // A blocked pop-up opens nothing: fall back to the share sheet / copy so the tap still does something.
  if (!win) void shareNative({ text: url, url: listingLink(itemId) });
}

/** "Share this item" + "Post to Facebook" on the seller's own live listing (Q2426). */
export function ShareListingRow({ item }: { item: Pick<ShareableListing, "id" | "title" | "current_price_cents"> }) {
  return (
    <div className="flex flex-wrap gap-2" data-share-row="">
      <Button type="button" size="sm" variant="outline" onClick={() => shareListing(item)}>
        <Share2 className="mr-1.5 h-4 w-4" aria-hidden />
        Share this item
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => postListingToFacebook(item.id)}>
        <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden />
        Post to Facebook
      </Button>
    </div>
  );
}

/** The preview of what a neighbor sees when the link is pasted. */
export function ListingLinkCard({ item }: { item: ShareableListing }) {
  const photos = useQuery({ queryKey: ["declutter", "item-photos", item.id], queryFn: () => fetchPhotos([item.id]) });
  const cover = photos.data?.[0]?.storage_path ? photoPublicUrl(photos.data[0].storage_path) : null;
  return (
    <div className="mt-3 flex items-center gap-3 rounded-2xl border border-border bg-card p-3" data-link-card="" role="group" aria-label="Preview of the link">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl">
        {cover ? (
          <FallbackImg src={cover} alt="" className="h-full w-full object-cover"
            fallback={<PhotoPlaceholder icon={categoryIcon(item.category)} seed={item.category} className="h-full w-full" />} />
        ) : (
          <PhotoPlaceholder icon={categoryIcon(item.category)} seed={item.category} className="h-full w-full" />
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-ds-14 font-semibold" title={item.title}>
          {item.title} · <span className="tabular-nums">{itemPriceLabel(item.current_price_cents)}</span>
        </p>
        <p className="truncate text-ds-13 text-muted-foreground">{item.area_label} · on Louisiana Helpr</p>
      </div>
    </div>
  );
}
