import { useEffect, useState, type RefObject } from "react";

/**
 * The landing's Declutter listings (owner 11-04, via the lead; popular first since owner 11-09). Since Direction A
 * (owner 11-10) they are drawn beside the open jobs in "Near you this week" (NearYouSection.tsx) and the photo band's
 * porch-pickup tile (LandingPhotoBand.tsx), in the /declutter browse card style (FreshDeclutterStrip.tsx). Nothing here
 * is typed: no item, price or count is written into the page.
 *
 * The same public read the guest /declutter feed makes (declutter_items, live, newest first): the table's row policy
 * already leaves out test listings (is_seed), hidden sellers and every listing while Declutter is closed to guests
 * ("declutter items: guests read live"; a member's read applies the same seed rule, seed_hidden_in_discovery), so an
 * empty answer means there are no items to show.
 *
 * Below the fold, so it never joins the first paint: nothing renders and nothing is fetched (not even the Supabase
 * chunk) until the spot nears the screen after the page has loaded, the useLiveJobs rule. A failed read is reported
 * once and the section says so.
 */
export const FRESH_DECLUTTER_LIMIT = 8;
/** The card grid, shared by the Near you grid and its placeholder so they are the same size: 2 across, 3 from sm, 4 from lg. */
export const FRESH_GRID = "grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-5 lg:gap-y-8";
/**
 * Never a half-empty last row (audit 2026-10-28 P5-6; the 768 after-shot of 11-10 showed 8 cards as 3 + 3 + 2): a card
 * past the last FULL row at a width is hidden at that width (2 across on a phone, 3 from sm, 4 from lg). A grid smaller
 * than one row shows every card.
 */
export function fullRowsCellClass(i: number, n: number): string {
  const past = (cols: number) => n > cols && i >= Math.floor(n / cols) * cols;
  return [past(2) && "max-sm:hidden", past(3) && "sm:max-lg:hidden", past(4) && "lg:hidden"].filter(Boolean).join(" ");
}
/**
 * D006 (landing design audit 11-10): the card's type, shared with the placeholder so both are the same height. On the
 * app's five-size scale (11/13/16/20/28): a two-line 16px title (it was one 13px line), the town at 13px (it was the
 * condition, "Like new" on almost every card), the LIST price first at 20px (it was 16), and "$X.XX incl. fee"
 * smaller under it at 13px (it was 11).
 */
export const FRESH_TITLE = "text-ds-15 font-semibold leading-snug min-h-[2.75em]";
export const FRESH_TOWN = "text-ds-13 leading-snug";
export const FRESH_PRICE = "text-ds-20 leading-tight";
export const FRESH_INCL = "text-ds-13 leading-tight";
/** What the browse card draws, all within the anon column grant on declutter_items (accepts_trades is not, yet). */
const FRESH_SELECT = "id, title, category, condition_stars, porch_ok, price_cents, current_price_cents, area_label, live_at";
/** The pause before the one quiet retry of a failed read (the LiveJobsSection rule, Q2735). */
const FRESH_DECLUTTER_RETRY_MS = 1500;

export type FreshItem = {
  id: string;
  title: string;
  category: string;
  condition_stars: number;
  porch_ok: boolean;
  price_cents: number;
  current_price_cents: number;
  area_label: string | null;
  /** The landing card's thumbnail (photoLandingCardUrl, 640x800) and the original as its fallback. */
  photo: string | null;
  photoFull: string | null;
};
export type FreshState = { kind: "waiting" } | { kind: "failed" } | { kind: "ok"; items: FreshItem[] };

/** Q104: a good answer is kept for FRESH_REUSE_MS (LiveJobsSection's LANDING_REUSE_MS rule) and drawn at once on the next visit. */
export const FRESH_REUSE_MS = 5 * 60_000;
let recentItems: { at: number; items: FreshItem[] } | null = null;
/** Tests only: forget the kept answer. */
export function forgetRecentFreshItems() {
  recentItems = null;
}
const keptItems = () => (recentItems && Date.now() - recentItems.at < FRESH_REUSE_MS ? recentItems.items : null);

/**
 * One read of the popular listings, shared by every caller on the page while it is in flight (Direction A, 11-10: the
 * photo band and "Near you this week" both show them; one request, never two).
 */
let inflight: Promise<FreshItem[]> | null = null;
function sharedFreshRead(): Promise<FreshItem[]> {
  inflight ??= readFreshItems().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function readFreshItems(): Promise<FreshItem[]> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { unwrap } = await import("@/lib/supabaseResult");
  const { isMissingRpcNamed } = await import("@/lib/missingRpc");
  // Owner 11-09 (10:55 PM): POPULAR items first, not just the newest. One call: declutter_popular_items
  // (20261110054539) ranks live, priced, photographed, non-test listings by saves, offers and recent page views,
  // then the best-selling categories, then the newest, and returns each card's cover photo path with it.
  const popular = await supabase.rpc("declutter_popular_items", { p_limit: FRESH_DECLUTTER_LIMIT });
  let rows: Omit<FreshItem, "photo" | "photoFull">[];
  let first = new Map<string, string>();
  if (!popular.error) {
    const got = popular.data ?? [];
    rows = got.map(({ photo_path: _p, live_at: _l, ...r }) => r);
    for (const r of got) if (r.photo_path) first.set(r.id, r.photo_path);
  } else if (isMissingRpcNamed(popular.error, "declutter_popular_items")) {
    // The function is not deployed yet (a client ahead of db-deploy): the newest listings, as before.
    rows = (unwrap(
      await supabase
        .from("declutter_items")
        .select(FRESH_SELECT)
        .eq("status", "live")
        .order("live_at", { ascending: false })
        .limit(FRESH_DECLUTTER_LIMIT),
    ) ?? []) as unknown as Omit<FreshItem, "photo" | "photoFull">[];
  } else {
    throw popular.error;
  }
  if (rows.length > 0 && first.size === 0) {
    const photos = (unwrap(
      await supabase
        .from("declutter_item_photos")
        .select("item_id, storage_path, position")
        .in("item_id", rows.map((r) => r.id))
        .order("position", { ascending: true }),
    ) ?? []) as { item_id: string; storage_path: string }[];
    first = new Map();
    for (const p of photos) if (!first.has(p.item_id)) first.set(p.item_id, p.storage_path);
  }
  // D017 (11-10): a 640x800 thumbnail sized for the landing's 4:5 card (photoLandingCardUrl), its original as the
  // fallback; loaded here, not at module scope, so the landing's first paint stays as small as before.
  const { photoLandingCardUrl, photoPublicUrl } = await import("@/lib/declutter/api");
  const items = rows.map((r) => {
    const path = first.get(r.id);
    return { ...r, photo: path ? photoLandingCardUrl(path) : null, photoFull: path ? photoPublicUrl(path) : null };
  });
  return items;
}

/**
 * The popular Declutter listings, read once the page has loaded and the element nears the screen (Direction A, 11-10:
 * the "Near you this week" section and the photo band read them through this hook too).
 */
export function useFreshItems(ref: RefObject<HTMLElement>): FreshState {
  const [state, setState] = useState<FreshState>(() => {
    const kept = keptItems();
    return kept ? { kind: "ok", items: kept } : { kind: "waiting" };
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || keptItems()) return;
    let cancelled = false;
    const load = async (attempt = 0): Promise<void> => {
      void import("./FreshDeclutterStrip"); // the grid chunk, fetched beside the listings
      try {
        const items = await sharedFreshRead();
        recentItems = { at: Date.now(), items };
        if (!cancelled) setState({ kind: "ok", items });
      } catch (err) {
        // Q2735 (11-04, iPhone Safari guests on /): the jobs section's read failed on a phone's network blip and the
        // log held no cause. Same rule here: one quiet retry after a short pause, and a second failure is reported
        // with its cause before the strip says so.
        if (cancelled) return;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, FRESH_DECLUTTER_RETRY_MS));
          if (!cancelled) return load(1);
          return;
        }
        void (async () => {
          try {
            const { report } = await import("@/lib/errorLogger");
            report(err, { tags: { source: "FreshDeclutterSection.load" } });
          } catch { /* the visible failed state below is the signal; logging must never throw */ }
        })();
        // Not silent: the strip says the newest listings did not load and keeps the link to Declutter
        // (data-testid="landing-fresh-declutter-failed").
        setState({ kind: "failed" });
      }
    };
    let io: IntersectionObserver | null = null;
    const watch = () => {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io?.disconnect();
            void load();
          }
        },
        { rootMargin: "600px 0px" },
      );
      io.observe(el);
    };
    // Never during the first paint: start watching only once the page has loaded.
    if (document.readyState === "complete") watch();
    else window.addEventListener("load", watch, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", watch);
      io?.disconnect();
    };
  }, [ref]);
  return state;
}
