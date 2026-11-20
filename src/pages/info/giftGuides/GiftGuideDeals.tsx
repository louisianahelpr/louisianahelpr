import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { Button } from "@/components/ui/button";
import { giftGuides as G } from "@/content/giftGuides";
import { DEALS_SLUG, DEALS_WORDS as W, dealSections, dealsFeatured, dealsTitle, liveDeals, louisianaDay, type Deal } from "@/content/giftGuideDeals.mjs";
import { GiftOut } from "./GiftOut";
import { loadModule } from "@/lib/loadModule";

/**
 * /gift-guides/black-friday-cyber-monday (owner 2026-11-19): the deals guide. Deals first, one section per category
 * (Beauty, Home & Kitchen, Fashion, Kids & Toys, Tech, Outdoors, then Louisiana when it holds one), each card the
 * brand, the sale in the brand's words, a CODE chip with a copy button when there is a code, its end day, the photo
 * and a Shop button with our affiliate link. Never a price. The order inside a section is the generator's (our
 * commission, high to low; scripts/gift-guide-deals.mjs). A deal past its end day, or an announced one before its
 * start day, is hidden here at view time (giftGuideDeals.mjs dealShows), whatever the generated file still holds.
 * The deals file loads only when this page opens. Guard: src/test/giftGuideDeals1119.test.tsx.
 */

const DEALS_CSS = `
.gg-deals-intro{margin:10px 0 4px;font-size:15px;line-height:1.5;color:var(--gg-ink);max-width:46rem}
.gg-deals-ad{margin:0 0 6px;font-size:12px;color:var(--gg-muted)}
.gg-deal-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media (min-width:640px){.gg-deal-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (min-width:1100px){.gg-deal-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
.gg-deal{display:flex;flex-direction:column;gap:6px;min-width:0;padding:10px;border:1px solid var(--gg-line);border-radius:14px;background:#fff}
.gg-deal-photo{display:flex;align-items:center;justify-content:center;aspect-ratio:1/1;border-radius:10px;background:#faf6ee;overflow:hidden;isolation:isolate;text-decoration:none}
.gg-deal-photo img{width:100%;height:100%;object-fit:contain;padding:8px;mix-blend-mode:multiply}
.gg-deal-photo b{font-size:15px;color:var(--gg-muted);padding:8px;text-align:center}
.gg-deal-brand{margin:2px 0 0;font-size:15px;font-weight:700;color:var(--gg-ink);overflow-wrap:anywhere}
.gg-deal-text{margin:0;font-size:13px;line-height:1.4;color:var(--gg-ink);overflow-wrap:anywhere}
.gg-deal-meta{margin:0;font-size:12px;color:var(--gg-muted)}
.gg-deal-code{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}
.gg-deal-code code{font-size:12px;font-weight:700;letter-spacing:.04em;padding:3px 8px;border-radius:999px;background:var(--gg-soft);color:var(--gg-ink);overflow-wrap:anywhere}
.gg-deal .gg-deal-shop{margin-top:auto;width:100%;border-radius:999px;font-weight:700;color:var(--gg-olive);border-color:var(--gg-olive)}
.gg-deals-feature{display:flex;align-items:center;gap:14px;margin:4px 0 14px;padding:12px;border-radius:14px;border:1px solid var(--gg-line);background:#fff;color:var(--gg-ink);text-decoration:none}
.gg-deals-feature img{width:88px;height:88px;flex:none;border-radius:10px;object-fit:cover}
.gg-deals-feature b{display:block;font-size:16px}
.gg-deals-feature span{display:block;font-size:13px;color:var(--gg-muted);margin-top:2px}
.gg-deals-feature i{display:inline-flex;align-items:center;min-height:36px;margin-top:6px;padding:0 14px;border-radius:999px;background:hsl(var(--bark));color:#fff;font-style:normal;font-weight:700;font-size:13px}
`;

/** The guide's cover (public/gift-guides/deals/, drawn by scripts/gift-guide-deals-cover.py). */
export const DEALS_COVER = "/gift-guides/deals/black-friday-cyber-monday.webp";

/** The deals file, loaded alone (the read runs after it, outside Vite's preload wrapper: dynamicImportThenDoesNoWork). */
// loadModule: a prevented preload (a recovery reload in flight) gives null, and the page keeps "Loading deals…".
const loadDeals = () => loadModule(() => import("@/content/giftGuideDeals.json"));

/** One deal's card. */
function DealCard({ deal }: { deal: Deal }) {
  const [copied, setCopied] = useState(false);
  const [photoOk, setPhotoOk] = useState(true);
  const copy = (code: string) => {
    void navigator.clipboard?.writeText(code).then(
      () => setCopied(true),
      // Clipboard refused (permissions or an old browser): the code stays on screen to copy by hand.
      () => setCopied(false),
    );
  };
  return (
    <li className="gg-deal" data-gift-deal={deal.brand}>
      <GiftOut href={deal.href} className="gg-deal-photo">
        {deal.image && photoOk ? (
          <img loading="lazy" decoding="async" src={deal.image} alt={deal.item ?? ""} width={200} height={200} referrerPolicy="no-referrer-when-downgrade" onError={() => setPhotoOk(false)} />
        ) : (
          <b aria-hidden="true">{deal.brand}</b>
        )}
        <span className="sr-only">{W.shop(deal.brand)} ({G.newTab})</span>
      </GiftOut>
      <p className="gg-deal-brand">{deal.brand}</p>
      <p className="gg-deal-text" data-gift-deal-text="">{deal.deal}</p>
      {deal.code && (
        <p className="gg-deal-meta gg-deal-code" data-gift-deal-code={deal.code}>
          <span>{W.codeLabel}</span>
          <code>{deal.code}</code>
          <InlineTextButton className="no-underline" onClick={() => copy(deal.code!)} aria-label={`${G.copyCode} ${deal.code}`}>
            {copied ? G.copiedCode : G.copyCode}
          </InlineTextButton>
        </p>
      )}
      {(deal.ends || deal.store) && (
        <p className="gg-deal-meta" data-gift-deal-dates="">
          {[deal.ends ? W.endsOn(deal.ends) : "", deal.store ? G.onStore(deal.store) : ""].filter(Boolean).join(" · ")}
        </p>
      )}
      <Button asChild variant="outline" size="sm" className="gg-deal-shop">
        <GiftOut href={deal.href}>
          <span data-gift-shop="">{W.shop(deal.brand)}</span>
          <span aria-hidden="true">&nbsp;›</span>
          <span className="sr-only"> ({G.newTab})</span>
        </GiftOut>
      </Button>
    </li>
  );
}

/** The deals page's body. `now` is for tests; the page passes nothing and reads the clock. */
export function GiftGuideDeals({ now }: { now?: Date }) {
  const [deals, setDeals] = useState<Deal[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadDeals().then(
      (m) => live && m && setDeals(m.default as Deal[]),
      // The chunk failed to load (offline, a stale deploy): the page says the deals are gone rather than spin.
      () => live && setDeals([]),
    );
    return () => {
      live = false;
    };
  }, []);
  const today = louisianaDay(now ?? new Date());
  const sections = deals ? dealSections(liveDeals(deals, today)) : [];
  return (
    <div data-gift-deals-page="">
      <style>{DEALS_CSS}</style>
      <p className="gg-deals-intro">{W.intro}</p>
      <p className="gg-deals-ad" data-gift-deals-ad="">{W.disclosure}</p>
      {deals === null ? (
        <p className="gg-deal-meta" role="status">{W.loading}</p>
      ) : sections.length === 0 ? (
        <p className="gg-deals-intro" data-gift-deals-none="">
          {W.none} <Link to="/gift-guides" className="gg-link">{W.noneCta}</Link>
        </p>
      ) : (
        sections.map(({ category, deals: list }) => {
          const id = `gift-deals-${category.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-")}`;
          return (
            <section key={category} aria-labelledby={id} data-gift-deal-section={category}>
              <div className="gg-rowhead"><h2 id={id}>{category}<span className="gg-rowcount">&nbsp;({list.length})</span></h2></div>
              <ul className="gg-deal-grid">{list.map((d) => <DealCard key={`${d.brand} ${d.href}`} deal={d} />)}</ul>
            </section>
          );
        })
      )}
    </div>
  );
}

/**
 * The landing's featured slot (owner brief 2026-11-19): at the very top of /gift-guides from Nov 23 through Dec 1 in
 * Louisiana, then gone; after Dec 1 the guide itself is "Holiday Deals" (dealsTitle).
 */
export function DealsFeature({ now }: { now?: Date }) {
  const today = louisianaDay(now ?? new Date());
  if (!dealsFeatured(today)) return null;
  return (
    <>
      <style>{DEALS_CSS}</style>
      <Link to={`/gift-guides/${DEALS_SLUG}`} className="gg-deals-feature" data-gift-deals-feature="">
        <img src={DEALS_COVER} alt="" width={88} height={88} decoding="async" />
        <span>
          <b>{dealsTitle(today)}</b>
          <span>{W.featuredLine}</span>
          <i aria-hidden="true">{W.featuredCta} ›</i>
        </span>
      </Link>
    </>
  );
}
