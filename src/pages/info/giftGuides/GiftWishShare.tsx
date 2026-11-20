import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SITE_ORIGIN } from "@/lib/publicPageMeta.mjs";
import { track } from "@/lib/analytics";
import { WISH, HINTS } from "@/content/giftWishList";
import { newWishLink, sharedListPath, wishErrorCopy } from "@/lib/giftWishListApi";
import { smsHref } from "./GiftGuideShare";
import { Hint, dismissHint } from "./GiftHint";
import type { WishRef } from "./giftList";

/**
 * "Share my list" (owner 2026-11-20: "send their list to someone"). The first tap saves the list (signed out: a
 * snapshot; signed in: the account's list) and gets its short link, /gift-guides/list/<code>. Then a small menu: the
 * phone's own share sheet first where there is one (Messages, Messenger, anything installed), Copy link, Text message
 * (sms:) and Messenger (phones only: fb-messenger://, the web has no Messenger share link without a Facebook app id).
 * The share sheet opens from its own tap, never after the save's wait, so iOS never refuses it for a lost user gesture
 * (UX audit M5). Signed in, "Make a new link" gives the list a new code so a link sent before stops working (security
 * review #5). The link carries only the code: never a name or an email.
 */

const isMobileUa = (ua: string) => /iPhone|iPad|iPod|Android/.test(ua);

/** Messenger's share link (the app, on a phone). */
const messengerHref = (url: string) => `fb-messenger://share/?link=${encodeURIComponent(url)}`;

export function GiftWishShare({ name, refs, save, signedIn = false }: { name: string; refs: WishRef[]; save: (name: string, refs: WishRef[]) => Promise<string>; signedIn?: boolean }) {
  const [state, setState] = useState<"idle" | "saving" | "menu" | "failed">("idle");
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [rotated, setRotated] = useState(false);
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const native = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const message = WISH.shareMessage;

  const fail = (e: unknown) => {
    // Not silent: the visitor is told in plain words, and can try again; nothing was shared.
    setError(wishErrorCopy(e) ?? WISH.shareFailed);
    setState("failed");
  };

  const go = async () => {
    dismissHint("share");
    setCopied(false);
    setRotated(false);
    setState("saving");
    try {
      setUrl(`${SITE_ORIGIN}${sharedListPath(await save(name, refs))}`);
      setState("menu");
      track("gift_wish_list_link", { items: refs.length, signed_in: signedIn });
    } catch (e) {
      fail(e);
    }
  };

  const rotate = async () => {
    setCopied(false);
    try {
      const code = await newWishLink();
      if (code) {
        setUrl(`${SITE_ORIGIN}${sharedListPath(code)}`);
        setRotated(true);
        track("gift_wish_list_new_link", {});
      }
    } catch (e) {
      fail(e);
    }
  };

  const copy = () => {
    track("gift_wish_list_share", { via: "copy" });
    void navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      // Clipboard refused: the link is on screen to copy by hand.
      () => setCopied(false),
    );
  };

  const sheet = () => {
    track("gift_wish_list_share", { via: "sheet" });
    navigator.share({ title: name, text: message, url }).catch((e: unknown) => {
      // Cancelled, or the sheet is not allowed here: the menu's other ways stay on screen.
      console.info("gift wish list: share sheet closed", (e as { name?: string }).name);
    });
  };

  return (
    <div className="gg-wish-share" data-gift-wish-share="">
      <Hint id="share">{HINTS.share}</Hint>
      <Button type="button" className="btn-grad-primary gg-wish-share-btn" disabled={refs.length === 0 || state === "saving"} onClick={() => void go()} data-gift-wish-share-btn="">
        {state === "saving" ? WISH.sharing : WISH.share}
      </Button>
      {state === "failed" && <p role="alert" className="gg-price-note" data-gift-wish-share-failed="">{error}</p>}
      {state === "menu" && url && (
        <div className="gg-wish-share-menu" role="group" aria-label={WISH.shareMenuLabel} data-gift-wish-share-menu="">
          {native && (
            <Button type="button" className="btn-grad-primary gg-wish-share-btn" onClick={sheet} data-gift-wish-native="">{WISH.sendWith}</Button>
          )}
          <input className="gg-wish-link" readOnly value={url} aria-label={WISH.copyLink} onFocus={(e) => e.currentTarget.select()} data-gift-wish-link="" />
          <span className="gg-chips">
            <Button type="button" variant="outline" size="sm" className="gg-chip" onClick={copy} data-gift-wish-copy="">{copied ? WISH.copied : WISH.copyLink}</Button>
            <Button asChild variant="outline" size="sm" className="gg-chip">
              <a href={smsHref(url, message, ua)} onClick={() => track("gift_wish_list_share", { via: "text" })} data-gift-wish-text="">{WISH.text}</a>
            </Button>
            {isMobileUa(ua) && (
              <Button asChild variant="outline" size="sm" className="gg-chip">
                <a href={messengerHref(url)} onClick={() => track("gift_wish_list_share", { via: "messenger" })} data-gift-wish-messenger="">{WISH.messenger}</a>
              </Button>
            )}
          </span>
          <p className="gg-price-note">{WISH.shareNote}</p>
          {signedIn && (
            <p className="gg-price-note" data-gift-wish-rotate-row="">
              {rotated ? <span role="status" data-gift-wish-rotated="">{WISH.newLinkDone}</span> : (
                <Button type="button" variant="link" size="inline" className="gg-link" onClick={() => void rotate()} data-gift-wish-rotate="">{WISH.newLink}</Button>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
