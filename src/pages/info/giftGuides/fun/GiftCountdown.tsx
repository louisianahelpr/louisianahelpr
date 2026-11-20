import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { loadSearchItems, newSlugFor, topPicks, type SearchItem } from "@/content/giftGuideCatalog";
import { GIFT_GUIDE_FLAGS } from "@/content/giftGuideExtras1120";
import { FUN_WORDS as W, christmasCountdown, giftOfTheDay, giveawayTieInOn } from "@/content/giftGuideFun1120";
import { PickPrice } from "@/components/giftGuides/PickPrice";
import { shareNative } from "@/lib/nativeShare";
import { getPublicOrigin } from "@/lib/authRedirects";
import { GiftOut } from "../GiftOut";
import { track } from "@/lib/analytics";

/** The line's anchor on the landing (the share's fallback when the pick names no guide). */
const GOTD_ID = "gift-of-the-day";

/**
 * Where a shared Gift of the Day opens (verify audit M7): the first guide that lists the pick (the gift search index,
 * name -> guide), at its section when that guide was merged into another (newSlugFor: "healthcare#rns"); else, and
 * until the index is in, the landing at the line.
 */
export function giftOfTheDayPath(name: string, items: readonly SearchItem[] | null): string {
  const slug = items?.find(([n]) => n === name)?.[1];
  const to = slug ? newSlugFor(slug) : null;
  return to ? `/gift-guides/${to}` : `/gift-guides#${GOTD_ID}`;
}

/** The gift's short name: a trailing "(…)" spec list dropped, as the Top 10 cards do. */
const shortName = (name: string) => name.replace(/\s*\([^()]*\)\s*$/, "") || name;

/**
 * On the /gift-guides landing (owner 2026-11-20; ONE slim line since owner 11-20 12:30 PM, "very busy and not well
 * organized"): the Christmas countdown (Louisiana days) and the Gift of the Day (one of the curated Top 10 picks, the
 * same all day, a new one each day; no Amazon price, PickPrice's own rule) with a small Share, and Dec 1-25 a small
 * "25 Days of Louisiana Giveaways is on" link behind the existing OFF flag (GIFT_GUIDE_FLAGS.giveawayBanner; the lead
 * flips it). No tip box. The fun tools are their own row (GiftTools). Guard: src/test/giftGuideFun1120.test.tsx.
 */
export function GiftCountdown({ now: nowProp }: { now?: Date }) {
  const now = nowProp ?? new Date();
  const c = christmasCountdown(now);
  const gift = giftOfTheDay(topPicks(), now);
  const [msg, setMsg] = useState<string | null>(null);
  // The gift search index (about 40 KB gzipped) names each pick's guide: fetched once the page has settled, never on
  // its critical path, so the share can open the pick's guide.
  const [items, setItems] = useState<SearchItem[] | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => {
      loadSearchItems().then(setItems, (e: unknown) => {
        // The share falls back to the landing's line; nothing else needs the index here.
        console.warn("gift of the day: search index failed", e);
      });
    }, 2500);
    return () => window.clearTimeout(t);
  }, []);
  const share = async () => {
    if (!gift) return;
    const out = await shareNative({ title: W.gotdTitle, text: W.gotdShareText(gift.name), url: `${getPublicOrigin()}${giftOfTheDayPath(gift.name, items)}`, suppressCopyConfirmation: true });
    setMsg(out === "copied" ? W.gotdCopied : null);
    if (out === "shared" || out === "copied") track("gift_of_the_day_shared", { how: out });
  };
  if (c.kind === "after" && !gift) return null;
  return (
    <section aria-label={W.gotdTitle} className="gg-today" data-gift-countdown="">
      <style>{COUNTDOWN_CSS}</style>
      {c.kind !== "after" && (
        <span className="gg-today-days" data-gift-countdown-days={c.kind === "days" ? c.days : c.kind}>
          {c.kind === "days" ? <><b>{c.days}</b> {W.daysLeft(c.days)}</> : <b>{c.kind === "eve" ? W.eve : W.today}</b>}
        </span>
      )}
      {gift && (
        <span className="gg-today-gift" id={GOTD_ID} data-gift-of-the-day={gift.href}>
          <span className="gg-today-k">{W.gotdTitle}:</span>
          <GiftOut href={gift.href} className="gg-today-name">{shortName(gift.name)}<span className="sr-only"> (opens in a new tab)</span></GiftOut>
          <PickPrice pick={gift} />
          <Button type="button" variant="ghost" size="inline" className="gg-today-share" aria-label={W.gotdShareLabel} onClick={() => void share()} data-gift-gotd-share="">{msg ?? W.gotdShare}</Button>
        </span>
      )}
      {giveawayTieInOn(now, GIFT_GUIDE_FLAGS.giveawayBanner.on) && (
        <Link to="/25days" className="gg-link" data-gift-giveaway-on="">{W.giveawayOn} ›</Link>
      )}
    </section>
  );
}

/**
 * The landing's tools (owner 11-20 12:30 PM plan): ONE row of four equal cards (Swipe, Secret Santa, Gift Planner, Free
 * Printables), four across on desktop and two by two on a phone. Guard: src/test/giftGuideFun1120.test.tsx.
 */
export function GiftTools() {
  return (
    <section aria-labelledby="gift-fun-tools" data-gift-tools="">
      <style>{TOOLS_CSS}</style>
      <div className="gg-rowhead"><h2 id="gift-fun-tools">{W.toolsTitle}</h2></div>
      <ul className="gg-fun-tools" data-gift-fun-tools="">
        {W.tools.map((t) => (
          <li key={t.to}>
            <Link to={t.to} className="gg-fun-tool" data-gift-fun-tool={t.to}><b>{t.title}</b><span>{t.body}</span></Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Scoped under .gg, shipped with the landing's own lazy chunk. */
const COUNTDOWN_CSS = `
.gg-today{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin:12px 0 2px;padding:8px 12px;border-radius:12px;background:var(--gg-soft);font-size:13px;color:var(--gg-ink);min-width:0}
.gg-today-days{white-space:nowrap;color:var(--gg-olive);font-weight:600}
.gg-today-days b{font-weight:800}
.gg-today-gift{display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 220px}
.gg-today-k{font-weight:700;white-space:nowrap}
.gg-today-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--gg-ink);text-decoration:underline;text-underline-offset:2px}
.gg-today-share{flex:none;min-height:32px;margin-left:auto;padding:0 12px;border-radius:999px;border:1px solid var(--gg-line);background:hsl(var(--card));font-size:12px;font-weight:600;color:var(--gg-ink)}
`;
const TOOLS_CSS = `
.gg-fun-tools{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;list-style:none;margin:0;padding:0}
@media (max-width:767px){.gg-fun-tools{grid-template-columns:repeat(2,minmax(0,1fr))}}
.gg-fun-tools>li{min-width:0}
.gg-fun-tool{display:flex;flex-direction:column;height:100%;min-height:84px;border:1px solid var(--gg-line);border-radius:14px;padding:12px 14px;text-decoration:none;color:var(--gg-ink);background:hsl(var(--card))}
.gg-fun-tool:hover,.gg-fun-tool:focus-visible{border-color:var(--gg-olive)}
.gg-fun-tool b{display:block;font-size:14px;color:var(--gg-olive)}
.gg-fun-tool span{display:block;font-size:12.5px;color:var(--gg-muted);margin-top:2px}
`;
