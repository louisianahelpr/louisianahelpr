import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enPublic";
import { INFO_CARD_LIST, INFO_CARD_ROW, INFO_COLUMN, INFO_HEADER_COLUMN } from "./shortInfoCard";
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
    <PublicHeaderPage title={t("fees.title")} backTo="/" bottomPaddingClassName="pb-8" headerWrapperClassName={INFO_HEADER_COLUMN}>
      <ul className={`${INFO_COLUMN} ${INFO_CARD_LIST}`} data-fees-body="">
        <li className={INFO_CARD_ROW}>{t("fees.postFree")}</li>
        <li className={INFO_CARD_ROW}>{t("fees.setupFee")}</li>
        <li className={INFO_CARD_ROW}>{t("fees.shownFirst")}</li>
        <li className={INFO_CARD_ROW}>{t("fees.helprsSeePay")}</li>
        {/* Design audit areas 11-18 #9: Declutter's buyer's fee, from checkout's own constants (owner 11-07). */}
        <li className={INFO_CARD_ROW} data-fees-declutter="">
          {t("fees.declutter", { pct: DECLUTTER_BUYER_FEE_PERCENT, cents: DECLUTTER_BUYER_FEE_FIXED_CENTS })}
        </li>
      </ul>
    </PublicHeaderPage>
  );
}
