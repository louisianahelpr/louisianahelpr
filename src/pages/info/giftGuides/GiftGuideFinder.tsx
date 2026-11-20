import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { guideBySlug, guidePicksVersion, loadGuidePicks, subscribeGuidePicks } from "@/content/giftGuideCatalog";
import {
  EXTRAS_WORDS as W, FINDER_BUDGETS, FINDER_VIBES, FINDER_WHO, GIFT_GUIDE_FLAGS, declutterTieInOn, finderPool, giftFinder, giveawayBannerOn, louisianaToday, readFinder,
  type FinderBudget, type FinderVibe, type FinderWho,
} from "@/content/giftGuideExtras1120";
import { PickRow } from "./GiftGuideView";
import { Hint } from "./GiftHint";
import { HINTS } from "@/content/giftWishList";

/**
 * The gift finder on the landing (owner approved 11-19 ~9:10 PM): three taps (who, budget, vibe) and the six best picks
 * from the guides, in their commission order with the vibe's picks first. The answers live in the URL
 * (/gift-guides?who=her&budget=50&vibe=cozy#gift-finder), so the link shares the same six; no sign-in.
 * Guard: src/test/giftGuideExtras1120.test.tsx.
 */
const FINDER_ID = "gift-finder";

function Choices<T extends string | number>({ label, options, value, onPick, attr }: { label: string; options: { id: T; label: string }[]; value: T | undefined; onPick: (v: T) => void; attr: string }) {
  return (
    <div role="group" aria-label={label} className="gg-finder-step" data-gift-finder-step={attr}>
      <p className="gg-finder-q">{label}</p>
      <span className="gg-chips">
        {options.map((o) => (
          <Button key={String(o.id)} type="button" variant="outline" size="sm" className={value === o.id ? "gg-chip btn-grad-primary" : "gg-chip"} aria-pressed={value === o.id}
            data-gift-finder-choice={`${attr}:${o.id}`} onClick={() => onPick(o.id)}>
            {o.label}
          </Button>
        ))}
      </span>
    </div>
  );
}

export function GiftFinder() {
  const { search } = useLocation();
  const navigate = useNavigate();
  useSyncExternalStore(subscribeGuidePicks, guidePicksVersion, guidePicksVersion);
  const a = readFinder(new URLSearchParams(search));
  const [copied, setCopied] = useState(false);
  const set = (next: { who?: FinderWho; budget?: FinderBudget; vibe?: FinderVibe }) => {
    const q = new URLSearchParams(search);
    for (const [k, v] of Object.entries({ ...a, ...next })) if (v !== undefined) q.set(k, String(v));
    setCopied(false);
    navigate({ search: `?${q.toString()}`, hash: FINDER_ID }, { replace: true });
  };
  const who = FINDER_WHO.find((x) => x.id === a.who);
  // The chosen guides' picks are lazy chunks: load them once "who" is picked.
  useEffect(() => {
    for (const g of who?.guides ?? []) loadGuidePicks(g.slug).catch((e: unknown) => console.warn("gift finder: picks chunk failed", g.slug, e));
  }, [who]);
  const done = a.who !== undefined && a.budget !== undefined && a.vibe !== undefined;
  const picks = done ? giftFinder(finderPool(a.who!, (slug) => guideBySlug(slug)?.picks ?? []), a.budget!, a.vibe!) : [];
  const copy = () => {
    void navigator.clipboard?.writeText(window.location.href).then(
      () => setCopied(true),
      // Clipboard refused: the address bar still holds the link.
      () => setCopied(false),
    );
  };
  return (
    <section id={FINDER_ID} aria-labelledby="gift-finder-title" className="gg-finder" data-gift-finder="">
      <div className="gg-rowhead"><h2 id="gift-finder-title">{W.finderTitle}</h2></div>
      {!a.who && <Hint id="quiz">{HINTS.quiz}</Hint>}
      <Choices label={W.finderWho} options={FINDER_WHO.map((x) => ({ id: x.id, label: x.label }))} value={a.who} onPick={(v) => set({ who: v })} attr="who" />
      {a.who && <Choices label={W.finderBudget} options={FINDER_BUDGETS} value={a.budget} onPick={(v) => set({ budget: v })} attr="budget" />}
      {a.who && a.budget !== undefined && <Choices label={W.finderVibe} options={FINDER_VIBES.map((x) => ({ id: x.id, label: x.label }))} value={a.vibe} onPick={(v) => set({ vibe: v })} attr="vibe" />}
      {done && (
        <div data-gift-finder-results="">
          <p className="gg-finder-q">{W.finderResults}</p>
          {picks.length ? <ol className="gg-list" data-gift-list="">{picks.map((p) => <PickRow key={`${p.href} ${p.name}`} pick={p} />)}</ol> : <p className="gg-price-note" data-gift-finder-none="">{W.finderNone}</p>}
          {a.budget !== 0 && <p className="gg-price-note">{W.finderAmazonNote}</p>}
          <span className="gg-chips">
            <Button type="button" variant="outline" size="sm" className="gg-chip" onClick={copy} data-gift-finder-share="">{copied ? W.finderCopied : W.finderShare}</Button>
            <Button asChild variant="link" size="inline" className="gg-link"><Link to={`/gift-guides#${FINDER_ID}`} data-gift-finder-again="">{W.finderAgain}</Link></Button>
          </span>
        </div>
      )}
    </section>
  );
}

/** The 25 Days banner and the Declutter link (OFF until the lead flips their flags on the owner's word). */
export function GatedBanners({ now }: { now?: Date }) {
  const today = louisianaToday(now ?? new Date());
  const giveaway = giveawayBannerOn(today, GIFT_GUIDE_FLAGS.giveawayBanner);
  const declutter = declutterTieInOn(GIFT_GUIDE_FLAGS.declutterTieIn);
  if (!giveaway && !declutter) return null;
  return (
    <div className="gg-gated" data-gift-gated="">
      {giveaway && <Link to="/25days" className="gg-link" data-gift-giveaway-banner="">{W.giveawayBanner} ›</Link>}
      {declutter && <Link to="/declutter" className="gg-link" data-gift-declutter-link="">{W.declutterTieIn} ›</Link>}
    </div>
  );
}
