import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { DECLUTTER_SHELL, LandingBrowseShell } from "./LandingBrowseShell";

// The strip's markup is its own chunk, fetched alongside the listings (load below), never with the page.
const FreshDeclutterStrip = lazy(() => import("./FreshDeclutterStrip"));
const FreshDeclutterFailed = lazy(() => import("./FreshDeclutterStrip").then((m) => ({ default: m.FreshDeclutterFailed })));

/**
 * "Fresh on Declutter" (owner 11-04, via the lead): the newest live Declutter listings, each linking to its item page,
 * plus "See everything" to /declutter. Since owner 11-08 it is the landing's "Shop Declutter" view: drawn only when the
 * visitor picks Shop Declutter on the switch under the hero (LandingBrowseSwitch.tsx), in place of the jobs section, as
 * a grid of up to FRESH_DECLUTTER_LIMIT cards in the /declutter browse card style (FreshDeclutterStrip.tsx). Nothing here is typed: no item,
 * price or count is written into the page.
 *
 * The same public read the guest /declutter feed makes (declutter_items, live, newest first): the table's row policy
 * already leaves out test listings (is_seed), hidden sellers and every listing while Declutter is closed to guests
 * ("declutter items: guests read live"; a member's read applies the same seed rule, seed_hidden_in_discovery), so an
 * empty answer means there is nothing to show and the strip is not drawn at all.
 *
 * Below the fold, so it never joins the first paint: nothing renders and nothing is fetched (not even the Supabase
 * chunk) until the spot nears the screen after the page has loaded, the LiveJobsSection rule. A failed read says so
 * and keeps the link to Declutter.
 */
export const FRESH_DECLUTTER_LIMIT = 8;
/** The card grid, shared by the strip and its placeholder so they are the same size: 2 across, 3 from sm, 4 from lg. */
export const FRESH_GRID = "grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-5 lg:gap-y-8";
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
  /** The card-sized thumbnail (photoCardUrl) and the original as its fallback. */
  photo: string | null;
  photoFull: string | null;
};
type State = { kind: "waiting" } | { kind: "failed" } | { kind: "ok"; items: FreshItem[] };

/** Q104: a good answer is kept for FRESH_REUSE_MS (LiveJobsSection's LANDING_REUSE_MS rule) and drawn at once on the next visit. */
export const FRESH_REUSE_MS = 5 * 60_000;
let recentItems: { at: number; items: FreshItem[] } | null = null;
/** Tests only: forget the kept answer. */
export function forgetRecentFreshItems() {
  recentItems = null;
}
const keptItems = () => (recentItems && Date.now() - recentItems.at < FRESH_REUSE_MS ? recentItems.items : null);

/**
 * L002 (landing audit 11-09: /#declutter CLS 0.82 at 375, 0.58 at 1440): the grid drew nothing until its read came back
 * (~1.1 s), then pushed the page down. While it loads, this holds the grid's place in the landing's own chunk (never the
 * entry): the same frame (LandingBrowseShell, heading, line, see-all space) and FRESH_DECLUTTER_LIMIT empty cards of the
 * real card's size (4:5 photo tile plus its four text lines: title, condition, list price, incl.-fee price).
 * Builder 4's F010 skeleton (ready/b4-landing-2 e24fde442b), without its entry-chunk jobs read.
 */
export function FreshDeclutterSkeleton() {
  return (
    <LandingBrowseShell testId="landing-fresh-declutter-skeleton" hidden {...DECLUTTER_SHELL}>
      <ul className={FRESH_GRID}>
        {Array.from({ length: FRESH_DECLUTTER_LIMIT }, (_, i) => (
          <li key={i} className="min-w-0">
            <span className="block aspect-[4/5] rounded-xl bg-photo-empty" />
            <span className="block px-0.5 pt-2">
              <span className="block text-ds-13 leading-snug">&nbsp;</span>
              <span className="block text-ds-11">&nbsp;</span>
              <span className="mt-0.5 block text-ds-16 leading-tight">&nbsp;</span>
              <span className="block text-ds-12 leading-tight">&nbsp;</span>
            </span>
          </li>
        ))}
      </ul>
    </LandingBrowseShell>
  );
}

export function FreshDeclutterSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>(() => {
    const kept = keptItems();
    return kept ? { kind: "ok", items: kept } : { kind: "waiting" };
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || keptItems()) return;
    let cancelled = false;
    const load = async (attempt = 0): Promise<void> => {
      void import("./FreshDeclutterStrip");
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { unwrap } = await import("@/lib/supabaseResult");
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
        } else if (popular.error.code === "PGRST202") {
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
        // The card-sized thumbnail Browse uses (photoCardUrl), its original as the fallback; loaded here, not at
        // module scope, so the landing's first paint stays as small as before.
        const { photoCardUrl, photoPublicUrl } = await import("@/lib/declutter/api");
        const items = rows.map((r) => {
          const path = first.get(r.id);
          return { ...r, photo: path ? photoCardUrl(path) : null, photoFull: path ? photoPublicUrl(path) : null };
        });
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
  }, []);

  return (
    <div ref={ref} data-testid="landing-fresh-declutter-spot">
      <Suspense fallback={<FreshDeclutterSkeleton />}>
        {state.kind === "waiting" && <FreshDeclutterSkeleton />}
        {state.kind === "failed" && <FreshDeclutterFailed />}
        {state.kind === "ok" && state.items.length > 0 && <FreshDeclutterStrip items={state.items} />}
      </Suspense>
    </div>
  );
}
