import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { HINTS } from "@/content/giftWishList";
import { dismissHint, useHint } from "./GiftHint";
import { MY_LIST_SLUG } from "./giftList";

/**
 * The gift guides' how-to hints that are more than one line (owner 2026-11-20: "add hints or things so they know how to
 * use everything"): the landing's three-step strip, and the first heart's one-time "Saved to your wish list" note.
 * Both are dismissible, remembered (GiftHint), and never cover content: the strip is inline, the note a small pill at
 * the bottom edge that hides itself after a few seconds.
 */

/** The landing's "How to use the gift guides": three short steps, closed for good with ×. */
export function HowToStrip() {
  const [showing, dismiss] = useHint("how-to");
  if (!showing) return null;
  return (
    <aside className="gg-howto" aria-labelledby="gift-howto-title" data-gift-hint="how-to">
      <div className="gg-howto-head">
        <h2 id="gift-howto-title" className="gg-howto-title">{HINTS.howTitle}</h2>
        <button type="button" className="gg-hint-x" onClick={dismiss} aria-label="Got it, hide these tips" data-gift-hint-close="how-to">
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <ol className="gg-howto-steps">
        {HINTS.steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
    </aside>
  );
}

// The first heart tap of this visit that SAVED something (the note says "Saved", so a tap that unsaves shows nothing).
let justSaved = false;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** A heart was tapped; `saved` is whether the gift is on the list afterwards. Returns nothing. */
export function heartTapped(saved: boolean) {
  if (!saved || justSaved) return;
  justSaved = true;
  listeners.forEach((l) => l());
}

/** For tests. */
export const resetFirstHeartForTests = () => {
  justSaved = false;
};

/** How long the first heart's note stays before it hides itself (and counts as seen). */
const NOTE_MS = 6000;

/** The first heart's note, once ever: "Saved to your wish list. See my list". Portaled to the body (CLAUDE.md). */
export function FirstHeartHint() {
  const [showing] = useHint("first-heart");
  const saved = useSyncExternalStore(subscribe, () => justSaved, () => false);
  const on = showing && saved;
  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => dismissHint("first-heart"), NOTE_MS);
    return () => window.clearTimeout(t);
  }, [on]);
  if (!on || typeof document === "undefined") return null;
  return createPortal(
    <div className="gg-toast" role="status" data-gift-hint="first-heart">
      <span>{HINTS.firstHeart}</span>
      <Link to={`/gift-guides/${MY_LIST_SLUG}`} className="gg-toast-link" onClick={() => dismissHint("first-heart")} data-gift-hint-see-list="">{HINTS.seeList} ›</Link>
      <button type="button" className="gg-hint-x" onClick={() => dismissHint("first-heart")} aria-label="Hide this tip" data-gift-hint-close="first-heart">
        <span aria-hidden="true">×</span>
      </button>
    </div>,
    document.body,
  );
}
