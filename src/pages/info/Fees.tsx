import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enPublic";
import { DECLUTTER_BUYER_FEE_FIXED_CENTS, DECLUTTER_BUYER_FEE_PERCENT } from "@/lib/declutter/money";

/**
 * /fees (audit 11-10 F255, owner 2026-11-11 morning pop-up): what Louisiana Helpr charges, in words only. No rate and
 * no number for Jobs (owner rule #20, membersSeeNoFeeWords): the owner's exact sentences (wording made exact 11-11 afternoon).
 * Declutter's line (design audit areas 11-18 #9) names its buyer's fee from money.ts, as Help and the Terms do (owner
 * 11-07: Declutter shows its fee). Guards: src/test/feesAndSafetyPages.test.tsx, src/test/area01LandingGuest1118.test.tsx.
 */
export default function Fees() {
  usePageMeta(PUBLIC_PAGE_META["/fees"]);
  // F260q (owner 11-11): Spanish when chosen; the English is the owner's exact sentences, in enPublic.ts.
  const { t } = useLanguage();
  return (
    <PublicHeaderPage title={t("fees.title")} backTo="/" bottomPaddingClassName="pb-8">
      <div className="page-measure mx-auto space-y-3 font-sans text-ds-15 leading-relaxed text-foreground" data-fees-body="">
        <p>{t("fees.postFree")}</p>
        <p>{t("fees.setupFee")}</p>
        <p>{t("fees.shownFirst")}</p>
        <p>{t("fees.helprsSeePay")}</p>
        {/* Design audit areas 11-18 #9: Declutter's buyer's fee, from checkout's own constants (owner 11-07). */}
        <p data-fees-declutter="">
          {t("fees.declutter", { pct: DECLUTTER_BUYER_FEE_PERCENT, cents: DECLUTTER_BUYER_FEE_FIXED_CENTS })}
        </p>
      </div>
    </PublicHeaderPage>
  );
}
