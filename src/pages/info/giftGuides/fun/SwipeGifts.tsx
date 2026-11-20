import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { guideBySlug, guidePicksVersion, loadGuidePicks, picksReady, subscribeGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { FUN_WORDS as W, SWIPE_BUDGETS, SWIPE_WHO, swipePool, swipeRound, type SwipeBudget, type SwipeWho } from "@/content/giftGuideFun1120";
import { PickPrice } from "@/components/giftGuides/PickPrice";
import { shareNative } from "@/lib/nativeShare";
import { getPublicOrigin } from "@/lib/authRedirects";
import { track } from "@/lib/analytics";
import { saveWishList, sharedListPath } from "@/lib/giftWishListApi";
import { PickThumb, storeLabel } from "../GiftGuideView";
import { GiftOut } from "../GiftOut";
import { addToWishList, itemId, listName, listRefs, useGiftList } from "../giftList";
import { Hint } from "../GiftHint";
import { FunPage } from "./FunPage";

/**
 * /gift-guides/swipe (owner 2026-11-20): pick who and a budget, then 20 cards from the guides' picks (strongest first,
 * some variety: swipeRound). Drag right or tap Save = on the wish list (addToWishList); drag left or tap Skip = pass;
 * tap the card = its details and Shop. The buttons do everything the gestures do (accessible). "Share my picks" at the
 * end shares the wish list's link. Guard: src/test/giftGuideFun1120.test.tsx.
 */
const PATH = "/gift-guides/swipe" as const;
/** How far (px) a card is dragged before letting go counts as a swipe. */
const SWIPE_DISTANCE = 90;

type Card = CatalogPick & { guide: string };

export default function SwipeGifts() {
  const [who, setWho] = useState<SwipeWho | null>(null);
  const [budget, setBudget] = useState<SwipeBudget | null>(null);
  const [started, setStarted] = useState(false);
  const [round, setRound] = useState<Card[]>([]);
  const [at, setAt] = useState(0);
  const [saved, setSaved] = useState<Card[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [details, setDetails] = useState(false);
  const [dx, setDx] = useState(0);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const version = useSyncExternalStore(subscribeGuidePicks, guidePicksVersion, guidePicksVersion);
  const list = useGiftList();
  const w = SWIPE_WHO.find((x) => x.id === who);

  useEffect(() => {
    if (!w || !started) return;
    setLoadFailed(false);
    Promise.all(w.guides.map((g) => loadGuidePicks(g.slug))).catch((e: unknown) => {
      console.warn("swipe: picks chunk failed", e);
      setLoadFailed(true);
    });
  }, [w, started]);

  const ready = !!w && w.guides.every((g) => picksReady(g.slug));
  const pool = useMemo((): Card[] => {
    if (!w || !started) return [];
    const from = new Map<string, string>();
    const picks = swipePool(w.id, (slug) => {
      const ps = guideBySlug(slug)?.picks ?? [];
      for (const p of ps) if (!from.has(p.href)) from.set(p.href, slug);
      return ps;
    });
    return picks.map((p) => ({ ...p, guide: from.get(p.href) ?? w.guides[0].slug }));
    // version: re-read once each lazy chunk arrives.
  }, [w, started, version]);

  useEffect(() => {
    if (!started || budget === null || round.length || !pool.length) return;
    setRound(swipeRound(pool, budget, seen.current));
    setAt(0);
  }, [pool, started, budget, round.length]);

  const card = round[at];
  const finished = started && round.length > 0 && at >= round.length;
  // UX audit L8: the next card's photo loads while this one is shown, so it appears at once.
  const nextImage = round[at + 1]?.image;
  useEffect(() => {
    if (!nextImage) return;
    const img = new Image();
    img.referrerPolicy = "no-referrer-when-downgrade";
    img.src = nextImage;
  }, [nextImage]);
  useEffect(() => {
    if (finished) track("gift_swipe_round_done", { who, budget, cards: round.length, saved: saved.length });
    // Once per finished round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const next = (keep: boolean) => {
    if (!card) return;
    seen.current.add(card.href);
    if (keep && addToWishList({ href: card.href, name: card.name, guide: card.guide, id: itemId(card.href) })) setSaved((s) => [...s, card]);
    setDetails(false);
    setDx(0);
    setAt((i) => i + 1);
  };

  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === "ArrowRight") next(true);
      else if (e.key === "ArrowLeft") next(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("a,button")) return;
    drag.current = { x: e.clientX, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const d = e.clientX - drag.current.x;
    if (Math.abs(d) > 6) drag.current.moved = true;
    setDx(d);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      setDx(0);
      setDetails((v) => !v);
      return;
    }
    if (dx > SWIPE_DISTANCE) next(true);
    else if (dx < -SWIPE_DISTANCE) next(false);
    else setDx(0);
  };

  const anotherRound = () => {
    setRound([]);
    setSaved([]);
    setShareMsg(null);
  };
  const shareMine = async () => {
    setShareMsg(null);
    try {
      const code = await saveWishList(listName(list), listRefs(list));
      await shareNative({ title: W.swipeTitle, text: W.swipeShareText, url: `${getPublicOrigin()}${sharedListPath(code)}` });
    } catch (e) {
      console.warn("swipe: share failed", e);
      setShareMsg(W.revealShareFailed);
    }
  };

  return (
    <FunPage title={W.swipeTitle} path={PATH}>
      {!started ? (
        <section aria-labelledby="swipe-setup" data-swipe-setup="">
          <h2 id="swipe-setup" className="sr-only">{W.swipeTitle}</h2>
          <p className="gg-fun-lead">{W.swipeHelp}</p>
          <div role="group" aria-label={W.swipeWho} className="gg-finder-step">
            <p className="gg-finder-q">{W.swipeWho}</p>
            <span className="gg-chips">
              {SWIPE_WHO.map((o) => (
                <Button key={o.id} type="button" variant="outline" size="sm" className={who === o.id ? "gg-chip btn-grad-primary" : "gg-chip"} aria-pressed={who === o.id}
                  onClick={() => setWho(o.id)} data-swipe-who={o.id}>{o.label}</Button>
              ))}
            </span>
          </div>
          <div role="group" aria-label={W.swipeBudget} className="gg-finder-step">
            <p className="gg-finder-q">{W.swipeBudget}</p>
            <span className="gg-chips">
              {SWIPE_BUDGETS.map((o) => (
                <Button key={o.id} type="button" variant="outline" size="sm" className={budget === o.id ? "gg-chip btn-grad-primary" : "gg-chip"} aria-pressed={budget === o.id}
                  onClick={() => setBudget(o.id)} data-swipe-budget={o.id}>{o.label}</Button>
              ))}
            </span>
          </div>
          <Button type="button" className="btn-grad-primary mt-4 w-full" disabled={!who || budget === null} onClick={() => setStarted(true)} data-swipe-start="">{W.swipeStart}</Button>
        </section>
      ) : loadFailed ? (
        <div className="gg-fun-card" data-swipe-load-failed="">
          <p className="m-0">{W.swipeLoadFailed}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { setStarted(false); }}>{W.revealRetry}</Button>
        </div>
      ) : finished ? (
        <section aria-labelledby="swipe-done" data-swipe-done="">
          <h2 id="swipe-done">{saved.length ? W.swipeDoneTitle(saved.length) : W.swipeDoneNone}</h2>
          {saved.length > 0 && (
            <ul className="gg-fun-list mb-3">{saved.map((p) => <li key={p.href} className="text-sm">♥ {p.name}</li>)}</ul>
          )}
          <div className="gg-fun-actions">
            <Button type="button" className="btn-grad-primary" onClick={anotherRound} data-swipe-more="">{W.swipeMore}</Button>
            {listRefs(list).length > 0 && <Button type="button" variant="outline" onClick={() => void shareMine()} data-swipe-share="">{W.swipeShare}</Button>}
            <Button asChild variant="outline"><Link to="/gift-guides?list=mine" data-swipe-list="">{W.swipeSeeList}</Link></Button>
            <Button type="button" variant="link" size="inline" className="gg-link" onClick={() => { setStarted(false); anotherRound(); }} data-swipe-change="">{W.swipeChange}</Button>
          </div>
          {shareMsg && <p className="gg-fun-err" role="alert">{shareMsg}</p>}
        </section>
      ) : !card ? (
        <div className="gg-fun-card" data-swipe-waiting="">
          <p className="m-0" role="status">{ready && pool.length && budget !== null && swipeRound(pool, budget, seen.current).length === 0 ? W.swipeEmpty : W.swipeLoading}</p>
          <Button type="button" variant="link" size="inline" className="gg-link" onClick={() => setStarted(false)}>{W.swipeChange}</Button>
        </div>
      ) : (
        <section aria-label={W.swipeTitle} data-swipe-deck="">
          <Hint id="fun-swipe">{W.hintSwipe}</Hint>
          <p className="gg-fun-note text-center" aria-live="polite" data-swipe-count="">{W.swipeCount(at + 1, round.length)}</p>
          <div className="gg-swipe-stage">
            <div
              className={drag.current ? "gg-swipe-card is-dragging" : "gg-swipe-card"}
              style={{ transform: `translateX(${dx}px) rotate(${dx / 18}deg)` }}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; setDx(0); }}
              data-swipe-card={card.href}
            >
              <span className="gg-swipe-tag save" style={{ opacity: Math.max(0, Math.min(1, dx / SWIPE_DISTANCE)) }} aria-hidden="true">{W.swipeSave}</span>
              <span className="gg-swipe-tag skip" style={{ opacity: Math.max(0, Math.min(1, -dx / SWIPE_DISTANCE)) }} aria-hidden="true">{W.swipeSkip}</span>
              <PickThumb pick={card} size={220} />
              <p className="gg-swipe-name">{card.name}</p>
              <p className="gg-swipe-meta m-0">{storeLabel(card) && <span>{storeLabel(card)}</span>}<PickPrice pick={card} /></p>
              {details && card.line && <p className="gg-fun-note text-center" data-swipe-line="">{card.line}</p>}
              <div className="gg-fun-actions justify-center">
                <Button type="button" variant="link" size="inline" className="gg-link" aria-expanded={details} onClick={() => setDetails((v) => !v)} data-swipe-details="">{W.swipeDetails}</Button>
                <Button asChild variant="outline" size="sm" className="gg-shop-btn m-0">
                  <GiftOut href={card.href}>{W.swipeShop}<span className="sr-only"> {card.name} (opens in a new tab)</span></GiftOut>
                </Button>
              </div>
            </div>
          </div>
          <div className="gg-swipe-btns">
            <Button type="button" variant="outline" className="gg-swipe-btn" onClick={() => next(false)} aria-label={W.swipeSkipLabel(card.name)} data-swipe-skip="">✕ {W.swipeSkip}</Button>
            <Button type="button" className="gg-swipe-btn btn-grad-primary" onClick={() => next(true)} aria-label={W.swipeSaveLabel(card.name)} data-swipe-save="">♥ {W.swipeSave}</Button>
          </div>
        </section>
      )}
    </FunPage>
  );
}
