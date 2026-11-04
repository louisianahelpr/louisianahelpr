import { lazy, Suspense, useEffect, useRef, useState } from "react";

// The strip's markup is its own chunk, fetched alongside the listings (load below), never with the page.
const FreshDeclutterStrip = lazy(() => import("./FreshDeclutterStrip"));
const FreshDeclutterFailed = lazy(() => import("./FreshDeclutterStrip").then((m) => ({ default: m.FreshDeclutterFailed })));

/**
 * "Fresh on Declutter" (owner 11-04, via the lead): the newest live Declutter listings under the landing's jobs
 * section, each linking to its item page, plus "See everything" to /declutter. Nothing here is typed: no item,
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
export const FRESH_DECLUTTER_LIMIT = 6;
const FRESH_SELECT = "id, title, current_price_cents, area_label, live_at";

export type FreshItem = { id: string; title: string; current_price_cents: number; area_label: string | null; photo: string | null; photoFull: string | null };
type State = { kind: "waiting" } | { kind: "failed" } | { kind: "ok"; items: FreshItem[] };

export function FreshDeclutterSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>({ kind: "waiting" });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let cancelled = false;
    const load = async () => {
      void import("./FreshDeclutterStrip");
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { unwrap } = await import("@/lib/supabaseResult");
        const rows = (unwrap(
          await supabase
            .from("declutter_items")
            .select(FRESH_SELECT)
            .eq("status", "live")
            .order("live_at", { ascending: false })
            .limit(FRESH_DECLUTTER_LIMIT),
        ) ?? []) as unknown as Omit<FreshItem, "photo" | "photoFull">[];
        let first = new Map<string, string>();
        if (rows.length > 0) {
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
        if (!cancelled) setState({ kind: "ok", items });
      } catch {
        // Not silent: the strip says the newest listings did not load and keeps the link to Declutter
        // (data-testid="landing-fresh-declutter-failed").
        if (!cancelled) setState({ kind: "failed" });
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
      <Suspense fallback={null}>
        {state.kind === "failed" && <FreshDeclutterFailed />}
        {state.kind === "ok" && state.items.length > 0 && <FreshDeclutterStrip items={state.items} />}
      </Suspense>
    </div>
  );
}
