/**
 * Start the reads /declutter's tab row waits for, from the ENTRY, beside the app's own download (B81, 2026-11-01,
 * "Nothing slow for users"; same idea as declutterPrefetch.ts beside it).
 *
 * Measured (cwv-lab, customer test account, 375 Slow 4G + 4x CPU, B77's branch): every /declutter tab, Browse too,
 * draws only once the Buying / Selling badge reads have answered (DeclutterHomeView's tabsReady: declutter_my_cart,
 * declutter_my_offers and the member's own listings, useDeclutterTodo + useUnansweredQuestions). Those three started
 * only after the whole app had downloaded and rendered (~6.1 s) and answered at ~6.7 s; Selling's and Buying's largest
 * paint (~6.8 s) and Browse's first card waited on them.
 *
 * So the entry fires the SAME three REST reads with plain fetch, in parallel, and fetchMyCart / fetchMyOffers /
 * fetchMyItems (src/lib/declutter/api.ts) each take their answer ONCE, for that member, while fresh
 * (src/lib/declutter/minePrefetchTake.ts): nothing is read twice, and a refetch reaches the server. No usable session,
 * any failure, or an answer not in the expected shape: nothing is handed over and the page reads as it always did.
 *
 * NOTHING outside the entry's own chunks may import this file (see guestJobsPrefetch.ts). So the URLs are COPIES of
 * the reads', and src/boot/declutterMinePrefetch.test.ts holds them equal to the ones supabase-js builds.
 */

export const DECLUTTER_MINE_PREFETCH_KEY = "__lhDeclutterMinePrefetch";

/** Copy of `${ITEM_COLUMNS}, handovers`, fetchMyItems's select (src/lib/declutter/api.ts; the test holds them equal). */
export const MY_ITEMS_SELECT =
  "id, seller_id, status, title, description, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng, created_at, live_at, porch_ok, accepts_offers, handovers";

/** The REST URLs supabase-js sends for the three reads (see the test). */
export function declutterMineUrls(supabaseUrl: string, userId: string): { cart: string; offers: string; items: string } {
  const rest = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/`;
  const items = new URL(`${rest}declutter_items`);
  // supabase-js strips the spaces from a select outside quotes.
  items.searchParams.set("select", MY_ITEMS_SELECT.replace(/\s/g, ""));
  items.searchParams.set("seller_id", `eq.${userId}`);
  items.searchParams.set("order", "created_at.desc");
  return { cart: `${rest}rpc/declutter_my_cart`, offers: `${rest}rpc/declutter_my_offers`, items: items.toString() };
}

/** Copy of ASKABLE in src/components/declutter/SellerQuestionsToAnswer.tsx (the test holds them equal). */
export const ASKABLE_STATUSES = ["live", "paused"];

/**
 * B82 (2026-11-01): the URL supabase-js builds for fetchUnansweredQuestions(ids) (src/lib/declutter/api.ts; the test
 * holds them equal). With listings on sale, the tab row also waits on this read (useUnansweredQuestions), which the
 * page could only start after the app drew and the listings came back: ~0.6 s more on Selling and Buying in the lab.
 */
export function unansweredQuestionsUrl(supabaseUrl: string, itemIds: string[]): string {
  const u = new URL(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/declutter_questions`);
  u.searchParams.set("select", "id,item_id,question,created_at");
  u.searchParams.set("item_id", `in.(${itemIds.join(",")})`);
  u.searchParams.set("answer", "is.null");
  u.searchParams.set("removed_at", "is.null");
  u.searchParams.set("order", "created_at.asc");
  return u.toString();
}

/** A list answer, or null (a refusal, an error body, anything else). */
const listOf = (r: Response): Promise<unknown[] | null> =>
  r.ok ? (r.json() as Promise<unknown>).then((x) => (Array.isArray(x) ? x : null)) : Promise.resolve(null);

/**
 * Called from startDeclutterPrefetch (which already checked the route and read the session): every /declutter tab
 * waits on these, so it is not keyed on ?tab=.
 */
export function startDeclutterMinePrefetch(base: string, key: string, session: { token: string; userId: string }): void {
  const urls = declutterMineUrls(base, session.userId);
  const auth = { apikey: key, Authorization: `Bearer ${session.token}` };
  const rpc = (url: string) =>
    fetch(url, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "{}" }).then(listOf).catch(() => null);
  const slot = {
    at: Date.now(),
    userId: session.userId,
    cart: rpc(urls.cart),
    offers: rpc(urls.offers),
    items: fetch(urls.items, { headers: { ...auth, Accept: "application/json" } }).then(listOf).catch(() => null),
    questions: Promise.resolve(null as { ids: string[]; rows: unknown[] } | null),
  };
  // B82: the questions on the listings on sale, as soon as the listings are in (the ids the page will ask about).
  slot.questions = slot.items
    .then((rows) => {
      if (!rows) return null;
      const ids = (rows as { id?: unknown; status?: unknown }[])
        .filter((r) => typeof r.id === "string" && ASKABLE_STATUSES.includes(String(r.status)))
        .map((r) => r.id as string)
        .sort();
      if (ids.length === 0) return null;
      return fetch(unansweredQuestionsUrl(base, ids), { headers: { ...auth, Accept: "application/json" } })
        .then(listOf)
        .then((q) => (q ? { ids, rows: q } : null));
    })
    .catch(() => null);
  (window as unknown as Record<string, unknown>)[DECLUTTER_MINE_PREFETCH_KEY] = slot;
}
