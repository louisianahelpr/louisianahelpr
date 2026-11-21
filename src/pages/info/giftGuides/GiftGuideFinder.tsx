import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { guideBySlug, guidePicksVersion, loadGuidePicks, subscribeGuidePicks } from "@/content/giftGuideCatalog";
import {
  EXTRAS_WORDS as W, FINDER_BUDGET_GUIDES, FINDER_BUDGETS, FINDER_VIBES, FINDER_WHO, GIFT_GUIDE_FLAGS, declutterTieInOn, finderPool, giftFinder, giveawayBannerOn, louisianaToday, readFinder,
  type FinderBudget, type FinderVibe, type FinderWho,
} from "@/content/giftGuideExtras1120";
import { PickRow } from "./GiftGuideView";

/**
 * The gift finder on the landing (owner approved 11-19 ~9:10 PM): three taps (who, budget, vibe) and always a list
 * (owner 11-20): the picks that fit all three, then "Close matches" (giftFinder), in the guides' own order. The answers
 * live in the URL (/gift-guides?who=her&budget=50&vibe=cozy#gift-finder), so the link shares the same list; no sign-in.
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

/** The finder's heading id; the folded card and the open finder each render it, never both at once. */
const FINDER_TITLE_ID = "gift-finder-title";

export function GiftFinder() {
  const { search, hash } = useLocation();
  const navigate = useNavigate();
  useSyncExternalStore(subscribeGuidePicks, guidePicksVersion, guidePicksVersion);
  const a = readFinder(new URLSearchParams(search));
  const [copied, setCopied] = useState(false);
  // Owner 11-20 PM ("still a busy mess"): folded into ONE card until tapped; a shared answer link
  // (?who=...#gift-finder) or "Start over" (#gift-finder) opens it straight away.
  const [open, setOpen] = useState(() => a.who !== undefined || hash === `#${FINDER_ID}`);
  useEffect(() => {
    if (a.who !== undefined || hash === `#${FINDER_ID}`) setOpen(true);
  }, [a.who, hash]);
  const set = (next: { who?: FinderWho; budget?: FinderBudget; vibe?: FinderVibe }) => {
    const q = new URLSearchParams(search);
    for (const [k, v] of Object.entries({ ...a, ...next })) if (v !== undefined) q.set(k, String(v));
    setCopied(false);
    navigate({ search: `?${q.toString()}`, hash: FINDER_ID }, { replace: true });
  };
  const who = FINDER_WHO.find((x) => x.id === a.who);
  // The chosen guides' picks are lazy chunks: load them once "who" is picked (and the budget guides once a budget is).
  const withBudget = a.budget !== undefined && a.budget !== 0;
  useEffect(() => {
    const slugs = [...(who?.guides ?? []).map((g) => g.slug), ...(who && withBudget ? FINDER_BUDGET_GUIDES : [])];
    for (const slug of slugs) loadGuidePicks(slug).catch((e: unknown) => console.warn("gift finder: picks chunk failed", slug, e));
  }, [who, withBudget]);
  const done = a.who !== undefined && a.budget !== undefined && a.vibe !== undefined;
  const picksOf = (slug: string) => guideBySlug(slug)?.picks ?? [];
  const result = done ? giftFinder(finderPool(a.who!, picksOf), a.budget!, a.vibe!, FINDER_BUDGET_GUIDES.flatMap(picksOf), a.who) : { exact: [], close: [] };
  const copy = () => {
    void navigator.clipboard?.writeText(window.location.href).then(
      () => setCopied(true),
      // Clipboard refused: the address bar still holds the link.
      () => setCopied(false),
    );
  };
  if (!open) {
    return (
      <section id={FINDER_ID} aria-labelledby={FINDER_TITLE_ID} className="gg-finder gg-finder-folded" data-gift-finder="" data-gift-finder-folded="">
        <h2 id={FINDER_TITLE_ID} className="gg-finder-title">
          {/* The shared Button (OWN-SHARED, noNewHandMadeControls); .gg-finder-open restyles it as the card's row. */}
          <Button type="button" variant="ghost" size="inline" className="gg-finder-open" aria-expanded={false} aria-controls={`${FINDER_ID}-steps`} onClick={() => setOpen(true)} data-gift-finder-open="">
            <span className="gg-finder-open-words">
              <span>{W.finderTitle}</span>
              <small>{W.finderFolded}</small>
            </span>
            <span className="gg-finder-arrow" aria-hidden="true">→</span>
          </Button>
        </h2>
      </section>
    );
  }
  return (
    <section id={FINDER_ID} aria-labelledby={FINDER_TITLE_ID} className="gg-finder" data-gift-finder="">
      <h2 id={FINDER_TITLE_ID} className="gg-finder-title">{W.finderTitle}</h2>
      <div id={`${FINDER_ID}-steps`} className="gg-finder-steps">
      {!a.who && <p className="gg-finder-lead">{W.finderLead}</p>}
      <Choices label={W.finderWho} options={FINDER_WHO.map((x) => ({ id: x.id, label: x.label }))} value={a.who} onPick={(v) => set({ who: v })} attr="who" />
      {a.who && <Choices label={W.finderBudget} options={FINDER_BUDGETS} value={a.budget} onPick={(v) => set({ budget: v })} attr="budget" />}
      {a.who && a.budget !== undefined && <Choices label={W.finderVibe} options={FINDER_VIBES.map((x) => ({ id: x.id, label: x.label }))} value={a.vibe} onPick={(v) => set({ vibe: v })} attr="vibe" />}
      {done && (
        <div data-gift-finder-results="">
          <p className="gg-finder-q">{W.finderResults}</p>
          {result.exact.length > 0 && <ol className="gg-list" data-gift-list="">{result.exact.map((p) => <PickRow key={`${p.href} ${p.name}`} pick={p} />)}</ol>}
          {result.close.length > 0 && (
            <>
              <p className="gg-price-note" data-gift-finder-close="">{W.finderClose}</p>
              <ol className="gg-list" data-gift-list="" data-gift-finder-close-list="">{result.close.map((p) => <PickRow key={`${p.href} ${p.name}`} pick={p} />)}</ol>
            </>
          )}
          {!result.exact.length && !result.close.length && <p className="gg-price-note" data-gift-finder-none="">{W.finderNone}</p>}
          <span className="gg-chips">
            <Button type="button" variant="outline" size="sm" className="gg-chip" onClick={copy} data-gift-finder-share="">{copied ? W.finderCopied : W.finderShare}</Button>
            <Button asChild variant="link" size="inline" className="gg-link"><Link to={`/gift-guides#${FINDER_ID}`} data-gift-finder-again="">{W.finderAgain}</Link></Button>
          </span>
        </div>
      )}
      </div>
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
