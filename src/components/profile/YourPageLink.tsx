import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { copyToClipboard } from "@/lib/nativeShare";
import { MY_HANDLE_KEY, ensureMyHandle, fetchPublicProfile, profileLinkLabel, profileLinkUrl, shareMyProfile } from "@/lib/profileLink/api";
import "@/lib/i18n/enYourPage";
import { t } from "@/lib/i18n/language";


/**
 * "Your page: louisianahelpr.com/u/<handle>" with Copy and Share (owner 2026-11-04: profile links are made
 * at sign-up and easy to find, never something a member has to create). Shown on the member's own profile
 * and on Declutter's Selling tab. The handle comes from sign-up; rpc_ensure_my_handle only returns it (and
 * makes one for the rare member the sign-up trigger could not name). Changing it once stays in Settings
 * (ProfileLinkRow). Renders nothing until the handle is known, and nothing on a failed read.
 */
export function YourPageLink({ name, className = "", forSale = 0, knownHandle, slim = false }: { name?: string | null; className?: string; forSale?: number; knownHandle?: string | null; slim?: boolean }) {
  // A caller that already has the member's profile row (Home) passes its handle: no read at all.
  const { data: readHandle } = useQuery({
    enabled: !knownHandle,
    queryKey: MY_HANDLE_KEY,
    queryFn: async () => {
      const out = await ensureMyHandle();
      if (out.handle) return out.handle;
      throw new Error("handle_unavailable");
    },
    staleTime: 10 * 60_000,
  });
  const handle = knownHandle || readHandle;
  // F259k (audit 11-10, lead confirmed live): the card offered Copy and Share for a page that opened "This profile isn't
  // available" (public_profile_by_handle answers nothing for a hidden, restricted or test account). Ask the same read
  // the page uses (same cache key, so opening the page is instant); when it answers "no page", say so and offer no link
  // to share. A failed read keeps the card: a network blip must not hide a working link.
  const { data: publicPage } = useQuery({
    enabled: !!handle,
    queryKey: ["public-profile", handle],
    queryFn: () => fetchPublicProfile(handle as string),
    staleTime: 10 * 60_000,
  });
  if (!handle) return null;
  if (publicPage === null) {
    return (
      <p data-your-page-link="" data-your-page-hidden="" className={`text-ds-13 text-muted-foreground ${className}`}>
        {t("yp.hidden")}{" "}
        <Link to="/support?topic=message&subject=My%20profile%20page" className="link-standard font-semibold text-foreground">{t("yp.askWhy")}</Link>
      </p>
    );
  }
  const copy = async () => {
    if (await copyToClipboard(profileLinkUrl(handle))) toast(t("yp.copied"));
    else toast.error(t("yp.copyFailed"));
  };
  // F127 (UI audit 11-09; owner 11-05 placed the link on Home and leading Selling, "mine is kind of hidden"; lead 11-09:
  // keep it easy to find, but not a third full card): Selling's is ONE slim line, "Your page · Copy · Share", with the
  // same two actions. Home and You keep the card.
  if (slim) {
    return (
      <p data-your-page-link="" data-your-page-slim="" className={`flex min-w-0 flex-wrap items-center gap-x-1.5 text-ds-13 text-muted-foreground ${className}`}>
        <Link to={`/u/${encodeURIComponent(handle)}`} className="link-standard font-semibold text-foreground" aria-label={t("yp.pageAt", { link: profileLinkLabel(handle) })}>
          {t("yp.page")}
        </Link>
        <span aria-hidden>·</span>
        <InlineTextButton onClick={() => void copy()} data-your-page-copy="" aria-label={t("yp.copyLabel")} className="inline-flex items-center gap-1 font-semibold text-foreground">
          <Copy className="h-3.5 w-3.5" aria-hidden /> {t("yp.copy")}
        </InlineTextButton>
        <span aria-hidden>·</span>
        <InlineTextButton onClick={() => void shareMyProfile(handle, name)} data-your-page-share="" aria-label={t("yp.shareLabel")} className="inline-flex items-center gap-1 font-semibold text-foreground">
          <Share2 className="h-3.5 w-3.5" aria-hidden /> {t("yp.share")}
        </InlineTextButton>
      </p>
    );
  }
  // Owner request 11-05 ("mine is kind of hidden"): with something for sale, Selling leads with one clear
  // "Share your listings" button (the phone's share sheet; copy on a desktop browser), the way other marketplaces do.
  if (forSale > 0) {
    return (
      <section aria-label={t("yp.shareListings")} data-your-page-link="" data-share-listings="" className={`rounded-2xl border border-border bg-card px-4 py-3 flex flex-col gap-3 ${className}`}>
        <div className="min-w-0">
          <p className="text-ds-15 font-semibold">{forSale === 1 ? t("yp.forSale1") : t("yp.forSaleN", { n: forSale })}</p>
          <p className="text-ds-13 text-muted-foreground min-w-0">
            {t("yp.everything")}{" "}
            <Link to={`/u/${encodeURIComponent(handle)}`} className="link-standard font-semibold text-foreground break-all">
              {profileLinkLabel(handle)}
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="gap-1.5" onClick={() => void copy()} data-your-page-copy="">
            <Copy className="w-4 h-4" aria-hidden /> {t("yp.copyLink")}
          </Button>
          <Button type="button" className="gap-1.5" onClick={() => void shareMyProfile(handle, name)} data-your-page-share="">
            <Share2 className="w-4 h-4" aria-hidden /> {t("yp.shareListings")}
          </Button>
        </div>
      </section>
    );
  }
  return (
    <section aria-label={t("yp.page")} data-your-page-link="" className={`rounded-2xl border border-border/60 px-4 py-3 flex flex-col gap-2 ${className}`}>
      <p className="text-ds-13 text-muted-foreground min-w-0">
        {t("yp.pageLead")}{" "}
        {/* In-app route: the page opens here, never in a browser outside the app. */}
        <Link to={`/u/${encodeURIComponent(handle)}`} className="link-standard font-semibold text-foreground break-all">
          {profileLinkLabel(handle)}
        </Link>
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void copy()} data-your-page-copy="">
          <Copy className="w-4 h-4" aria-hidden /> {t("yp.copy")}
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void shareMyProfile(handle, name)} data-your-page-share="">
          <Share2 className="w-4 h-4" aria-hidden /> {t("yp.share")}
        </Button>
      </div>
    </section>
  );
}
