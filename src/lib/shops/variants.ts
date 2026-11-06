/**
 * Shops variants (owner 11-05, answer 4; migration 20261106165310_shops_item_variants): an item has up to 3 option
 * lists (Size, Scent) and one price and stock for each combination it offers.
 *
 * The server is the rule (shops_set_item_variants refuses anything outside the limits below, and shops_request_order
 * prices and stock-checks the picked combination itself); these helpers only shape the screens.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "./rpcErrorCopy";

/** The limits shops_set_item_variants holds (20261106165310). */
export const MAX_OPTION_LISTS = 3;
export const MAX_OPTION_VALUES = 10;
export const MAX_VARIANTS = 100;

export interface ShopVariant {
  id: string;
  values: string[];
  price_cents: number;
  stock_count: number | null;
  active: boolean;
}

export interface ShopItemOptions {
  item_id: string;
  option_names: string[];
  variants: ShopVariant[];
}

/** What the owner saves: one row per combination, by its values (an id is kept server-side by the values). */
export interface VariantInput {
  values: string[];
  price_cents: number;
  stock_count: number | null;
  active: boolean;
}

function withWords<T>(result: { data: T; error: { message: string } | null }, words: (e: unknown) => string | null): T {
  try {
    return unwrap(result) as T;
  } catch (thrown) {
    const e = thrown as Error & { userMessage?: string };
    const msg = words(thrown);
    if (msg && Object.isExtensible(e)) e.userMessage = msg;
    throw e;
  }
}

/** Every item of one shop that has option lists, keyed by item id (the owner also gets switched-off rows). */
export async function fetchItemOptions(shopId: string): Promise<Map<string, ShopItemOptions>> {
  const result = await supabase.rpc("shops_item_variants", { p_shop_id: shopId });
  // A brand-new RPC (CLAUDE.md): until 20261106165310 is on the database, no item has option lists.
  if ((result.error as { code?: string } | null)?.code === "PGRST202") return new Map();
  const rows = withWords(result, (e) => rpcErrorMessage("shops_item_variants", e));
  const list = (rows ?? []) as unknown as ShopItemOptions[];
  return new Map(list.map((x) => [x.item_id, x]));
}

export async function saveItemOptions(itemId: string, optionNames: string[], variants: VariantInput[]): Promise<void> {
  withWords(await supabase.rpc("shops_set_item_variants", {
    p_item_id: itemId,
    p_option_names: optionNames,
    p_variants: variants as unknown as Json,
  }), (e) => rpcErrorMessage("shops_set_item_variants", e));
}

/** "Large / Vanilla": the label an order line keeps (the SQL joins the values the same way). */
export function variantLabel(values: string[]): string {
  return values.join(" / ");
}

/** Every combination of the lists' values, in list order (the first list varies slowest). */
export function combinations(lists: string[][]): string[][] {
  return lists.reduce<string[][]>((acc, values) => acc.flatMap((prefix) => values.map((v) => [...prefix, v])), [[]]);
}

/** The offered combination for one value per list, if there is one. */
export function findVariant(options: ShopItemOptions, picked: string[]): ShopVariant | undefined {
  return options.variants.find((v) => v.active && v.values.length === picked.length && v.values.every((x, i) => x === picked[i]));
}

/** The values a list offers, in the order the combinations first use them. */
export function listValues(options: ShopItemOptions, index: number): string[] {
  const seen: string[] = [];
  for (const v of options.variants) if (v.active && !seen.includes(v.values[index])) seen.push(v.values[index]);
  return seen;
}
