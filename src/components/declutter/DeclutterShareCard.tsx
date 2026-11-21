/**
 * Board 192, after listing: "Copy link for local groups" with a preview of the
 * link card. Shown only for a LIVE listing (never paused or waiting for a
 * review: the link would open a page buyers can't use). The link is the
 * item's public page; the preview shows the area buyers see, never the
 * pickup address (that is shared after payment).
 *
 * Q2426 (owner 2026-10-27), share to Facebook: the seller's own live listing
 * carries ShareListingRow. The link card a group shows (photo, title, price or
 * Free, town) is built server-side by api/share.ts from
 * declutter_public_item_card (20261027194426).
 *
 * Selling boost (owner 11-20): ShareListingRow is now "Share to Facebook" (one
 * tap: the phone's share sheet, or Facebook's share dialog on a computer, a
 * blocked pop-up copies the link), "Copy link", and the "Share to your local
 * groups" tip with a post to paste. It shows on the item page and in the sheet
 * right after listing ("Share your listing"). Every tap records
 * declutter_share_click with its method only (listingShare.ts).
 */
import { useQuery } from "@tanstack/react-query";
import { Copy, Link2, Share2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { fetchPhotos, photoPublicUrl } from "@/lib/declutter/api";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { copyToClipboard, shareNative } from "@/lib/nativeShare";
import { getPublicOrigin } from "@/lib/authRedirects";
import { isNativePlatform } from "@/lib/nativeInit";
import { facebookShareUrl, groupPostText, listingUrl, plainSharePath, readShareEnv, shareToFacebookPath, trackShareClick, type ShareSurface } from "@/lib/declutter/listingShare";
import { t, useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enDeclutter";
import { FallbackImg } from "./FallbackImg";

export interface ShareableListing {
  id: string;
  title: string;
  current_price_cents: number;
  area_label: string;
  category: string;
  status: string;
}

const listingLink = (id: string) => listingUrl(getPublicOrigin(), id);

/** Copy the public link; if the clipboard refuses, the shared share path surfaces it instead. */
async function copyListingLink(it: ShareItem, surface: ShareSurface = "listed"): Promise<void> {
  trackShareClick("copy", surface);
  const url = listingLink(it.id);
  if (await copyToClipboard(url)) {
    toast(t("decl.share.copied"));
    return;
  }
  await shareNative({ title: it.title, text: shareText(it), url });
}

const shareText = (it: Pick<ShareableListing, "title" | "current_price_cents">) =>
  `${it.title} · ${itemPriceLabel(it.current_price_cents)} on Louisiana Helpr`;

type ShareItem = Pick<ShareableListing, "id" | "title" | "current_price_cents"> & { area_label?: string | null };

/** The phone's share sheet (Facebook, Messenger, texts), else copy the link: the item's own address. */
export function shareListing(it: Pick<ShareableListing, "id" | "title" | "current_price_cents">, surface: ShareSurface = "item"): void {
  // Synchronous: shareNative must reach navigator.share with no await before it (user activation).
  trackShareClick(plainSharePath(readShareEnv(isNativePlatform)), surface);
  void shareNative({ title: it.title, text: shareText(it), url: listingLink(it.id) });
}

/** Owner request 11-05: the Share button on each of the seller's live listings (Selling → Your listings). */
export function ListingShareButton({ item }: { item: Pick<ShareableListing, "id" | "title" | "current_price_cents"> }) {
  return (
    // Design audit 11-17 #20: a 44px icon button beside the row's one labelled button (Manage).
    <Button type="button" variant="outline" size="iconCompact" className="rounded-full" aria-label={`Share ${item.title}`} data-listing-share="" onClick={() => shareListing(item, "listings")}>
      <Share2 aria-hidden /><span className="sr-only">Share</span>
    </Button>
  );
}

/**
 * One tap on "Share to Facebook" (selling boost, owner 11-20). On a phone (the app, or a touch browser with a share
 * sheet) it opens the share sheet, where Facebook, Messenger and the groups are. On a computer it opens Facebook's own
 * share dialog for the item's link in a new tab. A blocked pop-up copies the link instead, so the tap always does
 * something.
 */
function shareListingToFacebook(it: ShareItem, surface: ShareSurface): void {
  const url = listingLink(it.id);
  if (shareToFacebookPath(readShareEnv(isNativePlatform)) === "native") {
    trackShareClick("native", surface);
    void shareNative({ title: it.title, text: shareText(it), url });
    return;
  }
  trackShareClick("facebook", surface);
  const win = window.open(facebookShareUrl(url), "_blank", "noopener,noreferrer");
  // A blocked pop-up opens nothing: the share ladder copies the link (no share sheet on a computer) so the tap still works.
  if (!win) void shareNative({ text: url, url });
}

/** "Share to your local groups": a short post to paste, with its own Copy button. */
function GroupPostTip({ item, surface }: { item: ShareItem; surface: ShareSurface }) {
  const { t: tr } = useLanguage();
  const post = groupPostText(item, listingLink(item.id));
  const copyPost = async () => {
    trackShareClick("copy", surface);
    if (await copyToClipboard(post)) {
      toast(tr("decl.share.postCopied"));
      return;
    }
    await shareNative({ text: post });
  };
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-muted/40 p-3" data-group-post-tip="">
      <p className="flex items-center gap-1.5 text-ds-14 font-semibold">
        <Users className="h-4 w-4 shrink-0" aria-hidden />
        {tr("decl.share.tipTitle")}
      </p>
      <p className="text-ds-13 text-muted-foreground">{tr("decl.share.tipBody")}</p>
      <p className="rounded-xl bg-card px-3 py-2 text-ds-13 [overflow-wrap:anywhere]" data-group-post-text="">{post}</p>
      <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => void copyPost()}>
        <Copy className="mr-1.5 h-4 w-4" aria-hidden />
        {tr("decl.share.copyPost")}
      </Button>
    </div>
  );
}

/**
 * The seller's own live listing (Q2426; selling boost, owner 11-20): "Share to Facebook" (one tap: the phone's share
 * sheet, or Facebook's share dialog on a computer), "Copy link", and the group-post tip.
 */
export function ShareListingRow({ item, surface = "item" }: { item: ShareItem; surface?: ShareSurface }) {
  const { t: tr } = useLanguage();
  return (
    <div className="space-y-3" data-share-row="">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => shareListingToFacebook(item, surface)}>
          <Share2 className="mr-1.5 h-4 w-4" aria-hidden />
          {tr("decl.share.facebook")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void copyListingLink(item, surface)}>
          <Link2 className="mr-1.5 h-4 w-4" aria-hidden />
          {tr("decl.share.copy")}
        </Button>
      </div>
      <GroupPostTip item={item} surface={surface} />
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
