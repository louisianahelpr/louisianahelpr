import { RoundIconButton } from "@/components/ui/RoundIconButton";
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { HINTS, WISH } from "@/content/giftWishList";
import { track } from "@/lib/analytics";
import { dismissHint, useHint } from "./GiftHint";
import { MY_LIST_SLUG } from "./giftList";

/**
 * The gift guides' how-to hints that are more than one line (owner 2026-11-20: "add hints or things so they know how to
 * use everything"): the landing's three-step strip, and a heart's note ("Saved to your wish list" once ever; "Your list
 * is full" on a full list). Both are dismissible and never cover content: the strip is inline, the note a one-line
 * pill at the bottom edge that hides itself after a few seconds.
 */

/** The landing's "How to use the gift guides": three numbered steps, closed for good with ×. */
export function HowToStrip() {
  const [showing, dismiss] = useHint("how-to");
  if (!showing) return null;
  return (
    <aside className="gg-howto" aria-labelledby="gift-howto-title" data-gift-hint="how-to">
      <div className="gg-howto-head">
        <h2 id="gift-howto-title" className="gg-howto-title">{HINTS.howTitle}</h2>
        <RoundIconButton size="sm" className="gg-hint-x" onClick={dismiss} aria-label="Got it, hide these tips" data-gift-hint-close="how-to">
          <span aria-hidden="true">×</span>
        </RoundIconButton>
      </div>
      <ol className="gg-howto-steps" data-gift-howto-steps="">
        {HINTS.steps.map((s, i) => (
          // UX audit L1: the numbers are drawn, not left to list-style (which the strip's flex row dropped).
          <li key={s}><b className="gg-howto-n" aria-hidden="true">{i + 1}</b><span>{s}</span></li>
        ))}
      </ol>
    </aside>
  );
}

// The note a heart tap shows: the first tap that SAVED something (once ever: "Saved to your wish list"), or a tap on a
// full list (every time: "Your list is full", UX audit M2). A tap that unsaves shows nothing.
type Note = "first" | "full" | null;
let note: Note = null;
let noteId = 0;
let savedOnce = false;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const setNote = (n: Note) => {
  note = n;
  noteId++;
  listeners.forEach((l) => l());
};

/** A heart was tapped; `result` is what the tap did (togglePick's answer). */
export function heartTapped(result: "added" | "removed" | "full") {
  track("gift_wish_heart", { result });
  if (result === "full") setNote("full");
  else if (result === "added" && !savedOnce) {
    savedOnce = true;
    setNote("first");
  }
}

/** For tests. */
export const resetFirstHeartForTests = () => {
  savedOnce = false;
  note = null;
};

/** How long a heart's note stays before it hides itself (the first one then counts as seen). */
const NOTE_MS = 6000;

/**
 * A heart's note, portaled to the body (CLAUDE.md): one line pinned to the bottom edge, never covering more than its own
 * height (UX audit H1: it wrapped one word per line and covered the next gift).
 */
export function FirstHeartHint() {
  const [firstShowing] = useHint("first-heart");
  const current = useSyncExternalStore(subscribe, () => note, () => null);
  const id = useSyncExternalStore(subscribe, () => noteId, () => 0);
  const on = current === "full" || (current === "first" && firstShowing);
  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => {
      if (current === "first") dismissHint("first-heart");
      setNote(null);
    }, NOTE_MS);
    return () => window.clearTimeout(t);
  }, [on, current, id]);
  if (!on || typeof document === "undefined") return null;
  const close = () => {
    if (current === "first") dismissHint("first-heart");
    setNote(null);
  };
  return createPortal(
    <div className="gg-toast" role="status" data-gift-hint={current === "full" ? "list-full" : "first-heart"}>
      {/* Verify audit H1: at 320 the full words wrapped to 2 lines; a narrow screen gets the short ones (one line). */}
      <span className="gg-toast-text">
        <span className="gg-toast-long">{current === "full" ? WISH.listFull : HINTS.firstHeart}</span>
        <span className="gg-toast-short" aria-hidden="true">{current === "full" ? WISH.listFullShort : HINTS.firstHeartShort}</span>
      </span>
      <Link to={`/gift-guides/${MY_LIST_SLUG}`} className="gg-toast-link" onClick={close} data-gift-hint-see-list="">
        <span className="gg-toast-long">{HINTS.seeList} ›</span>
        <span className="gg-toast-short" aria-hidden="true">{HINTS.seeListShort} ›</span>
      </Link>
      <RoundIconButton size="sm" className="gg-hint-x" onClick={close} aria-label="Hide this tip" data-gift-hint-close="first-heart">
        <span aria-hidden="true">×</span>
      </RoundIconButton>
    </div>,
    document.body,
  );
}
