import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { guideBySlug, guidePicksVersion, loadGuidePicks, picksReady, subscribeGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { FUN_WORDS as W, SWIPE_BUDGETS, SWIPE_ROUND, SWIPE_WHO, borrowFits, santaRound, swipePool, swipeRound, type SwipeBudget, type SwipeWho } from "@/content/giftGuideFun1120";
import { BUDGET_GUIDES } from "@/content/giftPickBand";
import { useAuthReady } from "@/hooks/useAuthReady";
import { PickPrice } from "@/components/giftGuides/PickPrice";
import { shareNative } from "@/lib/nativeShare";
import { getPublicOrigin } from "@/lib/authRedirects";
import { track } from "@/lib/analytics";
import { saveWishList, sharedListPath } from "@/lib/giftWishListApi";
import { PickThumb } from "../GiftGuideView";
import { GiftOut } from "../GiftOut";
import { MY_LIST_SLUG, addToWishList, itemId, listName, listRefs, useGiftList } from "../giftList";
import { Hint } from "../GiftHint";
import { FunBody, funHeader } from "./FunPage";
import { useAccountSync } from "./plannerStore";
import { readSantaFor, saveIdeaToPlanner, saveSantaIdea } from "./santaIdeas";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";

/**
 * /gift-guides/swipe (owner 2026-11-20): pick who and a budget, then 20 cards from the guides' picks (strongest first,
 * some variety: swipeRound). Drag right or tap Save = on the wish list (addToWishList); drag left or tap Skip = pass;
 * tap the card = its details and Shop. The buttons do everything the gestures do (accessible). "Share my picks" at the
 * end shares the wish list's link. Guard: src/test/giftGuideFun1120.test.tsx.
 *
 * Saving is for whoever the cards are for (owner 11-20: saving for someone else never goes on MY wish list): "Me"
 * saves to the wish list; anyone else is "Save for Mom", an idea under that person in the gift planner (the account's
 * when signed in, this device's when not; saveIdeaToPlanner).
 *
 * Opened from a Secret Santa reveal (router state, readSantaFor; owner 11-20): the round keeps to the group's budget
 * (santaRound: only picks known to cost at most it, closest first) and Save is "Save for <match>", which files the gift
 * under the match (the gift planner when signed in, else this device with that Secret Santa: saveSantaIdea), never on
 * the wish list. Guard: src/test/secretSantaIdeas1120.test.tsx.
 */
const PATH = "/gift-guides/swipe" as const;
/** How far (px) a card is dragged before letting go counts as a swipe. */
const SWIPE_DISTANCE = 90;

type Card = CatalogPick & { guide: string };

export default function SwipeGifts() {
  const santa = readSantaFor(useLocation().state);
  const { user, isReady } = useAuthReady();
  // Gifts for someone else go to the gift planner (signed in: the account's, loaded first; signed out: this device's).
  const sync = useAccountSync(user?.id ?? null, isReady);
  // Never write before the account's planner is merged in (a write first would replace it on upload).
  const plannerReady = isReady && (!user || sync !== "device");
  const santaBudget = santa?.budget ?? null;
  const [savedTo, setSavedTo] = useState<"planner" | "device" | null>(null);
  const [who, setWho] = useState<SwipeWho | null>(null);
  const [budget, setBudget] = useState<SwipeBudget | null>(santa ? 0 : null);
  const [started, setStarted] = useState(false);
  const [round, setRound] = useState<Card[]>([]);
  const [at, setAt] = useState(0);
  const [saved, setSaved] = useState<Card[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [details, setDetails] = useState(false);
  const [dx, setDx] = useState(0);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  // Holiday audit C12a: a Save says so (the guide hearts toast; the deck announces it in its live line).
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const version = useSyncExternalStore(subscribeGuidePicks, guidePicksVersion, guidePicksVersion);
  const list = useGiftList();
  const w = SWIPE_WHO.find((x) => x.id === who);
  // Who a saved card is for: the Secret Santa match, or the chosen person; none = "Me" (the wish list).
  const forName = santa ? santa.match : w?.forName ?? null;
  const saveWaits = !!forName && (santa ? !!user && !plannerReady : !plannerReady);

  // A budget round (a Secret Santa's, or a chosen "Under $N") also borrows the budget guides' picks that suit this
  // "who", so a strict budget still fills a round (holiday audit C1).
  const borrowing = !!santaBudget || (!santa && !!budget);
  useEffect(() => {
    if (!w || !started) return;
    setLoadFailed(false);
    Promise.all([...w.guides.map((g) => g.slug), ...(borrowing ? BUDGET_GUIDES : [])].map((slug) => loadGuidePicks(slug))).catch((e: unknown) => {
      console.warn("swipe: picks chunk failed", e);
      setLoadFailed(true);
    });
  }, [w, started, borrowing]);

  const ready = !!w && w.guides.every((g) => picksReady(g.slug)) && (!borrowing || BUDGET_GUIDES.every((g) => picksReady(g)));
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
  const borrow = useMemo((): Card[] => {
    if (!w || !started || !borrowing) return [];
    return BUDGET_GUIDES.flatMap((slug) => (guideBySlug(slug)?.picks ?? []).filter((p) => borrowFits(w.id, p)).map((p) => ({ ...p, guide: slug })));
    // version: re-read once each lazy chunk arrives.
  }, [w, started, version, borrowing]);
  const makeRound = (): Card[] => (santa ? santaRound(pool, borrow, santa.budget, seen.current) : swipeRound(pool, budget ?? 0, seen.current, Math.random, borrow));

  useEffect(() => {
    if (!started || budget === null || round.length || !pool.length || !ready) return;
    setRound(makeRound());
    setAt(0);
  }, [pool, borrow, ready, started, budget, round.length]);

  const card = round[at];
  // Holiday audit C1: a strict budget can leave a short round; say so and offer the next budget up.
  const budgetIdx = SWIPE_BUDGETS.findIndex((b) => b.id === budget);
  const short = !santa && !!budget && round.length > 0 && round.length < SWIPE_ROUND;
  const nextBudget = short ? SWIPE_BUDGETS.slice(budgetIdx + 1).find((b) => b.id !== 0) ?? null : null;
  const fewNote = short ? W.swipeFew(round.length, SWIPE_BUDGETS[budgetIdx].label) : null;
  const tryNextBudget = () => {
    if (!nextBudget) return;
    seen.current.clear();
    setBudget(nextBudget.id);
    setRound([]);
    setSaved([]);
    setShareMsg(null);
  };
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
  }, [finished]);

  const next = (keep: boolean) => {
    if (!card || (keep && saveWaits)) return;
    seen.current.add(card.href);
    if (keep && santa) {
      const where = saveSantaIdea(santa, card, !!user && plannerReady);
      if (where !== "full") {
        setSavedTo(where);
        setSaved((s) => [...s, card]);
      }
    } else if (keep && forName) {
      if (saveIdeaToPlanner(forName, null, card)) {
        setSavedTo("planner");
        setSaved((s) => [...s, card]);
      }
    } else if (keep && addToWishList({ href: card.href, name: card.name, guide: card.guide, id: itemId(card.href) })) setSaved((s) => [...s, card]);
    setLastSaved(keep ? card.name : null);
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
      if (card?.line) setDetails((v) => !v);
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
    <PublicHeaderPage {...funHeader(W.swipeTitle)}>
      <FunBody title={W.swipeTitle} path={PATH}>
      {!started ? (
        <section aria-labelledby="swipe-setup" data-swipe-setup="">
          <h2 id="swipe-setup" className="sr-only">{W.swipeTitle}</h2>
          {santa && <p className="m-0 font-semibold" data-swipe-santa="">{W.santaFinding(santa.match)}</p>}
          {santa?.budget && <p className="gg-fun-note mt-1" data-swipe-santa-budget="">{W.santaWithin(santa.budget)}</p>}
          <p className="gg-fun-lead">{W.swipeHelp}</p>
          <div role="group" aria-label={W.swipeWho} className="gg-finder-step">
            <p className="gg-finder-q">{W.swipeWho}</p>
            <span className="gg-chips">
              {/* Owner 11-21: only people whose guide is live (src/content/giftGuideLive.mjs); a retired guide dealt an empty deck. */}
              {SWIPE_WHO.filter((o) => o.guides.every((g) => guideBySlug(g.slug))).map((o) => (
                <Button key={o.id} type="button" variant="outline" size="sm" className={who === o.id ? "gg-chip btn-grad-primary" : "gg-chip"} aria-pressed={who === o.id}
                  onClick={() => setWho(o.id)} data-swipe-who={o.id}>{o.label}</Button>
              ))}
            </span>
          </div>
          {!santa && <div role="group" aria-label={W.swipeBudget} className="gg-finder-step">
            <p className="gg-finder-q">{W.swipeBudget}</p>
            <span className="gg-chips">
              {SWIPE_BUDGETS.map((o) => (
                <Button key={o.id} type="button" variant="outline" size="sm" className={budget === o.id ? "gg-chip btn-grad-primary" : "gg-chip"} aria-pressed={budget === o.id}
                  onClick={() => setBudget(o.id)} data-swipe-budget={o.id}>{o.label}</Button>
              ))}
            </span>
          </div>}
          <Button type="button" className="btn-grad-primary mt-4 w-full" disabled={!who || budget === null} onClick={() => setStarted(true)} data-swipe-start="">{W.swipeStart}</Button>
        </section>
      ) : loadFailed ? (
        <div className="gg-fun-card" data-swipe-load-failed="">
          <p className="m-0">{W.swipeLoadFailed}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { setStarted(false); }}>{W.revealRetry}</Button>
        </div>
      ) : finished ? (
        <section aria-labelledby="swipe-done" className="gg-swipe-done" data-swipe-done="">
          <h2 id="swipe-done">{!saved.length ? W.swipeDoneNone : santa ? W.santaSavedTitle(saved.length, santa.match) : forName ? W.swipeSavedFor(saved.length, forName) : W.swipeDoneTitle(saved.length)}</h2>
          {saved.length > 0 && (
            <ul className="gg-fun-list mb-3">{saved.map((p) => <li key={p.href} className="text-sm">{forName ? "" : "♥ "}{p.name}</li>)}</ul>
          )}
          {fewNote && <p className="gg-fun-note" data-swipe-few="">{fewNote}</p>}
          {nextBudget && <Button type="button" variant="outline" className="mb-2" onClick={tryNextBudget} data-swipe-next-budget={nextBudget.id}>{W.swipeNextBudget(nextBudget.label)}</Button>}
          {forName && savedTo && <p className="gg-fun-note" data-swipe-saved-to={savedTo}>{savedTo === "planner" ? W.swipeSavedPlanner : W.santaSavedDevice}</p>}
          {santa ? (
            <div className="gg-fun-actions">
              <Button type="button" className="btn-grad-primary" onClick={anotherRound} data-swipe-more="">{W.swipeMore}</Button>
              {savedTo === "planner" && <Button asChild variant="outline"><Link to="/gift-guides/planner" data-swipe-santa-planner="">{W.revealIdeasPlanner}</Link></Button>}
              <Button asChild variant="outline"><Link to={santa.back} data-swipe-santa-back="">{W.santaBack}</Link></Button>
            </div>
          ) : forName ? (
            <div className="gg-fun-actions">
              <Button type="button" className="btn-grad-primary" onClick={anotherRound} data-swipe-more="">{W.swipeMore}</Button>
              {savedTo === "planner" && <Button asChild variant="outline"><Link to="/gift-guides/planner" data-swipe-planner="">{W.revealIdeasPlanner}</Link></Button>}
              <Button type="button" variant="link" size="inline" className="gg-link" onClick={() => { setStarted(false); anotherRound(); }} data-swipe-change="">{W.swipeChange}</Button>
            </div>
          ) : (
          <div className="gg-fun-actions">
            <Button type="button" className="btn-grad-primary" onClick={anotherRound} data-swipe-more="">{W.swipeMore}</Button>
            {listRefs(list).length > 0 && <Button type="button" variant="outline" onClick={() => void shareMine()} data-swipe-share="">{W.swipeShare}</Button>}
            <Button asChild variant="outline"><Link to={`/gift-guides/${MY_LIST_SLUG}`} data-swipe-list="">{W.swipeSeeList}</Link></Button>
            <Button type="button" variant="link" size="inline" className="gg-link" onClick={() => { setStarted(false); anotherRound(); }} data-swipe-change="">{W.swipeChange}</Button>
          </div>
          )}
          {shareMsg && <p className="gg-fun-err" role="alert">{shareMsg}</p>}
        </section>
      ) : !card ? (
        <div className="gg-fun-card" data-swipe-waiting="">
          <p className="m-0" role="status">{ready && budget !== null && (pool.length === 0 || makeRound().length === 0) ? W.swipeEmpty : W.swipeLoading}</p>
          <Button type="button" variant="link" size="inline" className="gg-link" onClick={() => setStarted(false)}>{W.swipeChange}</Button>
        </div>
      ) : (
        <section aria-label={W.swipeTitle} data-swipe-deck="">
          <Hint id="fun-swipe">{W.hintSwipe}</Hint>
          <p className="gg-fun-note text-center" aria-live="polite" data-swipe-count="">
            {W.swipeCount(at + 1, round.length)}
            {saved.length > 0 && <span data-swipe-saved-count=""> · {W.swipeSavedSoFar(saved.length)}</span>}
            {lastSaved && <span className="sr-only">{W.swipeSavedOne(lastSaved)}</span>}
          </p>
          {fewNote && at === 0 && <p className="gg-fun-note text-center m-0" data-swipe-few="">{fewNote}</p>}
          <div className="gg-swipe-stage">
            <div
              className={drag.current ? "gg-swipe-card is-dragging" : "gg-swipe-card"}
              style={{ transform: `translateX(${dx}px) rotate(${dx / 18}deg)` }}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; setDx(0); }}
              // Owner 2026-11-21: dragging the photo dragged the picture instead of the card. The browser's native image
              // drag is off (here and in CSS: the photo takes no pointer events), so the whole card moves.
              onDragStart={(e) => e.preventDefault()}
              data-swipe-card={card.href}
            >
              <span className="gg-swipe-tag save" style={{ opacity: Math.max(0, Math.min(1, dx / SWIPE_DISTANCE)) }} aria-hidden="true">{W.swipeSave}</span>
              <span className="gg-swipe-tag skip" style={{ opacity: Math.max(0, Math.min(1, -dx / SWIPE_DISTANCE)) }} aria-hidden="true">{W.swipeSkip}</span>
              <PickThumb pick={card} size={220} />
              <p className="gg-swipe-name">{card.name}</p>
              {/* Holiday audit 1121 #24: price only; item cards carry no store line (owner rule). */}
              <p className="gg-swipe-meta m-0"><PickPrice pick={card} /></p>
              {details && card.line && <p className="gg-fun-note text-center" data-swipe-line="">{card.line}</p>}
              <div className="gg-fun-actions gg-swipe-acts justify-center">
                {/* Holiday audit C5: most picks have no line; Details shows only when there is one to show. */}
                {card.line && <Button type="button" variant="link" size="inline" className="gg-link" aria-expanded={details} onClick={() => setDetails((v) => !v)} data-swipe-details="">{W.swipeDetails}</Button>}
                <Button asChild variant="outline" size="sm" className="gg-shop-btn m-0">
                  <GiftOut href={card.href}>{W.swipeShop}<span className="sr-only"> {card.name} (opens in a new tab)</span></GiftOut>
                </Button>
              </div>
            </div>
          </div>
          <div className="gg-swipe-btns">
            <Button type="button" variant="outline" className="gg-swipe-btn" onClick={() => next(false)} aria-label={W.swipeSkipLabel(card.name)} data-swipe-skip="">✕ {W.swipeSkip}</Button>
            <Button type="button" className="gg-swipe-btn btn-grad-primary" onClick={() => next(true)} disabled={saveWaits}
              aria-label={forName ? W.swipeSaveForLabel(card.name, forName) : W.swipeSaveLabel(card.name)} data-swipe-save="">
              {forName ? W.swipeSaveFor(forName) : `♥ ${W.swipeSave}`}
            </Button>
          </div>
        </section>
      )}
      </FunBody>
    </PublicHeaderPage>
  );
}
