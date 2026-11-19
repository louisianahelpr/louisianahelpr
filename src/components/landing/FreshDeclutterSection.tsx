import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { DECLUTTER_SHELL, LandingBrowseShell, type BrowseShellCopy } from "./LandingBrowseShell";

// The strip's markup is its own chunk, fetched alongside the listings (load below), never with the page.
const FreshDeclutterStrip = lazy(() => import("./FreshDeclutterStrip"));
const FreshDeclutterFailed = lazy(() => import("./FreshDeclutterStrip").then((m) => ({ default: m.FreshDeclutterFailed })));

/**
 * "Fresh on Declutter" (owner 11-04, via the lead): the newest live Declutter listings, each linking to its item page,
 * plus "See everything" to /declutter. Since owner 11-08 it is the landing's "Shop Declutter" view; since owner 11-18
 * (no Jobs | Declutter tabs) it is drawn under the jobs section (LandingBrowseSwitch.tsx), as
 * a grid of up to FRESH_DECLUTTER_LIMIT small cards in the /declutter browse card style, cute picks first (owner 11-18) (FreshDeclutterStrip.tsx). Nothing here is typed: no item,
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
/** Owner 11-18 ("Make these smaller"): 12 small cards, so every row is full at 3, 4 and 6 across. */
export const FRESH_DECLUTTER_LIMIT = 12;
/** How many of declutter_popular_items' best to ask for (the function caps p_limit at 24). */
const FRESH_POPULAR_LIMIT = 24;
/** The live pool the cute picks come from (225 live listings on prod 11-18; the read is below the fold, after load). */
const FRESH_POOL_LIMIT = 300;
/**
 * The card grid, shared by the strip and its placeholder so they are the same size. Owner 11-18 ("Make these
 * smaller"): 3 across on a phone, 4 from sm, 6 from lg (it was 2 / 3 / 4). Each whole card is the link, far over 44px.
 */
export const FRESH_GRID = "grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4 sm:gap-x-3 lg:grid-cols-6 lg:gap-x-4 lg:gap-y-6";
/**
 * D006 (landing design audit 11-10): the card's type, shared with the placeholder so both are the same height: a two-line
 * title, the town, the LIST price first, "$X.XX incl. fee" smaller under it. Owner 11-18 ("Make these smaller"): one
 * step down each on the five-size scale, for the 3-across phone card: title 13px (was 15), town 11 (was 13), price 16
 * (was 20), incl. fee 11 (was 13).
 */
export const FRESH_TITLE = "text-ds-13 font-semibold leading-snug min-h-[2.75em]";
export const FRESH_TOWN = "text-ds-11 leading-snug";
export const FRESH_PRICE = "text-ds-16 leading-tight";
export const FRESH_INCL = "text-ds-11 leading-tight";
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
export function FreshDeclutterSkeleton({ shell = DECLUTTER_SHELL }: { shell?: BrowseShellCopy }) {
  return (
    <LandingBrowseShell testId="landing-fresh-declutter-skeleton" hidden {...shell}>
      <ul className={FRESH_GRID}>
        {Array.from({ length: FRESH_DECLUTTER_LIMIT }, (_, i) => (
          <li key={i} className="min-w-0">
            <span className="block aspect-[4/5] rounded-xl bg-photo-empty" />
            <span className="block px-0.5 pt-2">
              {/* The real card's lines (D006, owner 11-18 sizes): a two-line title, the town, the list price, the incl.-fee line. */}
              <span className={`block ${FRESH_TITLE}`}>&nbsp;<br />&nbsp;</span>
              <span className={`block ${FRESH_TOWN}`}>&nbsp;</span>
              <span className={`mt-0.5 block ${FRESH_PRICE}`}>&nbsp;</span>
              <span className={`block ${FRESH_INCL}`}>&nbsp;</span>
            </span>
          </li>
        ))}
      </ul>
    </LandingBrowseShell>
  );
}

/** `shell`: the words over the grid; the Jobs view passes NO_JOBS_DECLUTTER_SHELL when there is no open job (D003). */
export function FreshDeclutterSection({ shell = DECLUTTER_SHELL }: { shell?: BrowseShellCopy } = {}) {
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
      // A warm-up only: the lazy() render below asks for the chunk again, and a stale chunk there throws into the
      // boundary's shared recovery. Uncaught, a deploy that removed the old hash was an unhandled rejection
      // (prod error_logs 2026-11-09: "Failed to fetch dynamically imported module: .../FreshDeclutterStrip-B8h5bSe-.js").
      import("./FreshDeclutterStrip").catch(() => { /* warm-up only; the render's own load reports a real failure */ });
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { unwrap } = await import("@/lib/supabaseResult");
        const { isMissingRpcNamed } = await import("@/lib/missingRpc");
        // Owner 11-09 (10:55 PM): POPULAR items first, not just the newest: declutter_popular_items
        // (20261110054539) ranks live, priced, photographed, non-test listings by saves, offers and recent page views,
        // then the best-selling categories, then the newest, and returns each card's cover photo path with it.
        // Owner 11-18 ("Show cuter things like the Vera Bradley bag, lamp, sunglasses pillow cover Basket stockings"):
        // the function's top FRESH_POPULAR_LIMIT (its cap is 24) held none of them, so the live pool is read too and
        // pickCuteFirst (cuteDeclutterPicks.ts) puts the cute, giftable pieces first, popular order breaking ties.
        type Row = Omit<FreshItem, "photo" | "photoFull">;
        const popular = await supabase.rpc("declutter_popular_items", { p_limit: FRESH_POPULAR_LIMIT });
        const readPool = async () =>
          (unwrap(
            await supabase
              .from("declutter_items")
              .select(FRESH_SELECT)
              .eq("status", "live")
              .order("live_at", { ascending: false })
              .limit(FRESH_POOL_LIMIT),
          ) ?? []) as unknown as Row[];
        let rows: Row[];
        const first = new Map<string, string>();
        if (!popular.error) {
          const got = popular.data ?? [];
          rows = got.map(({ photo_path: _p, live_at: _l, ...r }) => r);
          for (const r of got) if (r.photo_path) first.set(r.id, r.photo_path);
          // The pool only adds picks: when it fails the popular rows still show (the read that counts is the one above).
          let pool: Row[] = [];
          try {
            pool = await readPool();
          } catch { /* the popular rows alone still fill the grid; a failed pool read only costs the cuter picks */ }
          const have = new Set(rows.map((r) => r.id));
          rows = rows.concat(pool.filter((r) => !have.has(r.id) && r.current_price_cents > 0));
        } else if (isMissingRpcNamed(popular.error, "declutter_popular_items")) {
          // The function is not deployed yet (a client ahead of db-deploy): the live pool, newest first.
          rows = (await readPool()).filter((r) => r.current_price_cents > 0);
        } else {
          throw popular.error;
        }
        const { pickCuteFirst } = await import("./cuteDeclutterPicks");
        const ranked = pickCuteFirst(rows);
        // A card needs a photo (the function only returns photographed listings; the pool may not): look up the cover
        // of the leading picks that came without one, and keep FRESH_DECLUTTER_LIMIT that have a photo.
        const lead = ranked.slice(0, FRESH_DECLUTTER_LIMIT * 2);
        const missing = lead.filter((r) => !first.has(r.id)).map((r) => r.id);
        if (missing.length > 0) {
          const photos = (unwrap(
            await supabase
              .from("declutter_item_photos")
              .select("item_id, storage_path, position")
              .in("item_id", missing)
              .order("position", { ascending: true }),
          ) ?? []) as { item_id: string; storage_path: string }[];
          for (const p of photos) if (!first.has(p.item_id)) first.set(p.item_id, p.storage_path);
        }
        const withPhoto = lead.filter((r) => first.has(r.id));
        rows = (withPhoto.length > 0 ? withPhoto : lead).slice(0, FRESH_DECLUTTER_LIMIT);
        // D017 (11-10): a 640x800 thumbnail sized for the landing's 4:5 card (photoLandingCardUrl), its original as the
        // fallback; loaded here, not at module scope, so the landing's first paint stays as small as before.
        const { photoLandingCardUrl, photoPublicUrl } = await import("@/lib/declutter/api");
        const items = rows.map((r) => {
          const path = first.get(r.id);
          return { ...r, photo: path ? photoLandingCardUrl(path) : null, photoFull: path ? photoPublicUrl(path) : null };
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
      <Suspense fallback={<FreshDeclutterSkeleton shell={shell} />}>
        {state.kind === "waiting" && <FreshDeclutterSkeleton shell={shell} />}
        {state.kind === "failed" && <FreshDeclutterFailed shell={shell} />}
        {state.kind === "ok" && state.items.length > 0 && <FreshDeclutterStrip items={state.items} shell={shell} />}
      </Suspense>
    </div>
  );
}
