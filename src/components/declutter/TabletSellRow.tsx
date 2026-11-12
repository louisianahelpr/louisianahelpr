/**
 * Selling's tablet row: "Sell an item" and one line to the other ways (Audit posting 1030 #11 gave a tablet the photo
 * screen directly; the header has its own add action on desktop). LEAD-SELLING-NO-SELL-BTN-PHONE (owner 10-31): not on
 * a phone, where the + covers it. Moved out of DeclutterHomeView unchanged (componentSizeRatchet, L32 11-02).
 */
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SELL_CHOOSER_PATH, SELL_ONE_PATH } from "@/lib/declutter/sellChooser";
import "@/lib/i18n/enDeclutter";
import { t } from "@/lib/i18n/language";

export function TabletSellRow() {
  return (
    <div className="hidden items-center gap-3 sm:flex lg:hidden" data-selling-sell="">
      <Button asChild className="shrink-0 rounded-full"><Link to={SELL_ONE_PATH}>{t("decl.hv.sellOne")}</Link></Button>
      <Link to={SELL_CHOOSER_PATH} className="min-h-11 content-center text-ds-13 font-semibold text-[hsl(var(--sage-ink))] underline underline-offset-2">{t("decl.hv.otherWays")}</Link>
    </div>
  );
}
