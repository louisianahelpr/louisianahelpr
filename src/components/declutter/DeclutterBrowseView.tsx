/**
 * Declutter > Browse, laid out like Jobs > Browse (owner 2026-10-28: "declutter should have the same search filter
 * and map view as jobs"; Jobs' layout: Dashboard.tsx desktopBrowseEnd, JobsSection makeHeader):
 *   - desktop website: Browse's count sits beside the "Browse" tab, and the search (opens in place, leftward), the
 *     Filters square and the map show/hide toggle sit at the END of the tabs row. The list and a map column sit side
 *     by side (list | map), the map's shown/hidden choice kept for the next visit. No permanent Filters column.
 *   - phone: the one "Search items" row (filter button inside) under the tabs, in the steady header; the filter
 *     sheet's "View" switches between the list and the map, as Jobs' does.
 * The map's pins are each item's ROUGH AREA from the server (declutter_map_pins; owner decision 2026-10-28).
 *
 * Nearest first, a distance filter in the sheet, area + miles only (spec rows 5, 27). Any distance by default (owner,
 * 2026-10-19); a saved search (Q2275) opens Browse with its filters in the URL.
 */
import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sofa } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { OfflineEmptyState } from "@/components/ui/OfflineEmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useFeedPhase } from "@/hooks/useFeedPhase";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useFeature } from "@/hooks/useFeature";
import { safeStorage } from "@/lib/safeStorage";
import { fetchDropStates, fetchLiveItems, fetchMapPins, fetchPhotos, fetchWatching, setWatch } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { DISTANCE_CHOICES, nearestFirst } from "@/lib/declutter/distance";
import { NO_FILTERS, activeFilterCount, applyBrowseFilters, browseStateFromParams, dropOutlook, type DeclutterFilters } from "@/lib/declutter/browseFilters";
import { CATEGORY_WORD } from "@/lib/declutter/categoryIcons";
import { BrowseEndCard } from "@/components/sections/BrowseEndCard";
import { InlineListSearch } from "@/components/sections/InlineListSearch";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { useSectionPreview } from "@/components/sections/ExploreSwitcher";
import { SaveSearchButton } from "@/components/savedSearches/SaveSearchButton";
import { FiltersIconButton } from "@/components/dashboard/browseTasksToolbar/FiltersIconButton";
import { MapToggleButton } from "@/components/dashboard/browseTasksToolbar/MapToggleButton";
import { ItemCard, firstPhotos } from "./DeclutterItemCard";
import { declutterFilterSections } from "./DeclutterFilterPanel";
import { DeclutterBrowseBar, DeclutterFilterSheet } from "./DeclutterBrowseBar";
import { useDeclutterOrigin } from "./useDeclutterOrigin";
import { DECLUTTER_GRID, DECLUTTER_GRID_FULL, DeclutterBrowseBones } from "./DeclutterSkeletons";

// The map (and the MapKit script it asks for) loads only when a map is shown.
const DeclutterMap = lazy(() => import("./DeclutterMap"));

/** What Browse hands the tabs row: the desktop end cluster and count, or the phone's search row under the tabs. */
export interface DeclutterBrowseHeader {
  end?: ReactNode;
  count?: number;
  below?: ReactNode;
}

/** Persisted like Jobs' "helpr.browseMapVisible", default ON (the split view is the desktop layout). */
const MAP_KEY = "helpr.declutterMapVisible";

/** The next DISTANCE_CHOICES step above `miles`; null = "Any distance". */
function widerMiles(miles: number): number | null {
  return DISTANCE_CHOICES.find((m): m is number => m !== null && m > miles) ?? null;
}

/**
 * The desktop map column's height: the scroll column's visible height, so the sticky map fills the screen beside
 * the list while the list scrolls under the steady header (the Jobs map column fills its panel the same way).
 */
function useFillHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>("[data-app-page-scroll]");
    if (!scroller) return;
    const measure = () => setHeight(Math.max(320, scroller.clientHeight - 24));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, []);
  return { ref, height };
}

/**
 * "Can't find it? Post what you're looking for" (owner 2026-10-28: "add a wanted link at the bottom of browse"): a
 * quiet row under the list and inside the no-results state, to the Wanted tab. Only while 'declutter_wanted' is on
 * for the viewer, so it is never a link to a view that is not there. Guard: src/components/declutter/declutterTabs.test.tsx.
 */
function WantedLink() {
  const on = useFeature("declutter_wanted");
  if (!on) return null;
  return (
    <p className="flex min-h-11 items-center justify-center text-center">
      {/* One run of text (it wraps as a sentence at 320); link-standard's ::before gives it the 44px tap height. */}
      <Link
        to="/declutter?tab=wanted"
        data-testid="declutter-wanted-link"
        className="link-standard text-ds-15 font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      >
        <span className="font-normal text-muted-foreground">Can't find it?</span> Post what you're looking for
      </Link>
    </p>
  );
}

export function DeclutterBrowse({ userId, tabs, top }: { userId: string; tabs: (browse: DeclutterBrowseHeader) => ReactNode; top?: ReactNode }) {
  // A tester inside Declutter before it opens to everyone: nothing for sale yet "Opens soon" (owner, 2026-10-22).
  const preview = useSectionPreview("declutter");
  const desktop = useIsWebDesktop();
  const [params] = useSearchParams();
  const [start] = useState(() => browseStateFromParams(params));
  const [maxMiles, setMaxMiles] = useState<number | null>(start.maxMiles);
  const [query, setQuery] = useState(start.query);
  const [filters, setFilters] = useState<DeclutterFilters>(start.filters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  // Phone: the list or the map (the sheet's View). Desktop: the map column shown or hidden.
  const [phoneView, setPhoneView] = useState<"list" | "map">("list");
  const [mapVisible, setMapVisible] = useState<boolean>(() => safeStorage.getItem(MAP_KEY) !== "0");
  const toggleMap = useCallback(() => {
    const next = !mapVisible;
    setMapVisible(next);
    safeStorage.setItem(MAP_KEY, next ? "1" : "0");
  }, [mapVisible]);
  const fill = useFillHeight();

  // No location prompt on landing: miles come from what we already know, and the device is asked only from the
  // "Use my location" button in the filters.
  const { origin, askDevice, asked, asking, canAskAgain, deviceNote } = useDeclutterOrigin();
  const from = origin.status === "ready" ? { lat: origin.lat, lng: origin.lng } : null;
  const items = useQuery({ queryKey: ["declutter", "live"], queryFn: fetchLiveItems });
  const others = useMemo(() => (items.data ?? []).filter((i) => i.seller_id !== userId), [items.data, userId]);
  const photos = useQuery({
    queryKey: ["declutter", "photos", others.map((i) => i.id).join(",")],
    queryFn: () => fetchPhotos(others.map((i) => i.id)),
    enabled: others.length > 0,
  });
  const cover = useMemo(() => firstPhotos(photos.data ?? []), [photos.data]);
  // The nightly drop plan per item (board 25's "May drop tonight" tag and the "Price drops" filter), beside the
  // photos and inside the one loading gate.
  const drops = useQuery({
    queryKey: ["declutter", "drop-states", others.map((i) => i.id).join(",")],
    queryFn: () => fetchDropStates(others.map((i) => i.id)),
    enabled: others.length > 0,
  });
  // The hearts on the cards: the same watchlist read and write as the item page's heart (row 46).
  const qc = useQueryClient();
  const watching = useQuery({ queryKey: ["declutter", "watching", userId], queryFn: () => fetchWatching(userId) });
  const toggleWatch = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => setWatch(id, on),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["declutter", "watching"] }),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const mapShown = desktop ? mapVisible : phoneView === "map";
  // The pins are read only while a map is on screen.
  const pins = useQuery({ queryKey: ["declutter", "map-pins"], queryFn: fetchMapPins, enabled: mapShown && others.length > 0 });

  const now = new Date();
  const outlook = new Map(others.map((i) => [i.id, dropOutlook(i, drops.data?.get(i.id), now)]));
  const showDrops = [...outlook.values()].some((o) => o.planned);
  const rows = applyBrowseFilters(nearestFirst(others, from, from ? maxMiles : null), filters, query, drops.data, now);
  const q = query.trim().toLowerCase();
  const filterCount = activeFilterCount(filters, from ? maxMiles : null);
  const clearAll = () => {
    setFilters(NO_FILTERS);
    setMaxMiles(null);
  };
  // ONE gate for the list and its cover photos, so the cards arrive in one paint instead of the list first and its
  // photos in a second wave (oneLoadingGatePerScreen.test.ts). The photos query is disabled (never loading) when
  // there is nothing to show.
  const listLoading = items.isLoading || photos.isLoading || drops.isLoading || watching.isLoading || origin.status === "pending";
  // Offline with nothing loaded is never "Nothing for sale yet" (Q571).
  const itemsPhase = useFeedPhase(items);
  const ask = { origin, asked, asking, canAskAgain, deviceNote, askDevice };

  const header: DeclutterBrowseHeader = desktop
    ? {
        count: listLoading || items.isError ? undefined : rows.length,
        end: (
          <div data-feed-strip="" className="ml-auto flex shrink-0 items-center gap-1 pb-0.5">
            <InlineListSearch value={query} onChange={setQuery} label="Search items" />
            <FiltersIconButton open={filtersOpen} count={filterCount} buttonRef={filtersButtonRef} onClick={() => setFiltersOpen((o) => !o)} />
            <MapToggleButton visible={mapVisible} onToggle={toggleMap} disabled={items.isError} />
          </div>
        ),
      }
    : {
        below: (
          <DeclutterBrowseBar query={query} onQuery={setQuery} filterCount={filterCount} filtersOpen={filtersOpen} onFilters={() => setFiltersOpen(true)} filtersButtonRef={filtersButtonRef} />
        ),
      };

  const sheet = (
    <DeclutterFilterSheet
      open={filtersOpen}
      onOpenChange={setFiltersOpen}
      anchorRef={filtersButtonRef}
      sections={declutterFilterSections({ filters, onChange: setFilters, maxMiles, onMaxMiles: setMaxMiles, ask, showDrops })}
      filterCount={filterCount}
      shown={rows.length}
      onClearAll={clearAll}
      view={desktop ? undefined : { value: phoneView, set: setPhoneView }}
    />
  );

  const map = (flush: boolean) => (
    <Suspense fallback={<Skeleton className="h-full w-full rounded-2xl" />}>
      <DeclutterMap
        rows={rows}
        pins={pins.data}
        pinsLoading={pins.isLoading}
        pinsError={pins.isError}
        onRetry={() => void pins.refetch()}
        cover={cover}
        approximate={origin.status === "ready" && origin.approximate}
        flush={flush}
      />
    </Suspense>
  );

  let body: ReactNode;
  if (items.isError) {
    body = <ErrorState variant="inline" title="We couldn't load items." body={declutterErrorMessage(items.error)} onRetry={() => void items.refetch()} />;
  } else if (listLoading) {
    // ONE PAINT: the origin line and the cards arrive together (Q?declutter-settle: CLS 0.0322 at 375 on prod).
    body = <DeclutterBrowseBones map={desktop && mapVisible} full={desktop && !mapVisible} />;
  } else if (!desktop && phoneView === "map") {
    body = <div className="h-[calc(100dvh-16rem)] min-h-[320px]">{map(false)}</div>;
  } else {
    const list = (
      <div className="min-w-0 space-y-4">
        {/* No chip row under "Search items" (owner 2026-10-21): category, porch pickup and price drops live only in
            the filter sheet. Guard: src/test/browseCategoryGroups.test.tsx. */}
        {/* Only the filters a saved search keeps (words, category, price, distance); the sheet shows them. */}
        {(q || filters.category || filters.minDollars !== null || filters.maxDollars !== null || (from && maxMiles !== null)) && (
          <SaveSearchButton
            userId={userId}
            draft={{ section: "declutter", query, category: filters.category, minDollars: filters.minDollars, maxDollars: filters.maxDollars, radiusMiles: from ? maxMiles : null }}
          />
        )}
        {itemsPhase === "offline-empty" ? (
          <OfflineEmptyState body="Items for sale will show here once you're back online." onRetry={() => void items.refetch()} />
        ) : rows.length === 0 ? (
          // The shared empty state every Browse wears (owner, 2026-10-19: Homes' style, same place).
          <EmptyState
            variant="bare"
            icon={Sofa}
            title={others.length === 0 ? (preview ? "Opens soon" : "Nothing for sale yet.") : q ? "Nothing matches that search." : filters.freeOnly && filterCount === 1 ? "Nothing free right now." : filters.category && filterCount === 1 ? `Nothing in ${CATEGORY_WORD[filters.category] ?? "this category"} right now.` : filterCount > 0 ? "Nothing matches these filters." : "Nothing for sale this close."}
            body={others.length === 0 ? "Check back soon, or sell something of your own." : q ? "Try another word." : filters.freeOnly && filterCount === 1 ? "Check back soon, or give something away yourself." : filters.category && filterCount === 1 ? "Try another category, or tap it again to see everything." : filterCount > 0 ? "Try fewer filters." : "Try a bigger distance."}
            action={<WantedLink />}
          />
        ) : (
          <ul className={desktop && !mapVisible ? DECLUTTER_GRID_FULL : DECLUTTER_GRID}>
            {rows.map(({ item, miles }) => (
              <li key={item.id} className="min-w-0">
                <ItemCard item={item} photoPath={cover.get(item.id)} miles={miles} approximate={origin.status === "ready" && origin.approximate}
                  tag={outlook.get(item.id)?.tonight ? "drop" : item.delivery_size !== "small" ? "delivery" : null}
                  save={{
                    on: watching.data?.has(item.id) ?? false,
                    toggle: () => toggleWatch.mutate({ id: item.id, on: !(watching.data?.has(item.id) ?? false) }),
                    pending: toggleWatch.isPending && toggleWatch.variables?.id === item.id,
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {rows.length > 0 && (
          <BrowseEndCard
            // Widen one step (DISTANCE_CHOICES), up to "Any distance"; none when the distance is already any (lead,
            // 2026-10-19).
            onWiden={from && maxMiles !== null ? () => setMaxMiles(widerMiles(maxMiles)) : undefined}
            widenLabel={from && maxMiles !== null ? (widerMiles(maxMiles) === null ? "Any distance" : `Widen to ${widerMiles(maxMiles)} mi`) : undefined}
            footnote={<WantedLink />}
          />
        )}
      </div>
    );
    body = desktop && mapVisible ? (
      // list | map, the map at Jobs' 48% and sticky beside the scrolling list.
      <div data-browse-split="" className="grid grid-cols-[minmax(0,1fr)_48%] gap-6">
        {list}
        <div className="sticky top-1 self-start" style={{ height: fill.height ?? 480 }}>{map(false)}</div>
      </div>
    ) : list;
  }

  return (
    <SectionScreen section="declutter" title="Declutter" globalSearch={false} tabs={tabs(header)}>
      <div ref={fill.ref} className="contents" />
      {top}
      {body}
      {sheet}
    </SectionScreen>
  );
}
