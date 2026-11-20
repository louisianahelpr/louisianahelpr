import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { SITE_ORIGIN } from "@/lib/publicPageMeta.mjs";
import { WISH, HINTS } from "@/content/giftWishList";
import { sharedListPath } from "@/lib/giftWishListApi";
import { smsHref } from "./GiftGuideShare";
import { Hint, dismissHint } from "./GiftHint";
import type { WishRef } from "./giftList";

/**
 * "Share my list" (owner 2026-11-20: "send their list to someone"). One tap saves the list (signed out: a snapshot;
 * signed in: the account's list) and gets its short link, /gift-guides/list/<code>. On a phone the phone's own share
 * sheet opens (Messages, Messenger, anything installed: navigator.share); elsewhere, or when the sheet fails, a small
 * menu: Copy link, Text message (sms:), Messenger (phones only: fb-messenger://, the web has no Messenger share link
 * without a Facebook app id) and the share sheet where there is one. The link carries only the code: never a name or
 * an email.
 */

/** A phone (touch first, with a share sheet): the share sheet opens straight away. */
const phoneShare = () =>
  typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
const isMobileUa = (ua: string) => /iPhone|iPad|iPod|Android/.test(ua);

/** Messenger's share link (the app, on a phone). */
export const messengerHref = (url: string) => `fb-messenger://share/?link=${encodeURIComponent(url)}`;

export function GiftWishShare({ name, refs, save }: { name: string; refs: WishRef[]; save: (name: string, refs: WishRef[]) => Promise<string> }) {
  const [state, setState] = useState<"idle" | "saving" | "menu" | "failed" | "limited">("idle");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const message = WISH.shareMessage(name);

  const go = async () => {
    dismissHint("share");
    setCopied(false);
    setState("saving");
    let link: string;
    try {
      link = `${SITE_ORIGIN}${sharedListPath(await save(name, refs))}`;
    } catch (e) {
      // Not silent: the visitor is told, and can try again; nothing was shared.
      setState((e as { kind?: string }).kind === "rateLimited" ? "limited" : "failed");
      return;
    }
    setUrl(link);
    if (phoneShare()) {
      try {
        await navigator.share({ title: name, text: message, url: link });
        setState("idle");
        return;
      } catch (e) {
        // Cancelled (AbortError): back to the button. Any other failure: the menu, so the link still goes.
        if ((e as { name?: string }).name === "AbortError") {
          setState("idle");
          return;
        }
      }
    }
    setState("menu");
  };

  const copy = () => {
    void navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      // Clipboard refused: the link is on screen to copy by hand.
      () => setCopied(false),
    );
  };

  return (
    <div className="gg-wish-share" data-gift-wish-share="">
      <Hint id="share">{HINTS.share}</Hint>
      <Button type="button" className="btn-grad-primary gg-wish-share-btn" disabled={refs.length === 0 || state === "saving"} onClick={() => void go()} data-gift-wish-share-btn="">
        {state === "saving" ? WISH.sharing : WISH.share}
      </Button>
      {state === "failed" && <p role="alert" className="gg-price-note" data-gift-wish-share-failed="">{WISH.shareFailed}</p>}
      {state === "limited" && <p role="alert" className="gg-price-note" data-gift-wish-share-limited="">{WISH.shareRateLimited}</p>}
      {state === "menu" && url && (
        <div className="gg-wish-share-menu" role="group" aria-label={WISH.shareMenuLabel} data-gift-wish-share-menu="">
          <input className="gg-wish-link" readOnly value={url} aria-label={WISH.copyLink} onFocus={(e) => e.currentTarget.select()} data-gift-wish-link="" />
          <span className="gg-chips">
            <Button type="button" variant="outline" size="sm" className="gg-chip" onClick={copy} data-gift-wish-copy="">{copied ? WISH.copied : WISH.copyLink}</Button>
            <Button asChild variant="outline" size="sm" className="gg-chip">
              <a href={smsHref(url, message, ua)} data-gift-wish-text="">{WISH.text}</a>
            </Button>
            {isMobileUa(ua) && (
              <Button asChild variant="outline" size="sm" className="gg-chip">
                <a href={messengerHref(url)} data-gift-wish-messenger="">{WISH.messenger}</a>
              </Button>
            )}
            {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
              <InlineTextButton onClick={() => navigator.share({ title: name, text: message, url }).catch(() => undefined)} data-gift-wish-native="">{WISH.moreShare}</InlineTextButton>
            )}
          </span>
          <p className="gg-price-note">{WISH.shareNote}</p>
        </div>
      )}
    </div>
  );
}
