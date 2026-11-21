import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { guideBySlug, guidePicksVersion, loadGuidePicks, loadSearchItems, newSlugFor, subscribeGuidePicks, topPicks, type SearchItem } from "@/content/giftGuideCatalog";
import { GIFT_GUIDE_FLAGS } from "@/content/giftGuideExtras1120";
import { FUN_WORDS as W, christmasCountdown, giftOfTheDay, giveawayTieInOn, louisianaYmd } from "@/content/giftGuideFun1120";
import { PickPrice, showsPrice } from "@/components/giftGuides/PickPrice";
import { PickThumb } from "../GiftGuideView";
import { loadModule } from "@/lib/loadModule";
import { getPublicOrigin } from "@/lib/authRedirects";
import { GiftOut } from "../GiftOut";
import { track } from "@/lib/analytics";

/**
 * The share sheet (src/lib/nativeShare.ts) lives in the signed-in-shared chunk, whose static imports are signed-in
 * code; imported here it put that chunk on every gift guide's first load (speed 11-20). It is loaded once the landing
 * has settled, with the search index below, so a tap on Share still opens the sheet inside the tap (./countdownShare).
 */
let shareModule: Promise<typeof import("./countdownShare") | null> | null = null;
const loadShare = () => (shareModule ??= loadModule(() => import("./countdownShare")));

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

/** The guide whose checked prices feed the Gift of the Day (its Stocking Stuffers, Under $25 and Under $50 sections). */
export const GOTD_SOURCE_GUIDE = "gifts-by-budget";

/**
 * On the /gift-guides landing (owner 2026-11-20): the Christmas countdown (Louisiana days) and the Gift of the Day as
 * ONE small card, below the guides (owner 11-20 PM, "still a busy mess": out of the top of the page). The gift is an
 * affordable, priced pick (owner 11-20: "The gift of the day shouldn't be expensive": giftOfTheDay, $50 or less, a
 * checked non-Amazon price, a well-known brand), from the Gifts by Budget picks (one small lazy chunk, fetched by this
 * card) and the Top 10; its whole name shows (wrapping, never cut with "..."), with its photo, price and a small
 * Share. Dec 1-25 a small "25 Days of Louisiana Giveaways is on" link behind the existing OFF flag
 * (GIFT_GUIDE_FLAGS.giveawayBanner; the lead flips it). Guard: src/test/giftGuideFun1120.test.tsx.
 */
export function GiftCountdown({ now: nowProp }: { now?: Date }) {
  const now = nowProp ?? new Date();
  const c = christmasCountdown(now);
  useSyncExternalStore(subscribeGuidePicks, guidePicksVersion, guidePicksVersion);
  useEffect(() => {
    loadGuidePicks(GOTD_SOURCE_GUIDE).catch((e: unknown) => {
      // The card then shows the countdown alone (no gift qualifies without the budget picks' prices).
      console.warn("gift of the day: budget picks chunk failed", e);
    });
  }, []);
  const today = louisianaYmd(now);
  const gift = giftOfTheDay([...(guideBySlug(GOTD_SOURCE_GUIDE)?.picks ?? []), ...topPicks()], now, (p) => showsPrice(p, today));
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
      loadShare().catch((e: unknown) => {
        // A failed fetch is retried by the tap below (loadModule's own stale-chunk recovery applies).
        shareModule = null;
        console.warn("gift of the day: share sheet failed to load", e);
      });
    }, 2500);
    return () => window.clearTimeout(t);
  }, []);
  const share = async () => {
    if (!gift) return;
    let m: Awaited<ReturnType<typeof loadShare>>;
    try {
      m = await loadShare();
    } catch (e) {
      shareModule = null;
      console.warn("gift of the day: share sheet failed to load", e);
      return;
    }
    // null: a recovery reload is on its way (loadModule); nothing to share into.
    if (!m) return;
    const out = await m.shareNative({ title: W.gotdTitle, text: W.gotdShareText(gift.name), url: `${getPublicOrigin()}${giftOfTheDayPath(gift.name, items)}`, suppressCopyConfirmation: true });
    setMsg(out === "copied" ? W.gotdCopied : null);
    if (out === "shared" || out === "copied") track("gift_of_the_day_shared", { how: out });
  };
  if (c.kind === "after" && !gift) return null;
  return (
    <section aria-label={W.gotdTitle} className="gg-today" data-gift-countdown="">
      <style>{COUNTDOWN_CSS}</style>
      <p className="gg-today-head">
        {gift && <span className="gg-today-k">{W.gotdTitle}</span>}
        {c.kind !== "after" && (
          <span className="gg-today-days" data-gift-countdown-days={c.kind === "days" ? c.days : c.kind}>
            {c.kind === "days" ? <>{c.days} {W.daysLeft(c.days)}</> : c.kind === "eve" ? W.eve : W.today}
          </span>
        )}
      </p>
      {gift && (
        <div className="gg-today-gift" id={GOTD_ID} data-gift-of-the-day={gift.href}>
          <GiftOut href={gift.href} className="gg-today-link">
            <PickThumb pick={gift} size={56} />
            <span className="gg-today-words">
              <span className="gg-today-name">{shortName(gift.name)}<span className="sr-only"> (opens in a new tab)</span></span>
              <PickPrice pick={gift} />
            </span>
          </GiftOut>
          <Button type="button" variant="ghost" size="inline" className="gg-today-share" aria-label={W.gotdShareLabel} onClick={() => void share()} data-gift-gotd-share="">{msg ?? W.gotdShare}</Button>
        </div>
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
.gg-today{margin:26px 0 4px;padding:14px 16px;border:1px solid var(--gg-line);border-radius:16px;background:hsl(var(--card));color:var(--gg-ink);min-width:0}
.gg-today-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2px 12px;margin:0;font-size:13px}
.gg-today-k{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gg-ink)}
.gg-today-days{font-weight:600;color:var(--gg-olive)}
.gg-today-words{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.gg-today-gift{display:flex;align-items:center;gap:10px;margin-top:10px;min-width:0}
.gg-today-link{display:flex;align-items:center;gap:12px;flex:1;min-width:0;min-height:44px;color:var(--gg-ink);text-decoration:none}
.gg-today-link .gg-thumb{width:56px;height:56px;border-radius:12px;padding:4px;background:#fff;border:0}
.gg-today-link .gg-photo{border-radius:12px;background:#fff}
.gg-today-name{min-width:0;font-size:14px;font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.gg-today-link:hover .gg-today-name,.gg-today-link:focus-visible .gg-today-name{text-decoration:underline}
.gg-today-share{flex:none;min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--gg-line);background:transparent;font-size:12.5px;font-weight:600;color:var(--gg-ink)}
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
