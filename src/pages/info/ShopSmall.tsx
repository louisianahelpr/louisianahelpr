import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { SBS_WORDS as W } from "@/content/sbsFeaturedLocal";
import { GIFT_GUIDES_CSS } from "./giftGuides/giftGuidesStyles";
import { SmallBizLocal } from "./giftGuides/SmallBizLocal";
import { SmallBizGrid } from "./giftGuides/GiftGuideSmallBiz";
import { GuidesFrame } from "./giftGuides/fun/FunPage";
import { FeatureCtaLink } from "./giftGuides/SmallBizFeatureCta";

/**
 * /shop-small (owner 2026-11-21: "add the feature that small business can sign their business up to be featured on the
 * site"). The free "Featured local" listings and their sign-up form (owner 2026-11-20, migration
 * 20261120152039_sbs_featured_local, edge function sbs-featured) lived only on /gift-guides/small-business-saturday,
 * which the 11-21 "only three guides" change retired, so no visitor could reach them. This page is their live home: the
 * approved listings (an admin approves each one first, the owner's 11-20 rule, in /admin/sponsors), then "Get your
 * business featured" with the form opening in place. Works signed out; the contact email is never shown.
 * The guides' own tokens (.gg), one centered column; the cards stay two across at most in it.
 * Guard: src/test/shopSmallPage1121.test.tsx.
 */
const PAGE_CSS = `
.gg-shop-small{max-width:720px;margin:0;padding:4px 0 24px}
.gg-shop-small-lead{color:var(--gg-muted);font-size:14px;line-height:1.5;margin:0 0 8px}
@media (min-width:1100px){.gg-shop-small .gg-sb-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;

export default function ShopSmall() {
  usePageMeta(PUBLIC_PAGE_META["/shop-small"]);
  return (
    // Holiday audit 1121 #73: the gift guides' frame (head row, left menu), so the title shares its column's edge and
    // the page sits with its siblings in the menu. #61: the confirmed Louisiana 25 Days sponsors lead the page, so it is
    // never empty (sbs_public_featured held 0 listings on 2026-11-21), then the approved free listings and the form.
    <PublicHeaderPage title={W.pageTitle} backTo="/gift-guides" bottomPaddingClassName="pb-12 md:pb-16" wrapTitle hideHeader>
      <style>{GIFT_GUIDES_CSS}{PAGE_CSS}</style>
      <GuidesFrame title={W.pageTitle} path="/shop-small" disclosures={false}>
        <div className="gg-shop-small w-full" data-shop-small="">
          <p className="gg-shop-small-lead" data-shop-small-lead="">{W.pageLead}</p>
          {/* Owner 2026-11-21: the sign-up card stays at the bottom; this line at the top jumps to it and opens the form. */}
          <FeatureCtaLink />
          <section aria-labelledby="shop-small-sponsors" data-shop-small-sponsors="">
            <div className="gg-rowhead"><h2 id="shop-small-sponsors">{W.pageSponsorsTitle}</h2></div>
            <SmallBizGrid />
          </section>
          <SmallBizLocal sponsors={[]} heading={{ title: W.pageSectionTitle, intro: W.pageSectionIntro }} />
        </div>
      </GuidesFrame>
    </PublicHeaderPage>
  );
}
