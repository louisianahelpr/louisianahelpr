import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { useIdCheckOnForViewer } from "@/lib/useIdCheckOnForViewer";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enPublic";

/**
 * /safety (audit 11-10 F255, owner 2026-11-11 morning pop-up): every member is ID-checked, money is held until you
 * approve the work, and a problem can be reported from any job. The ID line follows the identity_check switch
 * (useIdCheckOnForViewer; identityCheckOffEntryPoints), so the page never promises a check that is off.
 * Guard: src/test/feesAndSafetyPages.test.tsx.
 */
export default function Safety() {
  usePageMeta(PUBLIC_PAGE_META["/safety"]);
  const idCheckOn = useIdCheckOnForViewer();
  // F260q (owner 11-11): Spanish when chosen (enPublic.ts / esPublic.ts).
  const { t } = useLanguage();
  return (
    <PublicHeaderPage title={t("safety.title")} backTo="/" bottomPaddingClassName="pb-8">
      <ul className="page-measure mx-auto list-disc space-y-3 pl-5 font-sans text-ds-15 leading-relaxed text-foreground" data-safety-body="">
        {idCheckOn && <li>{t("safety.idChecked")}</li>}
        <li>{t("safety.moneyHeld")}</li>
        <li>{t("safety.report")}</li>
      </ul>
    </PublicHeaderPage>
  );
}
