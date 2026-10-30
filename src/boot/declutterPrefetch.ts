/**
 * Start /declutter's first reads from the ENTRY, beside the app's own download (same idea as guestJobsPrefetch.ts).
 *
 * Measured 2026-10-30 (local build, 412 wide, 1.6 Mbps / 150 ms, x4 CPU, signed-in test account): the first item
 * photo waited on a chain, page chunk -> profile -> switches -> items -> photos, so 91% of its time was waiting
 * to start. Items and photos now start at boot and do not wait for the app to run.
 *
 * Uses the session the app would use, sent only to the app's own Supabase, as supabase-js sends it: the row policies
 * decide what comes back, as they do for the app's own read. No usable session, or any failure: nothing is handed
 * over and the page asks Supabase as it always did.
 *
 * NOTHING outside the entry may import this file (see guestJobsPrefetch.ts). The selects are COPIES of
 * src/lib/declutter/api.ts's, and src/boot/declutterPrefetch.test.ts holds the URLs equal to supabase-js's.
 */

/** Copy of ITEM_COLUMNS in src/lib/declutter/api.ts (see above). */
const ITEM_SELECT =
  "id, seller_id, status, title, description, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, created_at, live_at, porch_ok, accepts_offers";
const PHOTO_SELECT = "id, item_id, storage_path, position";
/** Above this many items, photos are left to the page: the id list would make a very long URL. */
const MAX_PHOTO_IDS = 60;
/** A session this close to expiry is left to supabase-js, which refreshes it. */
const MIN_TOKEN_LIFE_S = 60;

export const DECLUTTER_PREFETCH_KEY = "__lhDeclutterPrefetch";

export function declutterItemsRestUrl(supabaseUrl: string): string {
  const u = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/declutter_items`);
  u.searchParams.set("select", ITEM_SELECT.replace(/\s+/g, ""));
  u.searchParams.set("status", "in.(live,reserved)");
  u.searchParams.set("order", "live_at.desc");
  u.searchParams.set("limit", "500");
  return u.toString();
}

export function declutterPhotosRestUrl(supabaseUrl: string, itemIds: string[]): string {
  const u = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/declutter_item_photos`);
  u.searchParams.set("select", PHOTO_SELECT.replace(/\s+/g, ""));
  u.searchParams.set("item_id", `in.(${itemIds.join(",")})`);
  u.searchParams.set("order", "position.asc");
  return u.toString();
}

/** The stored session's access token, while it has life left; null otherwise (never throws). */
function storedAccessToken(nowS: number): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const session = JSON.parse(localStorage.getItem(key) ?? "null") as { access_token?: unknown; expires_at?: unknown } | null;
      if (typeof session?.access_token !== "string" || typeof session.expires_at !== "number") return null;
      return session.expires_at - nowS > MIN_TOKEN_LIFE_S ? session.access_token : null;
    }
  } catch {
    /* storage blocked or a malformed session: the page reads for itself */
  }
  return null;
}

/** Called by the entry. No-op unless this is a cold load of /declutter with a live session. */
export function startDeclutterPrefetch(pathname: string): void {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path !== "/declutter" || typeof fetch !== "function") return;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const token = storedAccessToken(Date.now() / 1000);
  if (!base || !key || !token) return;
  const read = (url: string): Promise<unknown[] | null> =>
    fetch(url, { headers: { apikey: key, Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((rows) => (Array.isArray(rows) ? rows : null))
      // A failed prefetch is not an error: the page asks Supabase itself.
      .catch(() => null);
  const items = read(declutterItemsRestUrl(base));
  const photos = items.then(async (rows) => {
    const ids = (rows ?? []).map((r) => (r as { id: string }).id);
    if (ids.length === 0 || ids.length > MAX_PHOTO_IDS) return null;
    const found = await read(declutterPhotosRestUrl(base, ids));
    return found ? { ids, rows: found } : null;
  });
  (window as unknown as Record<string, unknown>)[DECLUTTER_PREFETCH_KEY] = { at: Date.now(), items, photos };
}
