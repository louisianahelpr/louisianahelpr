/**
 * The member's own Declutter reads Home makes (its Declutter tile and Coming up): their listings and their cart.
 *
 * Their own small module, so Home loads only these (B87, 11-01). Through src/lib/declutter/api.ts, Home's summary
 * read fetched api.ts's chunk (signed-in-pages) and its ~150 KB gz closure (lifecycleErrors' words, Radix, dates,
 * ...) in the same window the dock was loading. api.ts re-exports both reads, so every Declutter screen calls the
 * same code. Nothing here may import a screen's module: only the Supabase client and unwrap (both in boot).
 * src/test/homeLazyReadsStayLight.test.ts reads the built graph.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { takeMinePrefetch } from "@/lib/declutter/minePrefetchTake";
import type { CartLine, DeclutterItem } from "@/lib/declutter/api";

export const ITEM_COLUMNS =
  "id, seller_id, status, title, description, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, created_at, live_at, porch_ok, accepts_offers";

export type ItemRead = { data: unknown; error: { message: string; code?: string } | null; status?: number };
/** Columns a newer migration adds, with the default an item has before it is live (each column's own DEFAULT). */
const NEWER_ITEM_COLUMNS: Record<string, boolean> = { porch_ok: true, accepts_offers: true };

/**
 * Row 101's column, porch_ok (20261017055504), and smart offers' accepts_offers
 * (20261029162620) reach prod through db-deploy, and the web app through
 * prod-deploy; both start on the push to main, in no fixed order. If the app is
 * live first, the read is refused with 42703 naming the column: read again
 * without it, every item at that column's default (porch on, offers on). Every
 * other refusal is thrown as before. Remove a column's entry once its migration
 * is live on prod (lh-money-escrow review, porch default #2).
 */
export async function readItems(run: (columns: string) => PromiseLike<ItemRead>): Promise<unknown> {
  let columns = ITEM_COLUMNS;
  const defaults: Record<string, boolean> = {};
  for (;;) {
    const res = await run(columns);
    const missing = res.error?.code === "42703"
      ? Object.keys(NEWER_ITEM_COLUMNS).find((c) => !(c in defaults) && res.error!.message.includes(c))
      : undefined;
    if (!missing) {
      const data = unwrap(res);
      if (Object.keys(defaults).length === 0) return data;
      const fill = (r: unknown) => (r && typeof r === "object" ? { ...r, ...defaults } : r);
      return Array.isArray(data) ? data.map(fill) : fill(data);
    }
    defaults[missing] = NEWER_ITEM_COLUMNS[missing];
    columns = columns.replace(`, ${missing}`, "");
  }
}

/** The member's own listings, every status. */
export async function fetchMyItems(userId: string): Promise<DeclutterItem[]> {
  // B81: started at boot on a cold /declutter (src/boot/declutterMinePrefetch.ts); taken once, for this member.
  const prefetched = await takeMinePrefetch("items", userId);
  if (prefetched) return prefetched as DeclutterItem[];
  const rows = await readItems((cols) =>
    // B48 live check 2026-10-29: the Selling row names every way the seller ticked (handovers), not only the porch.
    supabase.from("declutter_items").select(`${cols}, handovers`).eq("seller_id", userId).order("created_at", { ascending: false }),
  );
  return (rows ?? []) as DeclutterItem[];
}

const signedInUserId = async () => (await supabase.auth.getSession()).data.session?.user.id;

/**
 * The member's cart and sales. A refusal is thrown exactly as every Declutter RPC's is (api.ts rpcData, with
 * RPC_ERROR_COPY's words on `userMessage`); only then are those modules loaded.
 */
export async function fetchMyCart(): Promise<CartLine[]> {
  const prefetched = await takeMinePrefetch("cart", signedInUserId);
  if (prefetched) return prefetched as CartLine[];
  const result = await supabase.rpc("declutter_my_cart");
  if (result.error) {
    const [{ rpcData }, { rpcErrorMessage }] = await Promise.all([import("@/lib/declutter/api"), import("@/lib/lifecycleErrors")]);
    rpcData(result, (e) => rpcErrorMessage("declutter_my_cart", e));
  }
  return (result.data ?? []) as CartLine[];
}
