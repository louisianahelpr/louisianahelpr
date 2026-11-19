import { Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { giftGuidePageMeta } from "@/lib/giftGuidePageMeta.mjs";
import { giftGuides as G } from "@/content/giftGuides";
import { ROWS, guideBySlug, newSlugFor, type GuideRow } from "@/content/giftGuideCatalog";
import { GIFT_GUIDES_CSS } from "./giftGuides/giftGuidesStyles";
import { GiftGuidesWords } from "./giftGuides/GiftGuideCover";
import { GiftGuideLanding } from "./giftGuides/GiftGuideLanding";
import { GiftGuideMyList } from "./giftGuides/GiftGuideMyList";
import { GiftGuideTools } from "./giftGuides/GiftGuideShare";
import { shippingLine } from "@/content/giftGuideShipping";
import { GiftGuideView } from "./giftGuides/GiftGuideView";
import { GiftGuidesSidebar } from "./giftGuides/GiftGuidesSidebar";

/**
 * /gift-guides and /gift-guides/<slug> (owner 2026-11-16, public 2026-11-18; rebuilt 2026-11-18 to the owner's final
 * design): the page opens to the guides (a collapsible sidebar of every guide by group, and one sideways row of cover
 * tiles per group), and a tile opens that guide (a gingham band with its arch card, then its numbered list) or, for a
 * hub like For Kids, its child guides' tiles. Every word, pick and link comes from src/content/giftGuides.ts and
 * src/content/giftGuidesAmazon.ts (gathered in src/content/giftGuideCatalog.ts). Every outbound link is an affiliate
 * link (GiftOut). The FTC disclosure (16 CFR Part 255) and Amazon's required Associates statement sit at the BOTTOM
 * as plain muted lines (owner decision 2026-11-18). Guard: src/test/giftGuidesPage.test.tsx.
 */
export default function GiftGuides() {
  const { slug } = useParams<{ slug?: string }>();
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const guide = guideBySlug(slug) ?? null;
  // SEO (follow-up 2026-11-18): the landing's head, or the open guide's own (one not in the sitemap is noindex).
  usePageMeta(guide ? giftGuidePageMeta(guide.slug, guide.title) : PUBLIC_PAGE_META["/gift-guides"]);
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
  const myList = !guide && params.get("list") === "mine";
  const group = ROWS.find((r) => r.row === groupParam)?.row ?? (null as GuideRow | null);

  // Pins link to /gift-guides#for-her, /gift-guides/for-her or a folded guide (/gift-guides/female-nurses): send each
  // old slug, folded guide or #<slug> to the guide's page now (newSlugFor).
  const hashSlug = decodeURIComponent(hash.replace(/^#/, ""));
  const fromHash = hashSlug ? newSlugFor(hashSlug) : null;
  if (!slug && fromHash) return <Navigate to={`/gift-guides/${fromHash}`} replace />;
  const moved = slug && !guide ? newSlugFor(slug) : null;
  if (moved) return <Navigate to={`/gift-guides/${moved}`} replace />;
  if (slug && !guide) return <Navigate to="/gift-guides" replace />;

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
    <PublicHeaderPage title={G.pageTitle} titleTag="p" backTo={guide ? "/gift-guides" : "/"} bottomPaddingClassName="pb-12 md:pb-16"
      titleActions={shipPill}>
      <style>{GIFT_GUIDES_CSS}</style>
      {/* The full public container (78rem), never a narrower page column (owner 2026-11-18: "fill the screen"). */}
      <div className="gg w-full" data-gift-guides="">
        {/* Owner's mockup (2026-11-18): the way back and the header words run across the top, above the menu and the guides. */}
        {/* Owner 2026-11-18 PM: the shipping pill sits on the page header's own row ("← Gift guides"), right-aligned
            (titleActions above), so no row of its own sits above the hero. A guide page has no second "← All guides"
            link ("double back button?? does the same thing"): the header's back arrow goes to /gift-guides. */}
        {/* Owner redesign 11-18 PM: under the title ONE slim row (search, My list, Share); Text and Copy link sit in
            Share's menu and the codes are a "Deals & codes" section of the page. The banner title is the page's h1
            (live audit r3 #7); the header's "Gift guides" is a plain line (titleTag="p"). */}
        {guide ? (
          <GiftGuidesWords lead={guide.age ? `${guide.lead}, ${guide.age}` : guide.lead} title={guide.title} titleId="gift-guide-title" tint={guide.tint}
            tools={<GiftGuideTools path={`/gift-guides/${guide.slug}`} title={`${guide.lead} ${guide.title}`} image={guide.cover} />} />
        ) : (
          <GiftGuidesWords lead={G.bandLead} title={G.title} titleId="gift-guides-title" tools={<GiftGuideTools path="/gift-guides" title={G.title} many myList={myList} />} />
        )}
        <div className="gg-layout">
          <GiftGuidesSidebar active={guide} myList={myList} />
          <div className="gg-main">
            {guide ? <GiftGuideView guide={guide} /> : myList ? <GiftGuideMyList /> : <GiftGuideLanding group={group} />}{footer}
          </div>
        </div>
      </div>
    </PublicHeaderPage>
  );
}
