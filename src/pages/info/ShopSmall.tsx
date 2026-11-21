import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { SBS_WORDS as W } from "@/content/sbsFeaturedLocal";
import { FunBody, funHeader } from "./giftGuides/fun/FunPage";
import { SmallBizLocal } from "./giftGuides/SmallBizLocal";

/**
 * /shop-small (owner 2026-11-21: "add the feature that small business can sign their business up to be featured on the
 * site"). The free "Featured local" listings and their sign-up form (owner 2026-11-20, migration
 * 20261120152039_sbs_featured_local, edge function sbs-featured) lived only on /gift-guides/small-business-saturday,
 * which the 11-21 "only three guides" change retired, so no visitor could reach them. This page is their live home: the
 * approved listings (an admin approves each one first, the owner's 11-20 rule, in /admin/sponsors), then "Get your
 * business featured" with the form opening in place. Works signed out; the contact email is never shown.
 * Guard: src/test/shopSmallPage1121.test.tsx.
 */
export default function ShopSmall() {
  return (
    <PublicHeaderPage {...funHeader(W.pageTitle)}>
      <FunBody title={W.pageTitle} path="/shop-small">
        <p className="gg-fun-lead" data-shop-small-lead="">{W.pageLead}</p>
        <SmallBizLocal sponsors={[]} heading={{ title: W.pageSectionTitle, intro: W.pageSectionIntro }} />
      </FunBody>
    </PublicHeaderPage>
  );
}
