import { Link } from "react-router-dom";
import { ChevronRight, Tags } from "lucide-react";
import { SELL_CHOOSER_PATH } from "@/lib/declutter/sellChooser";
import "@/lib/i18n/enDeclutter";
import { t } from "@/lib/i18n/language";

// Selling's "More ways to sell" row, moved out of DeclutterHomeView.tsx unchanged (Q2615).

/** "More ways to sell" (owner 2026-10-30): one row to the sell chooser, its line naming what is in it for this viewer. */
export function SellChooserEntry({ movingOutOn }: { movingOutOn: boolean }) {
  const ways = movingOutOn ? t("decl.hv.waysMoving") : t("decl.hv.ways");
  return (
    <Link
      to={SELL_CHOOSER_PATH}
      data-sell-chooser-entry=""
      className="flex min-h-14 items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <Tags className="h-5 w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{t("decl.hv.moreWays")}</span>
        <span className="block text-xs text-muted-foreground">{ways}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
