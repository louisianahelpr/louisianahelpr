import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";

/**
 * /fees (audit 11-10 F255, owner 2026-11-11 morning pop-up): what Louisiana Helpr charges, in words only. No rate and
 * no number (owner rule #20, membersSeeNoFeeWords): the owner's exact sentences (wording made exact 11-11 afternoon), nothing more. Guard:
 * src/test/feesAndSafetyPages.test.tsx.
 */
export default function Fees() {
  usePageMeta(PUBLIC_PAGE_META["/fees"]);
  return (
    <PublicHeaderPage title="Fees" backTo="/" bottomPaddingClassName="pb-8">
      <div className="page-measure mx-auto space-y-3 font-sans text-ds-15 leading-relaxed text-foreground" data-fees-body="">
        <p>Posting a job is free.</p>
        <p>A small one-time setup fee applies to your first paid job.</p>
        <p>Any service fee is shown before you pay.</p>
        <p>Helprs see their pay before they apply.</p>
      </div>
    </PublicHeaderPage>
  );
}
