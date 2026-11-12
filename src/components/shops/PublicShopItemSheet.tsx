/**
 * S2-038 (Shops audit 2): a signed-out visitor taps an item on a shared shop page and reads it (photos, price, what it
 * is, description) with one way in: "Sign up to order". Read-only; ordering is the member page's item sheet.
 */
import { Link } from "react-router-dom";
import { House, ShoppingBag } from "lucide-react";
import { Sheet, SheetContent, SheetFooter, SheetHero } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { focusSheetItself } from "@/components/declutter/focusSheetItself";
import { formatItemPrice, HOME_KITCHEN_NOTICE, readinessLabel, SHOP_ITEM_TYPE_LABEL } from "@/lib/shops/items";
import { publicPhotoUrl, type PublicShop } from "@/lib/shops/publicShop";

type PublicItem = PublicShop["items"][number];

export default function PublicShopItemSheet({ item, signupTo, onClose }: { item: PublicItem | null; signupTo: string; onClose: () => void }) {
  return (
    <Sheet open={item !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" floor onOpenAutoFocus={focusSheetItself} className="max-h-[90dvh] overflow-y-auto" data-public-item-sheet="">
        {item && (
          <>
            <SheetHero title={item.title} />
            <div className="space-y-3 px-1 pb-2">
              {item.photos.length > 0 ? (
                <ul className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1" aria-label="Photos">
                  {item.photos.map((p) => (
                    <li key={p.id} className="aspect-square w-[78%] shrink-0 snap-center overflow-hidden rounded-xl bg-muted sm:w-64">
                      <img src={publicPhotoUrl(p.id, "item", 640)} alt="" className="h-full w-full object-cover" />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex aspect-[2/1] w-full items-center justify-center rounded-xl bg-muted">
                  <ShoppingBag className="h-8 w-8 text-muted-foreground" aria-hidden />
                </div>
              )}
              <div className="space-y-0.5">
                <p className="text-base font-bold">{item.has_options ? `From ${formatItemPrice(item.price_cents)}` : formatItemPrice(item.price_cents)}</p>
                <p className="text-ds-11 text-muted-foreground">{SHOP_ITEM_TYPE_LABEL[item.subtype] ?? "Item"} · {readinessLabel(item)}</p>
              </div>
              {item.description.trim() && <p className="whitespace-pre-line break-words text-ds-13">{item.description}</p>}
              {item.home_kitchen && (
                <p className="flex gap-1.5 text-ds-11 text-muted-foreground">
                  <House className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{HOME_KITCHEN_NOTICE}</span>
                </p>
              )}
            </div>
            <SheetFooter>
              <Button asChild className="btn-grad-primary w-full rounded-full">
                <Link to={signupTo}>Sign up to order</Link>
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
