/**
 * The owner's option lists for one saved item (Shops variants, owner 11-05 answer 4; 20261106165310): up to 3 lists
 * (Size, Scent), each with up to 10 choices, and one price, stock and on/off for every combination. Saved as one set
 * by shops_set_item_variants, which holds every limit; while an item has lists, its card shows the lowest price
 * ("From $X") and the summed stock.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { SHOP_ITEM_MAX_PRICE_CENTS, shopsErrorMessage } from "@/lib/shops/errors";
import { priceBoxText } from "@/lib/shops/items";
import {
  combinations,
  fetchItemOptions,
  MAX_OPTION_LISTS,
  MAX_OPTION_VALUES,
  MAX_VARIANTS,
  saveItemOptions,
  variantLabel,
  type ShopItemOptions,
} from "@/lib/shops/variants";

/** S042 (Shops audit 11-12): "$1,200" or "1,200" is 120000 cents, as the item editor reads a price. */
export const optionPriceCents = (s: string) => Math.round(Number(s.replace(/[$,\s]/g, "")) * 100);
/** The words under a combination's price when the server would refuse it ($1 to $5,000), else null. */
/**
 * S2-009 (Shops audit 2): stock is a whole number from 0 to 9999, or empty (made to order). The box allowed 2.5,
 * which the server refused with a message about prices.
 */
export function optionStockProblem(s: string): string | null {
  const t = s.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t) || Number(t) > 9999) return "A whole number from 0 to 9999, or leave it empty.";
  return null;
}

/**
 * S2-009: the price sent for a row. A switched-off row is never sold, but the server still checks its price ($1 to
 * the most), so a switched-off row with a price that wouldn't pass sends the item's own price instead of failing the
 * whole save with a toast that names no row.
 */
export function optionRowPriceCents(r: { price: string; active: boolean }, basePriceCents: number): number {
  if (r.active || optionPriceProblem(r.price) === null) return optionPriceCents(r.price);
  return basePriceCents;
}

export function optionPriceProblem(s: string): string | null {
  const c = optionPriceCents(s);
  if (s.trim() === "" || !Number.isFinite(c)) return "Type a price, like 12.50.";
  if (c < 100 || c > SHOP_ITEM_MAX_PRICE_CENTS) return `From $1 to $${(SHOP_ITEM_MAX_PRICE_CENTS / 100).toLocaleString("en-US")}.`;
  return null;
}

interface ListDraft { name: string; values: string }
interface RowDraft { price: string; stock: string; active: boolean }

/** "Small, Large ,small" -> ["Small", "Large"]: trimmed, blanks and repeats dropped. */
export function splitChoices(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.split(",")) {
    const v = raw.trim();
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

function draftsFrom(opts: ShopItemOptions | undefined): { lists: ListDraft[]; rows: Record<string, RowDraft> } {
  if (!opts) return { lists: [], rows: {} };
  const lists = opts.option_names.map((name, i) => ({
    name,
    values: [...new Set(opts.variants.map((v) => v.values[i]))].join(", "),
  }));
  const rows: Record<string, RowDraft> = {};
  for (const v of opts.variants) {
    rows[variantLabel(v.values)] = { price: priceBoxText(v.price_cents), stock: v.stock_count == null ? "" : String(v.stock_count), active: v.active };
  }
  return { lists, rows };
}

export default function ShopItemOptionsEditor({ shopId, itemId, basePriceCents }: { shopId: string; itemId: string; basePriceCents: number }) {
  const qc = useQueryClient();
  const options = useQuery({ queryKey: ["shops", "item-options", shopId], queryFn: () => fetchItemOptions(shopId) });
  if (options.isLoading) return null;
  if (options.isError) {
    return (
      <div role="alert" className="space-y-2">
        <p className="text-ds-13">{shopsErrorMessage(options.error)}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void options.refetch()}>Try again</Button>
      </div>
    );
  }
  return (
    <OptionsForm
      key={itemId}
      itemId={itemId}
      basePriceCents={basePriceCents}
      initial={options.data?.get(itemId)}
      onSaved={() => {
        void qc.invalidateQueries({ queryKey: ["shops", "item-options", shopId] });
        void qc.invalidateQueries({ queryKey: ["shops", "items"] });
      }}
    />
  );
}

function OptionsForm({ itemId, basePriceCents, initial, onSaved }: {
  itemId: string; basePriceCents: number; initial: ShopItemOptions | undefined; onSaved: () => void;
}) {
  const start = useMemo(() => draftsFrom(initial), [initial]);
  const [lists, setLists] = useState<ListDraft[]>(start.lists);
  const [rows, setRows] = useState<Record<string, RowDraft>>(start.rows);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const parsed = lists.map((l) => splitChoices(l.values));
  const combos = lists.length > 0 && parsed.every((p) => p.length > 0) ? combinations(parsed) : [];
  const tooMany = combos.length > MAX_VARIANTS || parsed.some((p) => p.length > MAX_OPTION_VALUES);
  const rowFor = (values: string[]): RowDraft =>
    rows[variantLabel(values)] ?? { price: priceBoxText(basePriceCents), stock: "", active: true };
  const setRow = (values: string[], patch: Partial<RowDraft>) =>
    setRows((r) => ({ ...r, [variantLabel(values)]: { ...rowFor(values), ...patch } }));

  const save = useMutation({
    mutationFn: async (clear: boolean) => {
      if (clear) return saveItemOptions(itemId, [], []);
      return saveItemOptions(itemId, lists.map((l) => l.name.trim()), combos.map((values) => {
        const r = rowFor(values);
        return {
          values,
          price_cents: optionRowPriceCents(r, basePriceCents),
          stock_count: r.stock.trim() === "" ? null : Number(r.stock),
          active: r.active,
        };
      }));
    },
    onSuccess: (held, clear) => {
      // toast() renders; toast.info would be a no-op (src/lib/toastPolicy.ts), and the seller must hear the item is hidden.
      if (held) toast("Options saved. A word in them needs a quick check, so the item is hidden until Louisiana Helpr looks at it.");
      if (clear) { setLists([]); setRows({}); }
      onSaved();
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  return (
    <section className="space-y-3 rounded-2xl border border-border p-4" aria-labelledby="item-options-title">
      <div className="space-y-1">
        <h4 id="item-options-title" className="text-ds-13 font-semibold">Options (optional)</h4>
        <p className="text-ds-11 text-muted-foreground">
          Like Size or Scent. Each combination gets its own price and stock, and buyers pick one when they order.
        </p>
      </div>

      {lists.map((l, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor={`option-name-${i}`}>Option name</Label>
            <Input id={`option-name-${i}`} value={l.name} maxLength={30} placeholder="Size"
              onChange={(e) => setLists((ls) => ls.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`option-values-${i}`}>Choices, separated by commas</Label>
            <Input id={`option-values-${i}`} value={l.values} placeholder="Small, Medium, Large"
              onChange={(e) => setLists((ls) => ls.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} />
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setLists((ls) => ls.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      {lists.length < MAX_OPTION_LISTS && (
        <Button type="button" variant="outline" size="sm" onClick={() => setLists((ls) => [...ls, { name: "", values: "" }])}>
          Add an option list
        </Button>
      )}

      {tooMany && (
        <p role="alert" className="text-ds-13">
          Up to {MAX_OPTION_VALUES} choices in a list and {MAX_VARIANTS} combinations in all.
        </p>
      )}
      {combos.length > 0 && !tooMany && (
        <ul className="space-y-2" aria-label="Combinations">
          {combos.map((values) => {
            const label = variantLabel(values);
            const r = rowFor(values);
            const key = label.replace(/[^A-Za-z0-9]+/g, "-");
            const priceProblem = r.active ? optionPriceProblem(r.price) : null;
            const stockProblem = optionStockProblem(r.stock);
            return (
              <li key={label} className="grid grid-cols-[1fr_5rem_5rem] items-end gap-2">
                <div className="flex items-center gap-2 pb-3">
                  <Checkbox id={`combo-on-${key}`} checked={r.active} onCheckedChange={(v) => setRow(values, { active: v === true })} />
                  <Label htmlFor={`combo-on-${key}`} className="flex min-h-11 flex-1 items-center [overflow-wrap:anywhere]">{label}</Label>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`combo-price-${key}`} className="text-ds-11">Price ($)</Label>
                  <Input id={`combo-price-${key}`} inputMode="decimal" value={r.price} onChange={(e) => setRow(values, { price: e.target.value })}
                    aria-invalid={priceProblem ? true : undefined} aria-describedby={priceProblem ? `combo-price-err-${key}` : undefined} />
                  {priceProblem && <p id={`combo-price-err-${key}`} className="text-ds-11 text-destructive-ink">{priceProblem}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`combo-stock-${key}`} className="text-ds-11">Stock</Label>
                  <Input id={`combo-stock-${key}`} type="number" inputMode="numeric" min={0} max={9999} step={1} value={r.stock} placeholder="Made to order"
                    onChange={(e) => setRow(values, { stock: e.target.value })}
                    aria-invalid={stockProblem ? true : undefined} aria-describedby={stockProblem ? `combo-stock-err-${key}` : undefined} />
                  {stockProblem && <p id={`combo-stock-err-${key}`} className="text-ds-11 text-destructive-ink">{stockProblem}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {lists.length > 0 && (
          <Button type="button" variant="outline" disabled={save.isPending || combos.length === 0 || tooMany || combos.some((v) => { const row = rowFor(v); return (row.active && optionPriceProblem(row.price) !== null) || optionStockProblem(row.stock) !== null; })} onClick={() => save.mutate(false)}>
            {save.isPending ? "Saving…" : "Save options"}
          </Button>
        )}
        {initial && (
          <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => setConfirmRemove(true)}>
            Remove all options
          </Button>
        )}
      </div>
      <p className="text-ds-11 text-muted-foreground">Leave stock blank if you make each one to order.</p>
      {/* S2-014 (Shops audit 2): removing every combination asks first. */}
      <BrandConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove all options?"
        description="Every combination and its price and stock is deleted. The item goes back to one price."
        primaryLabel="Remove all options"
        onPrimary={() => { setConfirmRemove(false); save.mutate(true); }}
        secondaryLabel="Keep them"
      />
    </section>
  );
}
