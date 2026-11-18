import { useState } from "react";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { SITE_ORIGIN } from "@/lib/publicPageMeta.mjs";

/** The share links for a gift-guides page (owner 2026-11-18): Facebook's sharer and Pinterest's pin builder, no SDK script. */
const shareLinks = (path: string, title: string, image?: string) => {
  const url = `${SITE_ORIGIN}${path}`;
  const pin = new URLSearchParams({ url, description: title });
  if (image) pin.set("media", `${SITE_ORIGIN}${image}`);
  return {
    url,
    facebook: `https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({ u: url }).toString()}`,
    pinterest: `https://www.pinterest.com/pin/create/button/?${pin.toString()}`,
  };
};

/**
 * "Text this guide" (owner 2026-11-18): an sms: link with the guide's URL in the body. iOS reads `sms:&body=`, Android
 * and the rest `sms:?body=`.
 */
export const smsHref = (url: string, title: string, userAgent: string) =>
  `sms:${/iPhone|iPad|iPod/.test(userAgent) ? "&" : "?"}body=${encodeURIComponent(`${title} ${url}`)}`;

/**
 * The small Share pill beside a guide's title (owner 2026-11-18; 11-18 PM: "Text the guides should be under share"):
 * Share opens one small menu with Copy link, Text this guide / Text these guides (the sms: link), the phone's own share
 * sheet (navigator.share, only where there is one), Facebook and Pinterest. No second button beside it.
 */
export function GiftGuideShare({ path, title, image, many = false }: { path: string; title: string; image?: string; many?: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const links = shareLinks(path, title, image);
  const native = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const shareSheet = () => {
    // A cancelled share sheet rejects; nothing to do, the menu stays as it was.
    navigator.share({ title, url: links.url }).catch(() => undefined);
  };
  const copy = () => {
    void navigator.clipboard?.writeText(links.url).then(
      () => setCopied(true),
      // Clipboard refused: the text, Facebook and Pinterest links still work.
      () => setCopied(false),
    );
  };
  return (
    <span className="gg-share-wrap">
      <InlineTextButton className="gg-share no-underline" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" data-gift-share="">Share</InlineTextButton>
      {open && (
        <span className="gg-share-menu" data-gift-share-menu="">
          <InlineTextButton onClick={copy}>{copied ? "Link copied" : "Copy link"}</InlineTextButton>
          <a href={smsHref(links.url, title, typeof navigator === "undefined" ? "" : navigator.userAgent)} data-gift-text="">{many ? "Text these guides" : "Text this guide"}</a>
          {native && <InlineTextButton onClick={shareSheet} data-gift-share-native="">More ways to share</InlineTextButton>}
          <a href={links.facebook} target="_blank" rel="noopener noreferrer">Facebook</a>
          <a href={links.pinterest} target="_blank" rel="noopener noreferrer" data-gift-pin="">Pinterest</a>
        </span>
      )}
    </span>
  );
}
