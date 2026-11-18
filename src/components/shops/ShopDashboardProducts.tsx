/**
 * The dashboard's Products section (Area 07 M8, design audit 11-18: a shop's products sat at the very bottom of
 * "Edit my shop", and the dashboard had none). The shop's items with where each stands and its price, "Add an item"
 * (the same /shops/mine#add-item screen every other "Add an item" opens) and "Edit products" (the full list with Edit
 * and Take down, on Edit my shop). Read only: every change still happens in ShopItemsSection.
 * Its own file and query, the same key ShopItemsSection reads (one fetch), so it loads on its own like the pickers.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionActionPill } from "@/components/ui/SectionActionPill";
import { fetchShopItems, formatItemPrice, type ShopItemStatus } from "@/lib/shops/items";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enShopsBrowse";
import { ShopSectionHead } from "./shopSettingsUi";

/** How many rows the dashboard shows before "+ N more" (the full list is on Edit my shop). */
const SHOWN = 5;
const statusKey = (s: ShopItemStatus) => `shb.prod.${s}` as MsgKey;

export default function ShopDashboardProducts({ shopId }: { shopId: string }) {
  const { t } = useLanguage();
  const items = useQuery({ queryKey: ["shops", "items", shopId], queryFn: () => fetchShopItems(shopId) });
  // The same rows ShopItemsSection lists: every item that is not taken down.
  const rows = (items.data ?? []).filter((i) => i.status !== "withdrawn");
  return (
    <section className="space-y-2" aria-labelledby="shop-products" data-testid="shop-dashboard-products">
      <ShopSectionHead id="shop-products" label={t("shb.prod.title")} count={items.isSuccess ? rows.length : undefined} />
      {items.isLoading ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : items.isError ? (
        <ErrorState variant="inline" title={t("shb.prod.loadFailed")} body={shopsErrorMessage(items.error)} onRetry={() => void items.refetch()} />
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="text-ds-13 text-muted-foreground">{t("shb.prod.none")}</p>
          ) : (
            <ul className="divide-y divide-border/70 rounded-2xl border border-border/60">
              {rows.slice(0, SHOWN).map((i) => (
                <li key={i.id} className="flex items-baseline gap-3 px-4 py-3" data-shop-product-row="">
                  <span className="min-w-0 flex-1 truncate text-ds-15 font-semibold" title={i.title}>{i.title}</span>
                  <span className="shrink-0 text-ds-13 text-muted-foreground">
                    {t("shb.prod.line", { status: t(statusKey(i.status)), price: formatItemPrice(i.price_cents) })}
                  </span>
                </li>
              ))}
              {rows.length > SHOWN && (
                <li className="px-4 py-2 text-ds-13 text-muted-foreground">{t("shb.prod.more", { n: rows.length - SHOWN })}</li>
              )}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <SectionActionPill asChild>
              <Link to="/shops/mine#add-item" data-testid="shop-dashboard-add-item">
                <Plus className="h-4 w-4" aria-hidden /> {t("shb.prod.add")}
              </Link>
            </SectionActionPill>
            {rows.length > 0 && (
              <Link to="/shops/mine" className="link-standard text-ds-13 font-semibold" data-testid="shop-dashboard-edit-products">
                {t("shb.prod.manage")}
              </Link>
            )}
          </div>
        </>
      )}
    </section>
  );
}
