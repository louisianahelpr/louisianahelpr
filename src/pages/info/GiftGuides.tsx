import { Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { giftGuidePageMeta } from "@/lib/giftGuidePageMeta.mjs";
import { giftGuides as G } from "@/content/giftGuides";
import { useSyncExternalStore } from "react";
import { ROWS, guideBySlug, guidePicksVersion, newSlugFor, subscribeGuidePicks, type CatalogGuide, type GuideRow } from "@/content/giftGuideCatalog";
import { GIFT_GUIDES_CSS } from "./giftGuides/giftGuidesStyles";
import { GIFT_WISH_CSS } from "./giftGuides/giftWishStyles";
import { GiftGuidesWords } from "./giftGuides/GiftGuideCover";
import { GiftGuideLanding } from "./giftGuides/GiftGuideLanding";
import { GiftGuideMyList } from "./giftGuides/GiftGuideMyList";
import { GiftGuideSharedList } from "./giftGuides/GiftGuideSharedList";
import { useWishListSync } from "./giftGuides/wishListSync";
import { FirstHeartHint } from "./giftGuides/GiftGuideHints";
import { WISH } from "@/content/giftWishList";
import { MY_LIST_SLUG } from "./giftGuides/giftList";
import { GiftGuideTools } from "./giftGuides/GiftGuideShare";
import { shippingLine } from "@/content/giftGuideShipping";
import { GiftGuideView } from "./giftGuides/GiftGuideView";
import { GiftGuidesSidebar } from "./giftGuides/GiftGuidesSidebar";
import { DEALS_COVER, GiftGuideDeals } from "./giftGuides/GiftGuideDeals";
import { DEALS_SLUG, DEALS_WORDS, dealsTitle, louisianaDay } from "@/content/giftGuideDeals.mjs";
import { GiftGuideSmallBiz } from "./giftGuides/GiftGuideSmallBiz";
import { SMALL_BIZ_SLUG, SMALL_BIZ_WORDS, smallBizDay, smallBizTitle } from "@/content/giftGuideSmallBiz.mjs";

/**
 * /gift-guides and /gift-guides/<slug> (owner 2026-11-16, public 2026-11-18; rebuilt 2026-11-18 to the owner's final
 * design): the page opens to the guides (a collapsible sidebar of every guide by group, and one sideways row of cover
 * tiles per group), and a tile opens that guide (a gingham band with its arch card, then its numbered list) or, for a
 * hub like For Kids, its child guides' tiles. Every word, pick and link comes from src/content/giftGuides.ts and
 * src/content/giftGuidesAmazon.ts (gathered in src/content/giftGuideCatalog.ts). Every outbound link is an affiliate
 * link (GiftOut). The FTC disclosure (16 CFR Part 255) and Amazon's required Associates statement sit at the BOTTOM
 * as plain muted lines (owner decision 2026-11-18). Guard: src/test/giftGuidesPage.test.tsx.
 */
/** The guide's head: its picks' first three names and their count (unique links, as src/prerender/seoData.ts counts). */
function guideHead(guide: CatalogGuide) {
  const seen = new Set<string>();
  const picks = guide.picks.filter((p) => p.name && p.href && !seen.has(p.href) && seen.add(p.href));
  return giftGuidePageMeta(guide.slug, guide.title, picks.slice(0, 3).map((p) => p.name), picks.length);
}

export default function GiftGuides() {
  const { slug: rawSlug, code } = useParams<{ slug?: string; code?: string }>();
  // My Wish List is /gift-guides/my-list (owner 2026-11-20); a shared list is /gift-guides/list/<code>.
  const myListPage = rawSlug === MY_LIST_SLUG;
  const slug = myListPage ? undefined : rawSlug;
  const shared = code !== undefined;
  // Signed in, the wish list is kept on the account too.
  useWishListSync();
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const guide = guideBySlug(slug) ?? null;
  // The Black Friday & Cyber Monday deals guide (owner 2026-11-19) is its own page, not a catalog list of picks.
  // The Small Business Saturday page (owner 2026-11-19, big batch 1120) is its own page too. `deals` covers both own
  // pages wherever the page only asks "is this a catalog guide?".
  const smallBiz = slug === SMALL_BIZ_SLUG;
  const deals = slug === DEALS_SLUG || smallBiz;
  const dealsName = smallBiz ? smallBizTitle(smallBizDay(new Date())) : dealsTitle(louisianaDay(new Date()));
  // SEO (follow-up 2026-11-18): the landing's head, or the open guide's own (one not in the sitemap is noindex).
  // SEO P1 (owner 11-19): its own description from its picks once they are in, as api/share.ts writes it before JS.
  useSyncExternalStore(subscribeGuidePicks, guidePicksVersion);
  usePageMeta(
    shared || myListPage ? { title: `${shared ? WISH.sharedLead : WISH.title} — Louisiana Helpr`, description: PUBLIC_PAGE_META["/gift-guides"].description, robots: "noindex" }
    : deals ? giftGuidePageMeta(smallBiz ? SMALL_BIZ_SLUG : DEALS_SLUG) : guide ? guideHead(guide) : PUBLIC_PAGE_META["/gift-guides"],
  );
  const groupParam = params.get("group");
  const ship = shippingLine(new Date());
  // Visual check 11-18: at 375 the long pill squeezed "Gift guides" into "Gift / guid / es"; phones get the short words.
  const shipTail = " for Christmas delivery";
  const shipPill = ship ? (
    <p className="gg-ship whitespace-nowrap" data-gift-ship="">
      {ship.endsWith(shipTail) ? ship.slice(0, -shipTail.length) : ship}
      {ship.endsWith(shipTail) && <span className="hidden sm:inline">{shipTail}</span>}
    </p>
  ) : undefined;
  // The old My list address (?list=mine) opens My Wish List's own page.
  const oldMyList = !slug && !shared && !myListPage && params.get("list") === "mine";
  const myList = myListPage;
  const group = ROWS.find((r) => r.row === groupParam)?.row ?? (null as GuideRow | null);

  // Pins link to /gift-guides#for-her, /gift-guides/for-her or a folded guide (/gift-guides/female-nurses): send each
  // old slug, folded guide or #<slug> to the guide's page now (newSlugFor).
  const hashSlug = decodeURIComponent(hash.replace(/^#/, ""));
  const fromHash = hashSlug ? newSlugFor(hashSlug) : null;
  if (oldMyList) return <Navigate to={`/gift-guides/${MY_LIST_SLUG}`} replace />;
  if (!slug && !shared && !myListPage && fromHash) return <Navigate to={`/gift-guides/${fromHash}`} replace />;
  const moved = slug && !guide && !deals ? newSlugFor(slug) : null;
  if (moved) return <Navigate to={`/gift-guides/${moved}`} replace />;
  if (slug && !guide && !deals) return <Navigate to="/gift-guides" replace />;

  const footer = (
    <footer className="gg-disc">
      {/* Owner decision 2026-11-18 (~8:50 AM): the disclosures are plain muted lines at the BOTTOM, no box. The
          Amazon line is the exact statement the Amazon Associates Operating Agreement requires on a site with
          Amazon links. */}
      <p data-gift-disclosure="">{G.disclosure}</p>
      <p data-gift-amazon-statement="">{G.amazonStatement}</p>
      {/* Owner 11-18 PM: no "Every collection on ShopMy" / "Every gift guide on Pinterest" links; the disclosures stay. */}
    </footer>
  );

  return (
    // Holistic review 11-18 L6: the landing's back arrow went home; the landing has none now (the bar's logo is the way
    // home), and My list or a group's page goes back to the landing.
    <PublicHeaderPage title={G.pageTitle} titleTag="p" backTo={guide || deals || myList || shared || group ? "/gift-guides" : "/"} hideBack={!guide && !deals && !myList && !shared && !group} bottomPaddingClassName="pb-12 md:pb-16"
      titleActions={shipPill}>
      <style>{GIFT_GUIDES_CSS + GIFT_WISH_CSS}</style>
      {/* The first heart's one-time "Saved to your wish list" note (owner 2026-11-20 hints), on every gift guides page. */}
      <FirstHeartHint />
      {/* The full public container (78rem), never a narrower page column (owner 2026-11-18: "fill the screen"). */}
      <div className="gg w-full" data-gift-guides="">
        {/* Owner's mockup (2026-11-18): the way back and the header words run across the top, above the menu and the guides. */}
        {/* Owner 2026-11-18 PM: the shipping pill sits on the page header's own row ("← Gift guides"), right-aligned
            (titleActions above), so no row of its own sits above the hero. A guide page has no second "← All guides"
            link ("double back button?? does the same thing"): the header's back arrow goes to /gift-guides. */}
        {/* Owner redesign 11-18 PM: under the title ONE slim row (search, My list, Share); Text and Copy link sit in
            Share's menu and the codes are a "Deals & codes" section of the page. The banner title is the page's h1
            (live audit r3 #7); the header's "Gift guides" is a plain line (titleTag="p"). */}
        {deals ? (
          smallBiz ? (
            <GiftGuidesWords lead={SMALL_BIZ_WORDS.lead} title={dealsName} titleId="gift-guide-title" tint="green"
              tools={<GiftGuideTools path={`/gift-guides/${SMALL_BIZ_SLUG}`} title={dealsName} />} />
          ) : (
            <GiftGuidesWords lead={DEALS_WORDS.lead} title={dealsName} titleId="gift-guide-title" tint="red"
              tools={<GiftGuideTools path={`/gift-guides/${DEALS_SLUG}`} title={dealsName} image={DEALS_COVER} />} />
          )
        ) : guide ? (
          <GiftGuidesWords lead={guide.age ? `${guide.lead}, ${guide.age}` : guide.lead} title={guide.title} titleId="gift-guide-title" tint={guide.tint}
            tools={<GiftGuideTools path={`/gift-guides/${guide.slug}`} title={`${guide.lead} ${guide.title}`} image={guide.cover} />} />
        ) : (
          <GiftGuidesWords lead={G.bandLead} title={G.title} titleId="gift-guides-title" tools={<GiftGuideTools path="/gift-guides" title={G.title} many myList={myList} />} />
        )}
        <div className="gg-layout">
          <GiftGuidesSidebar active={guide} myList={myList} />
          <div className="gg-main">
            {smallBiz ? <GiftGuideSmallBiz /> : deals ? <GiftGuideDeals /> : guide ? <GiftGuideView guide={guide} /> : shared ? <GiftGuideSharedList code={code} /> : myList ? <GiftGuideMyList /> : <GiftGuideLanding group={group} />}{footer}
          </div>
        </div>
      </div>
    </PublicHeaderPage>
  );
}
