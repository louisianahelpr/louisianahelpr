import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enPublic";
import { INFO_CARD_LIST, INFO_CARD_ROW, INFO_COLUMN, INFO_HEADER_COLUMN } from "./shortInfoCard";

/**
 * /fees (audit 11-10 F255, owner 2026-11-11 morning pop-up): what Louisiana Helpr charges, in words only. No rate and
 * no number (owner rule #20, membersSeeNoFeeWords): the owner's exact sentences (wording made exact 11-11 afternoon), nothing more. Guard:
 * src/test/feesAndSafetyPages.test.tsx.
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
      </ul>
    </PublicHeaderPage>
  );
}
