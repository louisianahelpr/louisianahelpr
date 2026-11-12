/**
 * S026 (Shops audit 11-12): one order per shop page, shared by the item cards' item sheet (ShopItemSheet), the order
 * sheet (ShopOrderSheet) and the sticky "Review order" bar. The quantities live in ShopCartProvider (ShopView wraps the
 * page in it); a component rendered without the provider keeps its own quantities, as the order sheet always did.
 * Nothing here is the protection: shops_request_order re-checks every line.
 */
import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { ShopItem } from "@/lib/shops/items";
import type { ShopItemOptions } from "@/lib/shops/variants";
import type { ItemPreorder } from "@/lib/shops/preorders";

/** Quantities keyed by item id, or item:variant for an item with option lists (lineKey). */
export type ShopQty = Record<string, number>;
export type ShopCart = { qty: ShopQty; setQty: Dispatch<SetStateAction<ShopQty>> };

export const MAX_PER_LINE = 20;

export function lineKey(itemId: string, variantId: string | null): string {
  return variantId ? `${itemId}:${variantId}` : itemId;
}

export function maxFor(item: ShopItem): number {
  return item.stock_count == null ? MAX_PER_LINE : Math.min(MAX_PER_LINE, item.stock_count);
}

/** A preorder's most per order: 20, or what its limit has left (paid items; the server counts unpaid pages too). */
export function preorderMax(p: ItemPreorder): number {
  return p.cap == null ? MAX_PER_LINE : Math.max(0, Math.min(MAX_PER_LINE, p.cap - p.ordered));
}

/** The items a dated order can hold: live, in stock, not a download, not a closed or full preorder. */
export function orderableItems(items: ShopItem[] | undefined, preorders: ReadonlyMap<string, ItemPreorder> | undefined): ShopItem[] {
  return (items ?? []).filter((i) => i.status === "live" && i.kind !== "digital" && (i.stock_count == null || i.stock_count > 0)
    && preorders?.get(i.id)?.open !== false);
}

export type ChosenLine = { item: ShopItem; variantId: string | null; unit: number; n: number };

/** Each chosen line: a plain item, or one combination of an item with option lists (keyed item:variant). */
export function chosenLines(orderable: ShopItem[], options: ReadonlyMap<string, ShopItemOptions> | undefined, qty: ShopQty): ChosenLine[] {
  return orderable.flatMap((i) => {
    const opts = options?.get(i.id);
    if (!opts) return (qty[i.id] ?? 0) > 0 ? [{ item: i, variantId: null, unit: i.price_cents, n: qty[i.id] }] : [];
    return opts.variants
      .filter((v) => v.active && (qty[lineKey(i.id, v.id)] ?? 0) > 0)
      .map((v) => ({ item: i, variantId: v.id as string | null, unit: v.price_cents, n: qty[lineKey(i.id, v.id)] }));
  });
}

/** True for the quantity keys that belong to one item (its plain key and every item:variant key). */
export function isItemKey(key: string, itemId: string): boolean {
  return key === itemId || key.startsWith(`${itemId}:`);
}

const ShopCartContext = createContext<ShopCart | null>(null);

export function ShopCartProvider({ children }: { children: ReactNode }) {
  const [qty, setQty] = useState<ShopQty>({});
  return <ShopCartContext.Provider value={{ qty, setQty }}>{children}</ShopCartContext.Provider>;
}

/** The page's order (inside ShopCartProvider), or this component's own quantities (outside it). */
export function useShopCart(): ShopCart {
  const shared = useContext(ShopCartContext);
  const [qty, setQty] = useState<ShopQty>({});
  return shared ?? { qty, setQty };
}

/** Whether this page shares one order (the item sheet and the review bar appear only then). */
export function useHasShopCart(): boolean {
  return useContext(ShopCartContext) !== null;
}
