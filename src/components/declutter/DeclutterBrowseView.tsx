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
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sofa } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { BrowseEmptyState } from "@/components/ui/BrowseEmptyState";
import { OfflineEmptyState } from "@/components/ui/OfflineEmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useFeedPhase } from "@/hooks/useFeedPhase";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useFeature } from "@/hooks/useFeature";
import { safeStorage } from "@/lib/safeStorage";
import { fetchDropStates, fetchLiveItems, fetchMapPins, fetchPhotos, fetchWatching, setWatch } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { DISTANCE_CHOICES, nearestFirst } from "@/lib/declutter/distance";
import { NO_FILTERS, activeFilterCount, applyBrowseFilters, browseStateFromParams, browseStateInParams, dropOutlook, isNewSince, newSinceFromParams, type DeclutterFilters } from "@/lib/declutter/browseFilters";
import { CATEGORY_LABEL } from "@/lib/declutter/categoryIcons";
import { BrowseEndCard } from "@/components/sections/BrowseEndCard";
import { InlineListSearch } from "@/components/sections/InlineListSearch";
import { SearchTriggerSlot } from "@/components/ui/ScreenHeaderRow";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { SaveSearchButton } from "@/components/savedSearches/SaveSearchButton";
import { FiltersIconButton } from "@/components/dashboard/browseTasksToolbar/FiltersIconButton";
import { MapToggleButton } from "@/components/dashboard/browseTasksToolbar/MapToggleButton";
import { ItemCard, firstPhotos } from "./DeclutterItemCard";
import { DeclutterMilesFrom } from "./DeclutterMilesFrom";
import { declutterFilterSections } from "./DeclutterFilterPanel";
import { DeclutterFilterSheet } from "./DeclutterBrowseBar";
import { useDeclutterOrigin } from "./useDeclutterOrigin";
import { mapFillHeight } from "@/lib/declutter/mapFillHeight";
import { DECLUTTER_GRID, DECLUTTER_GRID_FULL, DeclutterBrowseBones, declutterFirstRowCount } from "./DeclutterSkeletons";
import { fetchBundleSellers } from "@/lib/declutter/bundle";
import { SELL_CHOOSER_PATH } from "@/lib/declutter/sellChooser";
import { previewIsTopOfList, readFirstScreenPreview, type FirstScreenAnswer } from "@/lib/declutter/bootPrefetch";
import { toastWatching } from "./DeclutterWatching";

// The map (and the MapKit script it asks for) loads only when a map is shown.
const DeclutterMap = lazy(() => import("./DeclutterMap"));

/** What Browse hands the tabs row: the desktop end cluster and count, or the phone's search row under the tabs. */
export interface DeclutterBrowseHeader {
  end?: ReactNode;
  count?: number;
  /** A phone's open search takes the row, so only the selected tab stays beside it. */
  onlySelected?: boolean;
}

/** Persisted like Jobs' "helpr.jobsMapVisible", default ON (the split view is the desktop layout). */
const MAP_KEY = "helpr.declutterMapVisible";
// NIGHT-BUYINGrealma-1: the phone's List or Map choice is kept too (it was plain state, so a reload went back to List).
const PHONE_VIEW_KEY = "helpr.declutterPhoneView";

/** The next DISTANCE_CHOICES step above `miles`; null = "Any distance". */
function widerMiles(miles: number): number | null {
  return DISTANCE_CHOICES.find((m): m is number => m !== null && m > miles) ?? null;
}

/**
 * The desktop map column's height: the scroll column's visible height, so the sticky map fills the screen beside
 * the list while the list scrolls under the steady header (the Jobs map column fills its panel the same way), less
 * the padding around the list (mapFillHeight), so a short list beside the map does not scroll (DA-8).
 */
function useFillHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>("[data-app-page-scroll]");
    if (!scroller) return;
    const measure = () => setHeight(mapFillHeight(scroller));
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

/**
 * Browse with nothing for sale near the member at all (owner 2026-10-30, via the lead). It said "Opens soon" to the
 * owner and admins, who already HAVE Declutter, because the only live listings were test accounts' (hidden from real
 * accounts). Now the two ways forward, as the app's pill buttons: Sell something (the sell form) and, while Wanted is
 * on for the viewer, Post what you're looking for (the Wanted tab).
 */
function NothingForSaleActions({ guest }: { guest: boolean }) {
  const wanted = useFeature("declutter_wanted");
  return (
    <div className="flex flex-col items-center gap-2" data-nothing-for-sale="">
      {/* A guest can't sell yet (lead 10-31): Sign up to sell, coming back to the sell chooser after. */}
      {guest ? (
        <BarkPillButton asChild><Link to={`/signup?redirect=${encodeURIComponent(SELL_CHOOSER_PATH)}`}>Sign up to sell</Link></BarkPillButton>
      ) : (
        <BarkPillButton asChild><Link to={SELL_CHOOSER_PATH}>Sell something</Link></BarkPillButton>
      )}
      {wanted && (
        <Button asChild variant="outline" className="rounded-full">
          <Link to="/declutter?tab=wanted">Post what you're looking for</Link>
        </Button>
      )}
    </div>
  );
}

const BROWSE_URL_WAIT_MS = 300;

/**
 * userId null: a guest (BUY-16, owner 10-30 "Guests see Declutter Browse and item pages; sign up to buy or offer"). A
 * guest reads the listings, their photos and drop columns (the anon policies of 20261031060656); the hearts, saved
 * searches, bundle chips and the map read member-only data (declutter_watchlist, saved searches, and the
 * declutter_bundle_sellers / declutter_map_pins RPCs granted to authenticated only), so a guest gets none of them.
 */
export function DeclutterBrowse({ userId, tabs, top }: { userId: string | null; tabs: (browse: DeclutterBrowseHeader) => ReactNode; top?: ReactNode }) {
  const desktop = useIsWebDesktop();
  const member = userId !== null;
  const [params, setParams] = useSearchParams();
  const [start] = useState(() => browseStateFromParams(params));
  // BUY-53: from a saved search, the listings its "N new" counted wear the New tag.
  const [newSince] = useState(() => newSinceFromParams(params));
  const [maxMiles, setMaxMiles] = useState<number | null>(start.maxMiles);
  const [query, setQuery] = useState(start.query);
  const [filters, setFilters] = useState<DeclutterFilters>(start.filters);
  // Audit item 4 / BUY-35: the search stays in the URL (no new history entry), so Back from an item finds it. A short
  // wait, so typing doesn't re-render everything that reads the route on every key.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = browseStateInParams(params, { query, filters, maxMiles });
      if (next.toString() !== params.toString()) setParams(next, { replace: true, preventScrollReset: true });
    }, BROWSE_URL_WAIT_MS);
    return () => clearTimeout(t);
  }, [query, filters, maxMiles, params, setParams]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  // Phone: the list or the map (the sheet's View). Desktop: the map column shown or hidden.
  const [phoneView, setPhoneViewState] = useState<"list" | "map">(() => (safeStorage.getItem(PHONE_VIEW_KEY) === "map" ? "map" : "list"));
  const setPhoneView = useCallback((v: "list" | "map") => {
    setPhoneViewState(v);
    safeStorage.setItem(PHONE_VIEW_KEY, v);
  }, []);
  const [mapChoice, setMapChoice] = useState<boolean>(() => safeStorage.getItem(MAP_KEY) !== "0");
  // BUY-16: no map for a guest (its pins are a member-only read).
  const mapVisible = member && mapChoice;
  const toggleMap = useCallback(() => {
    const next = !mapChoice;
    setMapChoice(next);
    safeStorage.setItem(MAP_KEY, next ? "1" : "0");
  }, [mapChoice]);
  const fill = useFillHeight();

  // No location prompt on landing: miles come from what we already know, and the device is asked only from the
  // "Use my location" button (in the filters, and on the miles line above the cards, DA-10).
  const { origin, askDevice, asked, asking, canAskAgain, deviceNote, zip } = useDeclutterOrigin();
  const from = origin.status === "ready" ? { lat: origin.lat, lng: origin.lng } : null;
  const items = useQuery({ queryKey: ["declutter", "live"], queryFn: fetchLiveItems });
  // More listings than a cold load's first answer holds (declutter_first_screen): its cards show while the full read
  // runs, ONLY when they are exactly the top of the final list, so nothing moves when the rest arrive. Searching,
  // filtering, a distance or another sort needs the whole list, so each of those waits for it.
  const [capped, setCapped] = useState<Pick<FirstScreenAnswer, "items" | "near"> | null>(null);
  useEffect(() => {
    let alive = true;
    void readFirstScreenPreview().then((p) => {
      if (alive) setCapped(p);
    });
    return () => {
      alive = false;
    };
  }, []);
  const preview =
    !items.data && !!capped && origin.status !== "pending" &&
    previewIsTopOfList(capped.near, from, query.trim() === "" && filters.sort === "closest" && activeFilterCount(filters, maxMiles) === 0);
  const listed = (items.data ?? (preview ? capped?.items : undefined)) as typeof items.data;
  const others = useMemo(() => (listed ?? []).filter((i) => i.seller_id !== userId), [listed, userId]);
  // keepPreviousData: when the full list replaces the preview the ids change, and the cards on screen keep their photos
  // and tags instead of going back to the bones. Below them, a card's photo comes with the next read.
  const photos = useQuery({
    queryKey: ["declutter", "photos", others.map((i) => i.id).join(",")],
    queryFn: () => fetchPhotos(others.map((i) => i.id)),
    enabled: others.length > 0,
    placeholderData: keepPreviousData,
  });
  const cover = useMemo(() => firstPhotos(photos.data ?? []), [photos.data]);
  // The nightly drop plan per item (board 25's "May drop tonight" tag and the "Price drops" filter), beside the
  // photos and inside the one loading gate.
  const drops = useQuery({
    queryKey: ["declutter", "drop-states", others.map((i) => i.id).join(",")],
    queryFn: () => fetchDropStates(others.map((i) => i.id)),
    enabled: others.length > 0,
    placeholderData: keepPreviousData,
  });
  // D-NEW12: the sellers on this page with a bundle discount on (one read; no chip until it is deployed).
  const sellerIds = useMemo(() => [...new Set(others.map((i) => i.seller_id))].sort(), [others]);
  const bundles = useQuery({ queryKey: ["declutter", "bundle-sellers", sellerIds.join(",")], queryFn: () => fetchBundleSellers(sellerIds), enabled: member && sellerIds.length > 0, placeholderData: keepPreviousData });
  // The hearts on the cards: the same watchlist read and write as the item page's heart (row 46).
  const qc = useQueryClient();
  const watching = useQuery({ queryKey: ["declutter", "watching", userId], queryFn: () => fetchWatching(userId ?? ""), enabled: member });
  const navigate = useNavigate();
  const toggleWatch = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => setWatch(id, on),
    onSuccess: (_r, { on }) => {
      // SS-5: a new heart says where to find the item again.
      if (on) toastWatching(navigate);
      void qc.invalidateQueries({ queryKey: ["declutter", "watching"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const mapShown = desktop ? mapVisible : member && phoneView === "map";
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
  // A search or a filter that found nothing is never "Opens soon" (lead walkthrough 2026-10-28, shot 04): it says
  // nothing matched, with a way to clear it and the Wanted link.
  const searched = q !== "" || filterCount > 0;
  // ONE gate for the list and its cover photos, so the cards arrive in one paint instead of the list first and its
  // photos in a second wave (oneLoadingGatePerScreen.test.ts). The photos query is disabled (never loading) when
  // there is nothing to show.
  const listLoading = (items.isLoading && !preview) || photos.isLoading || drops.isLoading || watching.isLoading || origin.status === "pending";
  // Offline with nothing loaded is never "Nothing for sale yet" (Q571).
  const itemsPhase = useFeedPhase(items);
  const ask = { origin, asked, asking, canAskAgain, deviceNote, askDevice, zip, guest: !member };

  const [searchOpen, setSearchOpen] = useState(false);
  const header: DeclutterBrowseHeader = desktop
    ? {
        count: listLoading || preview || items.isError ? undefined : rows.length,
        end: (
          <div data-feed-strip="" className="ml-auto flex shrink-0 items-center gap-1 pb-0.5">
            <InlineListSearch value={query} onChange={setQuery} label="Search items" />
            <FiltersIconButton open={filtersOpen} count={filterCount} buttonRef={filtersButtonRef} onClick={() => setFiltersOpen((o) => !o)} />
            {member && <MapToggleButton visible={mapVisible} onToggle={toggleMap} disabled={items.isError} />}
          </div>
        ),
      }
    : {
        onlySelected: searchOpen,
        // Phone: search + filters end the tabs row, before the gear, as Jobs' (Dashboard's phoneBrowseEnd; owner 10-30).
        end: (
          <div data-browse-phone-controls="" className={`flex items-center gap-0 self-center ${searchOpen ? "ml-2 min-w-0 flex-1" : "-ml-1 shrink-0"}`}>
            <InlineListSearch value={query} onChange={setQuery} label="Search items" onOpenChange={setSearchOpen} fill />
            {searchOpen && <SearchTriggerSlot width="40px" />}
            <FiltersIconButton open={filtersOpen} count={filterCount} buttonRef={filtersButtonRef} onClick={() => setFiltersOpen(true)} />
          </div>
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
      view={desktop || !member ? undefined : { value: phoneView, set: setPhoneView }}
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
  } else if (!desktop && mapShown) {
    // DA-13: the map's way back is on the map, not only inside Filters > View (where the map itself stays, owner 2026-10-20).
    body = (
      <div className="space-y-2">
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" className="rounded-full" data-map-back="" onClick={() => setPhoneView("list")}>
            Show list
          </Button>
        </div>
        <div className="h-[calc(100dvh-19rem)] min-h-[320px]">{map(false)}</div>
      </div>
    );
  } else {
    const list = (
      <div className={rows.length === 0 ? "flex min-h-0 min-w-0 flex-1 flex-col gap-4" : "min-w-0 space-y-4"}>
        {/* No chip row under "Search items" (owner 2026-10-21): category, porch pickup and price drops live only in
            the filter sheet. Guard: src/test/browseCategoryGroups.test.tsx. */}
        {/* Only the filters a saved search keeps (words, category, price, distance); the sheet shows them. */}
        {/* Free can't be kept yet: saved without it, the search would alert on everything else in the category (BUY-13). */}
        {member && !filters.freeOnly && (q || filters.category || filters.minDollars !== null || filters.maxDollars !== null || (from && maxMiles !== null)) && (
          <SaveSearchButton
            userId={userId}
            draft={{ section: "declutter", query, category: filters.category, minDollars: filters.minDollars, maxDollars: filters.maxDollars, radiusMiles: from ? maxMiles : null, origin: from ?? null }}
          />
        )}
        {/* Where the miles are measured from, and "Use my location", in sight above the cards (DA-10). */}
        {itemsPhase !== "offline-empty" && rows.length > 0 && <DeclutterMilesFrom ask={ask} />}
        {itemsPhase === "offline-empty" ? (
          <OfflineEmptyState body="Items for sale will show here once you're back online." onRetry={() => void items.refetch()} />
        ) : rows.length === 0 ? (
          // The shared empty state every Browse wears (owner, 2026-10-19: Homes' style, same place).
          <BrowseEmptyState
            icon={Sofa}
            title={q ? "Nothing matches that search." : filters.freeOnly && filterCount === 1 ? "Nothing free right now." : filters.category && filterCount === 1 ? `Nothing in ${CATEGORY_LABEL[filters.category] ?? "this category"} right now.` : filterCount > 0 ? "Nothing matches these filters." : others.length === 0 ? "Nothing for sale near you yet." : "Nothing for sale this close."}
            // The category line no longer says "tap it again": the category chips left Browse for the filter sheet
            // (owner 2026-10-21); the Clear button below is the way back to everything.
            body={q ? "Try another word." : filters.freeOnly && filterCount === 1 ? "Check back soon, or give something away yourself." : filters.category && filterCount === 1 ? "Try another category." : filterCount > 0 ? "Try fewer filters." : others.length === 0 ? "Be the first to sell something, or say what you're looking for." : "Try a bigger distance."}
            action={
              // Owner 2026-10-30 (via the lead): nothing for sale at all is a real empty state for everyone who has
              // Declutter, never "Opens soon": Sell something, and Post what you're looking for (NothingForSaleActions).
              !searched && others.length === 0 ? <NothingForSaleActions guest={!member} /> :
              <div className="flex flex-col items-center gap-2">
                {searched && (
                  <Button type="button" variant="outline" size="sm" className="rounded-full" data-testid="declutter-clear-search" onClick={() => { setQuery(""); clearAll(); }}>
                    {/* Not "Clear search": that name is the search field's own ✕ (searchFieldsAllChecked). */}
                    Show all items
                  </Button>
                )}
                <WantedLink />
              </div>
            }
          />
        ) : (
          <ul className={desktop && !mapVisible ? DECLUTTER_GRID_FULL : DECLUTTER_GRID}>
            {rows.map(({ item, miles }, index) => (
              <li key={item.id} className="min-w-0">
                <ItemCard item={item} photoPath={cover.get(item.id)} miles={miles} approximate={origin.status === "ready" && origin.approximate}
                  firstRow={index < declutterFirstRowCount(desktop && !mapVisible, window.innerWidth)}
                  tag={isNewSince(item, newSince) ? "new" : outlook.get(item.id)?.tonight ? "drop" : item.delivery_size !== "small" ? "delivery" : null}
                  bundle={bundles.data?.has(item.seller_id) ?? false}
                  save={member ? {
                    on: watching.data?.has(item.id) ?? false,
                    toggle: () => toggleWatch.mutate({ id: item.id, on: !(watching.data?.has(item.id) ?? false) }),
                    pending: toggleWatch.isPending && toggleWatch.variables?.id === item.id,
                  } : undefined}
                />
              </li>
            ))}
          </ul>
        )}
        {rows.length > 0 && !preview && (
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
