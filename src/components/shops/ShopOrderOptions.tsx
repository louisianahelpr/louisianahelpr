/**
 * One item with option lists in the order sheet (Shops variants, 20261106165310): one dropdown per list, the picked
 * combination's own price and stock, and a stepper for it. Several combinations of one item can go in one order: the
 * ones already picked are listed under it. The server prices and stock-checks the combination itself
 * (shops_request_order); nothing here is the protection.
 */
import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select";
import { formatItemPrice, type ShopItem } from "@/lib/shops/items";
import { findVariant, listValues, variantLabel, type ShopItemOptions } from "@/lib/shops/variants";

export function lineKey(itemId: string, variantId: string | null): string {
  return variantId ? `${itemId}:${variantId}` : itemId;
}

/** How many of one order line (a plain item, or one combination). */
export function QuantityStepper({ label, max, value, onChange }: { label: string; max: number; value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={`How many ${label}`}>
      <Button type="button" size="icon" variant="outline" aria-label={`One less ${label}`} disabled={value <= 0} onClick={() => onChange(value - 1)}>
        <Minus className="h-4 w-4" aria-hidden />
      </Button>
      <span className="w-6 text-center text-sm font-semibold" aria-live="polite">{value}</span>
      <Button type="button" size="icon" variant="outline" aria-label={`One more ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}

export default function ShopOrderOptions({ item, options, qty, maxPerLine, onQty }: {
  item: ShopItem;
  options: ShopItemOptions;
  qty: Record<string, number>;
  maxPerLine: number;
  onQty: (key: string, n: number) => void;
}) {
  const [picked, setPicked] = useState<string[]>(() => options.option_names.map((_, i) => listValues(options, i)[0] ?? ""));
  const variant = findVariant(options, picked);
  const inStock = variant && (variant.stock_count == null || variant.stock_count > 0);
  const others = options.variants.filter((v) => v.id !== variant?.id && (qty[lineKey(item.id, v.id)] ?? 0) > 0);
  return (
    <li className="space-y-2" data-testid="shop-order-options" data-order-item={item.id}>
      <p className="text-sm font-semibold [overflow-wrap:anywhere]">{item.title}</p>
      <div className="grid grid-cols-2 gap-2">
        {options.option_names.map((name, i) => (
          <NativeSelect
            key={name}
            aria-label={`${name} for ${item.title}`}
            value={picked[i]}
            onChange={(e) => setPicked((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
          >
            {listValues(options, i).map((v) => <option key={v} value={v}>{v}</option>)}
          </NativeSelect>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {!variant ? "That combination isn't offered." : !inStock ? "Sold out." : `${formatItemPrice(variant.price_cents)} each`}
        </p>
        {variant && inStock && (
          <QuantityStepper
            label={`${item.title} (${variantLabel(variant.values)})`}
            max={variant.stock_count == null ? maxPerLine : Math.min(maxPerLine, variant.stock_count)}
            value={qty[lineKey(item.id, variant.id)] ?? 0}
            onChange={(n) => onQty(lineKey(item.id, variant.id), n)}
          />
        )}
      </div>
      {others.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Also in this order: {others.map((v) => `${variantLabel(v.values)} × ${qty[lineKey(item.id, v.id)]}`).join(", ")}
        </p>
      )}
    </li>
  );
}
