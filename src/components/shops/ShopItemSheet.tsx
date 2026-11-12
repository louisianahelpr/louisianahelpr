/**
 * S026 (Shops audit 11-12): tapping an item card opens this sheet: the item's photos, price, readiness, description,
 * its options and a quantity, and "Add to order". It writes the page's one order (shopCart), which the order sheet
 * below and the sticky "Review order" bar read. The quantity here is a draft until "Add to order"; closing the sheet
 * keeps the order as it was. Preorders stay ordered on their own (the order sheet's rule). The server re-checks every
 * line (shops_request_order).
 */
import { useState } from "react";
import { House, ShoppingBag } from "lucide-react";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { focusSheetItself } from "@/components/declutter/focusSheetItself";
import { formatItemPrice, HOME_KITCHEN_NOTICE, readinessLabel, SHOP_ITEM_TYPE_LABEL, type ShopItem } from "@/lib/shops/items";
import type { ShopItemOptions } from "@/lib/shops/variants";
import { preorderLabel, type ItemPreorder } from "@/lib/shops/preorders";
import ShopOrderOptions, { QuantityStepper } from "./ShopOrderOptions";
import { isItemKey, MAX_PER_LINE, maxFor, preorderMax, useShopCart, type ShopQty } from "./shopCart";
import { shopItemSrc } from "./ShopProfile";

function onlyItem(qty: ShopQty, itemId: string): ShopQty {
  return Object.fromEntries(Object.entries(qty).filter(([k, n]) => isItemKey(k, itemId) && n > 0));
}

function ItemSheetBody({ item, options, preorder, orderable, preorders, onDone }: {
  item: ShopItem;
  options?: ShopItemOptions;
  preorder?: ItemPreorder;
  /** All the items a dated order can hold (orderableItems); this item can be added only when it is one of them. */
  orderable: ShopItem[];
  preorders?: ReadonlyMap<string, ItemPreorder>;
  onDone: () => void;
}) {
  const { qty, setQty } = useShopCart();
  const canOrder = orderable.some((i) => i.id === item.id);
  // Lines of OTHER items already in the order (options included), for the preorder rule.
  const otherLines = Object.entries(qty).filter(([k, n]) => n > 0 && !isItemKey(k, item.id));
  const otherHasPreorder = otherLines.some(([k]) => preorders?.has(k.split(":")[0]));
  const locked = preorder ? otherLines.length > 0 : otherHasPreorder;
  // The draft starts as what the order already holds of this item (so the sheet can change or remove it). S2-027:
  // an item not in the order yet starts at 1, so "Add to order" is live at once (no greyed main button, no extra +).
  // Items with options keep 0: the buyer picks a combination first.
  const [draft, setDraft] = useState<ShopQty>(() => {
    const held = onlyItem(qty, item.id);
    if (Object.keys(held).length > 0 || !canOrder || locked || options) return held;
    return (preorder ? preorderMax(preorder) : maxFor(item)) >= 1 ? { [item.id]: 1 } : held;
  });
  const draftCount = Object.values(draft).reduce((s, n) => s + n, 0);
  const inOrder = Object.keys(onlyItem(qty, item.id)).length > 0;
  const add = () => {
    setQty((q) => ({ ...Object.fromEntries(Object.entries(q).filter(([k]) => !isItemKey(k, item.id))), ...onlyItem(draft, item.id) }));
    onDone();
  };
  const photos = item.photos;
  return (
    <>
      <SheetHero title={item.title} />
      <div className="space-y-3 px-1 pb-2" data-testid="shop-item-sheet">
        {photos.length > 0 ? (
          <ul className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1" aria-label="Photos">
            {photos.map((p) => (
              <li key={p.id} className="aspect-square w-[78%] shrink-0 snap-center overflow-hidden rounded-xl bg-muted sm:w-64">
                <img src={shopItemSrc(p)} alt="" className="h-full w-full object-cover" />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex aspect-[2/1] w-full items-center justify-center rounded-xl bg-muted">
            <ShoppingBag className="h-8 w-8 text-muted-foreground" aria-hidden />
          </div>
        )}
        <div className="space-y-0.5">
          <p className="text-base font-bold">{options ? `From ${formatItemPrice(item.price_cents)}` : formatItemPrice(item.price_cents)}</p>
          <p className="text-ds-11 text-muted-foreground">
            {SHOP_ITEM_TYPE_LABEL[item.subtype] ?? "Item"} · {preorder ? preorderLabel(preorder) : readinessLabel(item)}
          </p>
        </div>
        {item.description.trim() && <p className="whitespace-pre-line break-words text-ds-13">{item.description}</p>}
        {item.home_kitchen && (
          <p className="flex gap-1.5 text-ds-11 text-muted-foreground">
            <House className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{HOME_KITCHEN_NOTICE}</span>
          </p>
        )}
        {!canOrder ? (
          <p className="text-ds-13 text-muted-foreground" data-testid="shop-item-sheet-cant">
            {item.kind === "digital" ? "Buy this download below." : preorder && preorder.open === false ? "Preorders for this are closed." : "Sold out."}
          </p>
        ) : locked ? (
          <p className="text-ds-13 text-muted-foreground" data-testid="shop-item-sheet-locked">
            {preorder ? "Preorders are ordered on their own." : "Order this separately from your preorder."}
          </p>
        ) : options ? (
          <ul>
            <ShopOrderOptions item={item} options={options} qty={draft} maxPerLine={MAX_PER_LINE}
              onQty={(key, n) => setDraft((d) => ({ ...d, [key]: n }))} />
          </ul>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-ds-13 font-semibold">How many</p>
            <QuantityStepper label={item.title} max={preorder ? preorderMax(preorder) : maxFor(item)} value={draft[item.id] ?? 0}
              onChange={(n) => setDraft((d) => ({ ...d, [item.id]: n }))} />
          </div>
        )}
      </div>
      {canOrder && !locked && (
        <SheetFooter>
          <SheetPrimaryAction disabled={draftCount === 0 && !inOrder} onClick={add}>
            {draftCount === 0 && inOrder ? "Remove from order" : inOrder ? "Update order" : "Add to order"}
          </SheetPrimaryAction>
        </SheetFooter>
      )}
    </>
  );
}

export default function ShopItemSheet({ item, onClose, ...rest }: {
  item: ShopItem | null;
  onClose: () => void;
  options?: ShopItemOptions;
  preorder?: ItemPreorder;
  orderable: ShopItem[];
  preorders?: ReadonlyMap<string, ItemPreorder>;
}) {
  return (
    <Sheet open={item !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" floor onOpenAutoFocus={focusSheetItself} className="max-h-[90dvh] overflow-y-auto" data-shop-item-sheet="">
        {item && <ItemSheetBody key={item.id} item={item} onDone={onClose} {...rest} />}
      </SheetContent>
    </Sheet>
  );
}
