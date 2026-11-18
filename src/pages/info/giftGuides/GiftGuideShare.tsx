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
 * The small Share pill beside a guide's title (owner 2026-11-18): the phone's own share sheet (navigator.share) when
 * there is one; otherwise a small menu with Copy link, Facebook and Pinterest.
 */
export function GiftGuideShare({ path, title, image }: { path: string; title: string; image?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const links = shareLinks(path, title, image);
  const share = () => {
    if (typeof navigator.share === "function") {
      // A cancelled share sheet rejects; nothing to do, the page is unchanged.
      navigator.share({ title, url: links.url }).catch(() => setOpen(false));
      return;
    }
    setOpen((o) => !o);
  };
  const copy = () => {
    void navigator.clipboard?.writeText(links.url).then(
      () => setCopied(true),
      // Clipboard refused: the Facebook and Pinterest links still work.
      () => setCopied(false),
    );
  };
  return (
    <span className="gg-share-wrap">
      <InlineTextButton className="gg-share no-underline" onClick={share} aria-expanded={open} data-gift-share="">Share</InlineTextButton>
      {open && (
        <span className="gg-share-menu" data-gift-share-menu="">
          <InlineTextButton onClick={copy}>{copied ? "Link copied" : "Copy link"}</InlineTextButton>
          <a href={links.facebook} target="_blank" rel="noopener noreferrer">Facebook</a>
          <a href={links.pinterest} target="_blank" rel="noopener noreferrer" data-gift-pin="">Pinterest</a>
        </span>
      )}
    </span>
  );
}
