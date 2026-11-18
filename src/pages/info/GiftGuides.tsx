import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
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
import { GiftGuideShare } from "./giftGuides/GiftGuideShare";
import { shippingLine } from "@/content/giftGuideShipping";
import { GiftGuideView } from "./giftGuides/GiftGuideView";
import { GiftGuidesSidebar } from "./giftGuides/GiftGuidesSidebar";
import { GiftOut } from "./giftGuides/GiftOut";

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
      <p className="gg-more">
        {G.allLinks.map((l) => <GiftOut key={l.href} href={l.href} className="gg-link">{l.label}</GiftOut>)}
      </p>
    </footer>
  );

  return (
    <PublicHeaderPage title={G.pageTitle} backTo={guide ? "/gift-guides" : "/"} wrapTitle bottomPaddingClassName="pb-12 md:pb-16">
      <style>{GIFT_GUIDES_CSS}</style>
      {/* The full public container (78rem), never a narrower page column (owner 2026-11-18: "fill the screen"). */}
      <div className="gg w-full" data-gift-guides="">
        {/* Owner's mockup (2026-11-18): the way back and the header words run across the top, above the menu and the guides. */}
        {/* Owner 2026-11-18: the shipping banner sits top-right, on the same line as "← All guides". */}
        <div className="gg-top">
          {guide ? <Link to="/gift-guides" className="gg-link" data-gift-back="">← {G.allGuidesLabel}</Link> : <span />}
          {ship && <p className="gg-ship" data-gift-ship="">{ship}</p>}
        </div>
        {guide ? (
          <GiftGuidesWords lead={guide.age ? `${guide.lead}, ${guide.age}` : guide.lead} title={guide.title} titleId="gift-guide-title"
            share={<GiftGuideShare path={`/gift-guides/${guide.slug}`} title={`${guide.lead} ${guide.title}`} image={guide.cover} />} />
        ) : (
          <GiftGuidesWords lead={G.bandLead} title={G.title} titleId="gift-guides-title" share={<GiftGuideShare path="/gift-guides" title={G.title} />} />
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
