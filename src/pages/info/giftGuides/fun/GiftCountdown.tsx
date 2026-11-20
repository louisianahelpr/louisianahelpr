import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { loadSearchItems, newSlugFor, topPicks, type SearchItem } from "@/content/giftGuideCatalog";
import { GIFT_GUIDE_FLAGS } from "@/content/giftGuideExtras1120";
import { FUN_WORDS as W, christmasCountdown, giftOfTheDay, giveawayTieInOn } from "@/content/giftGuideFun1120";
import { PickPrice } from "@/components/giftGuides/PickPrice";
import { shareNative } from "@/lib/nativeShare";
import { getPublicOrigin } from "@/lib/authRedirects";
import { PickThumb, storeLabel } from "../GiftGuideView";
import { GiftOut } from "../GiftOut";
import { Hint } from "../GiftHint";
import { track } from "@/lib/analytics";

/** The card's anchor on the landing (the share's fallback when the pick names no guide). */
const GOTD_ID = "gift-of-the-day";

/**
 * Where a shared Gift of the Day opens (verify audit M7): the first guide that lists the pick (the gift search index,
 * name -> guide), at its section when that guide was merged into another (newSlugFor: "healthcare#rns"); else, and
 * until the index is in, the landing at the card.
 */
export function giftOfTheDayPath(name: string, items: readonly SearchItem[] | null): string {
  const slug = items?.find(([n]) => n === name)?.[1];
  const to = slug ? newSlugFor(slug) : null;
  return to ? `/gift-guides/${to}` : `/gift-guides#${GOTD_ID}`;
}

/**
 * On the /gift-guides landing (owner 2026-11-20): the Christmas countdown (Louisiana days), the Gift of the Day (one of
 * the curated Top 10 picks, the same all day, a new one each day; no Amazon price, PickPrice's own rule) with a share
 * button, the three fun tools, and Dec 1-25 a small "25 Days of Louisiana Giveaways is on" link behind the existing
 * OFF flag (GIFT_GUIDE_FLAGS.giveawayBanner; the lead flips it). Guard: src/test/giftGuideFun1120.test.tsx.
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
        // The share falls back to the landing's card; nothing else needs the index here.
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
  return (
    <section aria-label={W.gotdTitle} data-gift-countdown="">
      <style>{COUNTDOWN_CSS}</style>
      <div className="gg-countdown">
        {c.kind !== "after" && (
          <div className="gg-countdown-days" data-gift-countdown-days={c.kind === "days" ? c.days : c.kind}>
            {c.kind === "days" ? (
              <>
                <b>{c.days}</b>
                <span>{W.daysLeft(c.days)}</span>
              </>
            ) : (
              <b className="text-xl">{c.kind === "eve" ? W.eve : W.today}</b>
            )}
          </div>
        )}
        {gift && (
          <div className="gg-gotd" id={GOTD_ID} data-gift-of-the-day={gift.href}>
            <PickThumb pick={gift} size={72} />
            <div className="gg-gotd-body">
              <p className="gg-gotd-k">{W.gotdTitle}</p>
              <p className="gg-gotd-name" title={gift.name}>{gift.name}</p>
              <span className="gg-fun-row text-xs">
                {storeLabel(gift) && <small>{storeLabel(gift)}</small>}
                <PickPrice pick={gift} />
              </span>
              <span className="gg-fun-row mt-1">
                <Button asChild variant="outline" size="sm" className="gg-chip">
                  <GiftOut href={gift.href}>{W.gotdShop}<span className="sr-only"> {gift.name} (opens in a new tab)</span></GiftOut>
                </Button>
                <Button type="button" variant="outline" size="sm" className="gg-chip" aria-label={W.gotdShareLabel} onClick={() => void share()} data-gift-gotd-share="">{msg ?? W.gotdShare}</Button>
              </span>
            </div>
          </div>
        )}
      </div>
      <Hint id="fun-gotd">{W.hintGotd}</Hint>
      {giveawayTieInOn(now, GIFT_GUIDE_FLAGS.giveawayBanner.on) && (
        <Link to="/25days" className="gg-link" data-gift-giveaway-on="">{W.giveawayOn} ›</Link>
      )}
      <div className="gg-rowhead"><h2 id="gift-fun-tools">{W.toolsTitle}</h2></div>
      <ul className="gg-fun-tools" aria-labelledby="gift-fun-tools" data-gift-fun-tools="">
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
.gg-countdown{display:flex;flex-wrap:wrap;gap:12px;align-items:stretch;margin:14px 0 4px}
.gg-countdown-days{flex:1 1 160px;border-radius:16px;background:#eef2e6;color:#3f5a1c;padding:14px 16px;display:flex;flex-direction:column;justify-content:center}
.gg-countdown-days b{font-size:30px;line-height:1;font-weight:800}
.gg-countdown-days span{font-size:13px;font-weight:600;margin-top:4px}
.gg-gotd{flex:3 1 260px;display:flex;gap:12px;align-items:center;border:1px solid var(--gg-line);border-radius:16px;padding:12px;background:hsl(var(--card));min-width:0}
.gg-gotd-body{min-width:0;flex:1}
.gg-gotd-k{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#b26862;margin:0}
.gg-gotd-name{font-size:14px;font-weight:700;margin:2px 0 4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.gg-fun-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.gg-fun-tools{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;list-style:none;margin:0;padding:0}
.gg-fun-tool{display:block;height:100%;border:1px solid var(--gg-line);border-radius:14px;padding:12px 14px;text-decoration:none;color:var(--gg-ink);background:hsl(var(--card))}
.gg-fun-tool:hover,.gg-fun-tool:focus-visible{border-color:var(--gg-olive)}
.gg-fun-tool b{display:block;font-size:14px;color:var(--gg-olive)}
.gg-fun-tool span{display:block;font-size:12.5px;color:var(--gg-muted);margin-top:2px}
`;
