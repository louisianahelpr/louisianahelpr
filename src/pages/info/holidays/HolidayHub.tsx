/**
 * /holidays, the Louisiana Holiday Hub (owner-approved 2026-11-20; one page 2026-11-21, owner: "put christmas lights and
 * holiday events into 1"). The title (owner 11-22: no intro line under it), then every light display and event in one list, soonest first (owner
 * 2026-11-21: "remove the hire a helpr here", which took out the slim "Hire a Helpr for the holidays" strip she had
 * asked for that morning; /holidays/hire-a-helpr itself stays): "Happening now"
 * (closing soonest first), then one group per start day from today on, then "Dates TBA". Anything over (ended before
 * today, Louisiana time) is hidden.
 *
 * Filters fold away (owner 11-21: "make a filter tab or something so they don't all show as soon as you open it"): one
 * row with the count and two plain icons (owner 11-21 evening: search, and the filter with a count; All / Lights /
 * Events moved into the panel's What), the filter opening the app's one filter
 * presentation (FilterSheet: the slide-up sheet on a phone, the drop-down under the button on the desktop website) with
 * What, When, Region and Cost, "Clear all" and "Show N results". Each filter in effect shows as a removable chip under
 * the row. The filters live in the URL, so a filtered list can be shared, and the old /holidays/lights and
 * /holidays/events land here with theirs (HolidayLegacyRedirect). The lights page's "drive or walk" filter was dropped:
 * it only fit the lights, and each light card still says how you see it.
 * The data (lights.mjs, events.mjs) is imported here only, so it ships in this page's own lazy chunk.
 * Guard: src/test/holidayHub.test.tsx.
 */
import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { FilterSheet, type FilterSheetSection } from "@/components/dashboard/FilterSheet";
import { FilterChip } from "@/components/ui/FilterChip";
import { Input } from "@/components/ui/input";
import { RoundIconButton } from "@/components/ui/RoundIconButton";
import { SearchTriggerSlot } from "@/components/ui/ScreenHeaderRow";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { SBS_WORDS } from "@/content/sbsFeaturedLocal";
import { START_OPEN } from "@/pages/info/giftGuides/startOpen";
import { HOLIDAY_LIGHTS } from "@/content/holidayHub/lights.mjs";
import { HOLIDAY_EVENTS } from "@/content/holidayHub/events.mjs";
import {
  DATES_TBA, HOLIDAY_EVENT_KIND, HOLIDAY_LIGHT_FORMAT, HOLIDAY_REGIONS, HOLIDAY_WHAT, HOLIDAY_WORDS as W,
  endedEarlierToday, filterHolidayItems, holidayCountLabel, holidayWhereLabel, holidayDayHeading, holidayItemsByDay, isHolidayLight, louisianaMinutes, louisianaToday,
  resolveHolidayWhat, type HolidayCostFilter, type HolidayItem, type HolidayRegion, type HolidayWhen,
} from "@/content/holidayHub/holidayHub.mjs";
import { HolidayCard, HolidayNothing, HolidaySection, useHolidayPageView } from "./holidayParts";
import { giftGuides as G } from "@/content/giftGuides";
import { GIFT_GUIDES_CSS } from "../giftGuides/giftGuidesStyles";
import { GuidesFrame } from "../giftGuides/fun/FunPage";

type Option = { value: string; label: string };
const WHAT_OPTIONS: Option[] = [{ value: "all", label: "Everything" }, ...HOLIDAY_WHAT.map((w) => ({ value: w.slug, label: w.label }))];
// Holiday audit 1121 area 5 #20: Today and Next 7 days beside This weekend.
const WHEN_OPTIONS: Option[] = [{ value: "all", label: "All dates" }, { value: "today", label: "Today" }, { value: "weekend", label: "This weekend" }, { value: "week", label: "Next 7 days" }];
const WHEN_NOTHING: Record<string, string> = { weekend: "this weekend", today: "today", week: "in the next 7 days" };
const REGION_OPTIONS: Option[] = [{ value: "all", label: "All regions" }, ...HOLIDAY_REGIONS.map((r) => ({ value: r.slug, label: r.label }))];
// Holiday audit 1121 area 5 #3: items with no cost listed have their own choice (they showed under neither Free nor Paid).
const COST_OPTIONS: Option[] = [{ value: "all", label: "Any" }, { value: "free", label: "Free" }, { value: "paid", label: "Paid" }, { value: "unlisted", label: "Cost not listed" }];

const pick = <T extends string>(v: string | null, allowed: readonly Option[]): T | "all" =>
  v && allowed.some((o) => o.value === v) ? (v as T) : "all";
const labelOf = (options: readonly Option[], value: string) => options.find((o) => o.value === value)?.label ?? value;

/** Day groups more than this many days out fold under "Later dates" (holiday audit 1121 area 5 #5). */
const LATER_AFTER_DAYS = 14;
const addDaysYmd = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The search (owner 2026-11-21): every word typed is in the name, the town, the address or the region. */
function matchesQuery(item: HolidayItem, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [item.name, item.city, item.address, holidayWhereLabel(item)].filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** A light card's tag says it is a light display and how you see it; an event's says its kind. */
function tagFor(item: HolidayItem): string {
  if (isHolidayLight(item)) return item.format ? `Christmas lights · ${HOLIDAY_LIGHT_FORMAT[item.format]}` : "Christmas lights";
  return HOLIDAY_EVENT_KIND[item.category];
}

/** One filter's chips inside the panel, wrapping; one pressed. */
function ChipChoice({ label, options, value, onChange, attr }: {
  label: string;
  options: readonly Option[];
  value: string;
  onChange: (v: string) => void;
  attr: `data-${string}`;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <FilterChip key={o.value} pressed={value === o.value} onClick={() => onChange(o.value)} {...{ [attr]: o.value }}>
          {o.label}
        </FilterChip>
      ))}
    </div>
  );
}

export default function HolidayHub() {
  usePageMeta(PUBLIC_PAGE_META["/holidays"]);
  useHolidayPageView("holidays");
  const [initialParams] = useSearchParams();
  const [params, setParamsState] = useState(() => new URLSearchParams(initialParams));
  // The filters are this page's own state, mirrored into the address bar with history.replaceState (as GiftGuideView
  // does for its sections), never a router navigation: PageTransition keys the page on location.key, so a router
  // setSearchParams remounted the whole page on every chip, which closed the open Filters panel and dropped focus.
  const setParams = (next: URLSearchParams) => {
    setParamsState(next);
    const q = next.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
  };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  // The ✕ or Escape puts the row back and the focus on the magnifier (as the guides' search does).
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    requestAnimationFrame(() => searchButton.current?.focus());
  };
  const filtersButton = useRef<HTMLButtonElement>(null);
  const what = resolveHolidayWhat(params.get("what"), params.get("kind")) ?? "all";
  const when = pick<HolidayWhen>(params.get("when"), WHEN_OPTIONS);
  const region = pick<HolidayRegion>(params.get("region"), REGION_OPTIONS);
  const cost = pick<HolidayCostFilter>(params.get("cost"), COST_OPTIONS);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    // A redirected URL may still carry the old pages' `kind` or `way`: fold `kind` into `what`, drop both.
    next.delete("kind");
    next.delete("way");
    if (what !== "all") next.set("what", what);
    if (value === "all") next.delete(key);
    else next.set(key, value);
    setParams(next);
  };
  const clearAll = () => setParams(new URLSearchParams());
  const today = louisianaToday();
  // Holiday audit 1121 area 5 #10: a one-day item whose simple hours range has closed drops out of "Today".
  const minutes = louisianaMinutes();
  const shown = useMemo(
    () => filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {
      what: what === "all" ? null : what,
      region: region === "all" ? null : region,
      cost: cost === "all" ? null : cost,
      when: when === "all" ? null : when,
    }, today).filter((i) => !endedEarlierToday(i, today, minutes) && matchesQuery(i, query)),
    [what, region, cost, when, today, minutes, query],
  );
  const groups = useMemo(() => holidayItemsByDay(shown, today), [shown, today]);
  // The fold line: two weeks out (Later dates), unless a When filter or a search narrows the list.
  const foldAfter = addDaysYmd(today, LATER_AFTER_DAYS);
  const folds = when === "all" && !query.trim();
  const isLater = (g: (typeof groups)[number]) => folds && (g.key === "tba" || (!!g.day && g.day > foldAfter));
  // Guides polish 1122 #18: the undated light displays (57) sit closed between the next two weeks and "Later dates", so the
  // dated events come first on a phone; a When filter or a search shows them open as before.
  const tbaLights = folds ? groups.find((g) => g.key === "lights-tba") : undefined;
  const soon = groups.filter((g) => !isLater(g) && g !== tbaLights);
  const later = groups.filter(isLater);
  const section = (g: (typeof groups)[number]) => (
    <HolidaySection key={g.key} id={`holidays-${g.key}`} title={g.day ? holidayDayHeading(g.day, today) : g.key === "now" ? "Happening now" : g.key === "lights-tba" ? W.lightsTba : DATES_TBA} count={g.items.length}>
      {g.items.map((i) => <HolidayCard key={i.id} item={i} kind={isHolidayLight(i) ? "light" : "event"} tag={tagFor(i)} />)}
    </HolidaySection>
  );
  // With Free or Paid on, the count line says how many more have no cost listed (#3), so none drop out unsaid.
  const unlisted = useMemo(
    () => (cost === "free" || cost === "paid" ? filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {
      what: what === "all" ? null : what,
      region: region === "all" ? null : region,
      cost: "unlisted",
      when: when === "all" ? null : when,
    }, today).length : 0),
    [what, region, cost, when, today],
  );

  // Every filter in effect, in the panel's order: a removable chip each, and the Filters button's count.
  const active = [
    ...(what !== "all" ? [{ key: "what", label: labelOf(WHAT_OPTIONS, what) }] : []),
    ...(when !== "all" ? [{ key: "when", label: labelOf(WHEN_OPTIONS, when) }] : []),
    ...(region !== "all" ? [{ key: "region", label: labelOf(REGION_OPTIONS, region) }] : []),
    ...(cost !== "all" ? [{ key: "cost", label: labelOf(COST_OPTIONS, cost) }] : []),
  ];
  const sections: FilterSheetSection[] = [
    { key: "what", title: "What", content: <ChipChoice label="What" options={WHAT_OPTIONS} value={what} onChange={(v) => set("what", v)} attr="data-holiday-what" /> },
    { key: "when", title: "When", content: <ChipChoice label="When" options={WHEN_OPTIONS} value={when} onChange={(v) => set("when", v)} attr="data-holiday-when-filter" /> },
    { key: "region", title: "Region", content: <ChipChoice label="Region" options={REGION_OPTIONS} value={region} onChange={(v) => set("region", v)} attr="data-holiday-region" /> },
    { key: "cost", title: "Cost", content: <ChipChoice label="Cost" options={COST_OPTIONS} value={cost} onChange={(v) => set("cost", v)} attr="data-holiday-cost" /> },
  ];

  return (
    // Owner 2026-11-22 #13: the Hub is a page of the guides' menu, so it opens on the guides' one top (GuidesFrame ->
    // GuidesTop: "Holiday gift guides" by the back arrow, the pill and the icons, its green banner) with the guides'
    // menu beside it. No gift search in that row (owner 11-22: one magnifier, the Hub's own); no affiliate link here, so
    // no disclosures.
    <PublicHeaderPage title={W.hubTitle} backTo="/gift-guides" wrapTitle hideHeader bottomPaddingClassName="pb-12 md:pb-16">
      <style>{GIFT_GUIDES_CSS}</style>
      <GuidesFrame title={W.hubTitle} path="/holidays" banner={G.pageBanners["/holidays"]} tools="no-search" disclosures={false}>
      <div className="space-y-section font-sans" data-holiday-page="hub">
        {/* Owner 2026-11-22 (iPhone: "Remove the words above 82 light displays then move that and the and filter and
            search up"): no intro line and no "Shopping too?" link above the count; the count, search and filter sit
            right under the banner (the banner's h1 names the page, and the meta description and the pre-rendered
            page keep the intro for search engines). The guides menu and the back arrow still lead to the guides. */}
        <div className="space-y-2.5" data-holiday-filters="">
          {/* Owner 2026-11-21: "move all lights and events into filter, remove the circle around filter and leave just
              the icons, add a search icon". One row: the count on the left, then two plain icons (no border, no
              words): search, which opens a field over the names, towns and places (Escape closes it), and the
              filter, with how many filters are on. All / Lights / Events is the panel's "What". */}
          {/* Owner 2026-11-22 (pop-up, a desktop screenshot: the open "Name or town" box pushed the count to its own
              line): "keep count on row". Open, the count stays at the left of this row and the soft field (the guides'
              own, 16px words) takes the room to its right, up to 360px from 768px up, with its ✕; the filter stays at
              the far right. Where the row is too narrow for the words and a usable field (under 440px: every phone),
              the count shows as its number only (the words stay for screen readers). The ✕ or Escape puts the row back. */}
          <div className="flex min-h-11 items-center gap-1" data-holiday-searchrow={searchOpen ? "open" : "closed"}>
            <p className={`${searchOpen ? "hh-count-open" : "min-w-0 flex-1"} text-ds-14 text-muted-foreground`} aria-live="polite" data-holiday-count="">
              {searchOpen ? (
                <><span className="hh-count-full">{shown.length ? holidayCountLabel(shown) : ""}{unlisted > 0 && <span data-holiday-unlisted="">{` · plus ${unlisted} with no cost listed`}</span>}</span><span className="hh-count-short" aria-hidden="true">{shown.length || ""}</span></>
              ) : (
                <>{shown.length ? holidayCountLabel(shown) : ""}{unlisted > 0 && <span data-holiday-unlisted="">{` · plus ${unlisted} with no cost listed`}</span>}</>
              )}
            </p>
            {searchOpen && (
              <label className="hh-search gg-search rounded-xl focus-within:ring-2 focus-within:ring-[hsl(var(--bark)/0.22)]" data-holiday-search-box="">
                <Search width={15} height={15} aria-hidden />
                <Input look="bare" ref={searchInput} type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
                  onKeyDown={(e) => { if (e.key === "Escape") closeSearch(); }}
                  placeholder="Name or town" aria-label="Search lights and events by name, town or place" data-holiday-search="" />
                <RoundIconButton className="gg-search-close" onClick={closeSearch} aria-label="Close search" data-holiday-search-close="">
                  <X className="h-5 w-5" aria-hidden />
                </RoundIconButton>
              </label>
            )}
            {/* Open, the magnifier's place stays held (SearchTriggerSlot) so the field's ✕ never lands under the finger
                that opened it (src/test/searchDismissAndOverlay.test.tsx). */}
            {searchOpen && <SearchTriggerSlot />}
            {/* Owner 2026-11-22 ("some icons have a circle background some are squared looking. they should all be
                consistent"): the search and filter are the guides' toolbar icon (gg-icon), a 44px circle fill on a
                desktop hover only, and the same focus ring, never the square ghost fill. */}
            {!searchOpen && (
              <RoundIconButton ref={searchButton} className="gg-icon" aria-label="Search lights and events" aria-expanded={false} onClick={() => setSearchOpen(true)} data-holiday-search-button="">
                <Search className="h-5 w-5" aria-hidden />
              </RoundIconButton>
            )}
            <RoundIconButton ref={filtersButton} className="gg-icon" data-holiday-filters-button=""
              onClick={() => setFiltersOpen(true)} aria-haspopup="dialog" aria-expanded={filtersOpen}
              aria-label={active.length ? `Filters, ${active.length} on` : "Filters"}>
              <SlidersHorizontal className="h-5 w-5" aria-hidden />
              {active.length > 0 && (
                <span data-holiday-filter-count="" className="gg-icon-count" aria-hidden="true">{active.length}</span>
              )}
            </RoundIconButton>
          </div>
          {active.length > 0 && (
            <ul aria-label="Filters on" className="flex flex-wrap gap-2" data-holiday-active="">
              {active.map((f) => (
                <li key={f.key}>
                  <FilterChip size="tight" onClick={() => set(f.key, "all")} aria-label={`Remove filter: ${f.label}`} data-holiday-active-chip={f.key}>
                    {f.label}<X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  </FilterChip>
                </li>
              ))}
            </ul>
          )}
        </div>
        <FilterSheet open={filtersOpen} onOpenChange={setFiltersOpen} sections={sections} activeFilterCount={active.length}
          onClearAll={clearAll} title="Filters" resultCount={shown.length} resultNoun={["result", "results"]} anchorRef={filtersButton} />

        {groups.length === 0 ? (
          // Polish audit 1122 #29: a search with no match says so and clears the search, not "these filters".
          query.trim() && active.length === 0 ? (
            <HolidayNothing onClear={() => setQuery("")} clearLabel="Clear search">
              {`No lights or events match "${query.trim()}".`}
            </HolidayNothing>
          ) : (
            <HolidayNothing onClear={clearAll}>
              {when !== "all" ? `Nothing matches these filters ${WHEN_NOTHING[when]}.` : "Nothing matches these filters."}
            </HolidayNothing>
          )
        ) : (
          <>
            {soon.map(section)}
            {/* Holiday audit 1121 area 5 #5: the days more than two weeks out and "Dates TBA" fold under one "Later dates".
                Owner 2026-11-22 ("make everything open expanded"): both folds start open (START_OPEN); a shopper can
                still close one. A When filter or a search shows every group open. */}
            {tbaLights && (
              <details className="group space-y-section" id="holidays-lights-tba" open={START_OPEN} data-holiday-lights-tba="">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-ds-20 font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                  {W.lightsTba}<span className="text-ds-15 font-normal text-muted-foreground">({tbaLights.items.length})</span>
                  <ChevronDown className="h-5 w-5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <p className="text-ds-14 text-muted-foreground">{W.lightsTbaNote}</p>
                <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {tbaLights.items.map((i) => <HolidayCard key={i.id} item={i} kind="light" tag={tagFor(i)} />)}
                </ul>
              </details>
            )}
            {later.length > 0 && (
              <details className="group space-y-section" open={START_OPEN} data-holiday-later="">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-ds-20 font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                  Later dates<span className="text-ds-15 font-normal text-muted-foreground">({later.reduce((n, g) => n + g.items.length, 0)})</span>
                  <ChevronDown className="h-5 w-5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="space-y-section">{later.map(section)}</div>
              </details>
            )}
          </>
        )}
        <p className="text-ds-14 text-muted-foreground">{W.checkFirst}</p>
        {/* Owner 2026-11-21: Louisiana small businesses ask to be featured free on the Small Business Saturday page. */}
        <p className="text-ds-14 text-muted-foreground" data-holiday-shop-small="">
          <Link to="/gift-guides/small-business-saturday#get-featured" className="link-standard inline-flex min-h-11 items-center">{SBS_WORDS.landingLink}</Link>
        </p>
      </div>
      </GuidesFrame>
    </PublicHeaderPage>
  );
}
