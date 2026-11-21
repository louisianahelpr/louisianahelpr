import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { SBS_WORDS as W } from "@/content/sbsFeaturedLocal";
import { GIFT_GUIDES_CSS } from "./giftGuides/giftGuidesStyles";
import { SmallBizLocal } from "./giftGuides/SmallBizLocal";

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
.gg-shop-small{max-width:720px;margin:0 auto;padding:4px 0 24px}
.gg-shop-small-lead{color:var(--gg-muted);font-size:14px;line-height:1.5;margin:0 0 8px}
@media (min-width:1100px){.gg-shop-small .gg-sb-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;

export default function ShopSmall() {
  usePageMeta(PUBLIC_PAGE_META["/shop-small"]);
  return (
    <PublicHeaderPage title={W.pageTitle} backTo="/gift-guides" bottomPaddingClassName="pb-12 md:pb-16" wrapTitle>
      <style>{GIFT_GUIDES_CSS}{PAGE_CSS}</style>
      <div className="gg gg-shop-small w-full" data-shop-small="">
        <p className="gg-shop-small-lead" data-shop-small-lead="">{W.pageLead}</p>
        <SmallBizLocal sponsors={[]} heading={{ title: W.pageSectionTitle, intro: W.pageSectionIntro }} />
      </div>
    </PublicHeaderPage>
  );
}
