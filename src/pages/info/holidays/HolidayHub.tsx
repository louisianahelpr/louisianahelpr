/**
 * /holidays, the Louisiana Holiday Hub (owner-approved 2026-11-20; one page 2026-11-21, owner: "put christmas lights and
 * holiday events into 1"). The title (owner 11-22: no intro line under it), then every light display and event in one list, soonest first (owner
 * 2026-11-21: "remove the hire a helpr here", which took out the slim "Hire a Helpr for the holidays" strip she had
 * asked for that morning; /holidays/hire-a-helpr itself stays). Owner 2026-11-22 "Pick a day": a row of day chips
 * (Today first) and, below it, everything happening on the chosen day, then the undated light displays and "Dates TBA";
 * a search lists every match across the season ("Happening now", then one group per start day, then the undated ones).
 * Anything over (ended before today, Louisiana time) is hidden.
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
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { FilterSheet, type FilterSheetSection } from "@/components/dashboard/FilterSheet";
import { FilterChip } from "@/components/ui/FilterChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RoundIconButton } from "@/components/ui/RoundIconButton";
import { SearchTriggerSlot } from "@/components/ui/ScreenHeaderRow";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { SBS_WORDS } from "@/content/sbsFeaturedLocal";
import { HOLIDAY_LIGHTS } from "@/content/holidayHub/lights.mjs";
import { HOLIDAY_EVENTS } from "@/content/holidayHub/events.mjs";
import {
  HOLIDAY_EVENT_KIND, HOLIDAY_LIGHT_FORMAT, HOLIDAY_REGIONS, HOLIDAY_WHAT, HOLIDAY_WORDS as W,
  endedEarlierToday, filterHolidayItems, holidayCountLabel, holidayDayChipLabel, holidayDayChoices, holidayWhereLabel, holidayDayHeading, holidayItemsByDay, holidayItemsOn, isHolidayLight, louisianaMinutes, louisianaToday,
  resolveHolidayWhat, type HolidayCostFilter, type HolidayItem, type HolidayRegion, type HolidayWhen,
} from "@/content/holidayHub/holidayHub.mjs";
import { HolidayCard, HolidayNothing, HolidaySection, HolidayUndatedRow, useHolidayPageView } from "./holidayParts";
import { giftGuides as G } from "@/content/giftGuides";
import { GIFT_GUIDES_CSS } from "../giftGuides/giftGuidesStyles";
import { GuidesFrame } from "../giftGuides/fun/FunPage";
import { LazyGuideQa } from "../giftGuides/LazyGuideQa";

type Option = { value: string; label: string };
const WHAT_OPTIONS: Option[] = [{ value: "all", label: "Everything" }, ...HOLIDAY_WHAT.map((w) => ({ value: w.slug, label: w.label }))];
// Holiday audit 1121 area 5 #20: Today and Next 7 days beside This weekend.
const WHEN_OPTIONS: Option[] = [{ value: "all", label: "All dates" }, { value: "today", label: "Today" }, { value: "weekend", label: "This weekend" }, { value: "week", label: "Next 7 days" }];
const WHEN_NOTHING: Record<string, string> = { weekend: "this weekend", today: "today", week: "in the next 7 days" };
// The closing "Get featured free" link: the question, then "Get featured free ›" that never splits.
const [SHOP_SMALL_ASK, SHOP_SMALL_GO] = SBS_WORDS.landingLink.split("? ");
const REGION_OPTIONS: Option[] = [{ value: "all", label: "All regions" }, ...HOLIDAY_REGIONS.map((r) => ({ value: r.slug, label: r.label }))];
// Holiday audit 1121 area 5 #3: items with no cost listed have their own choice (they showed under neither Free nor Paid).
const COST_OPTIONS: Option[] = [{ value: "all", label: "Any" }, { value: "free", label: "Free" }, { value: "paid", label: "Paid" }, { value: "unlisted", label: "Cost not listed" }];

const pick = <T extends string>(v: string | null, allowed: readonly Option[]): T | "all" =>
  v && allowed.some((o) => o.value === v) ? (v as T) : "all";
const labelOf = (options: readonly Option[], value: string) => options.find((o) => o.value === value)?.label ?? value;

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
  const filtered = useMemo(
    () => filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {
      what: what === "all" ? null : what,
      region: region === "all" ? null : region,
      cost: cost === "all" ? null : cost,
      when: when === "all" ? null : when,
    }, today).filter((i) => !endedEarlierToday(i, today, minutes)),
    [what, region, cost, when, today, minutes],
  );
  const shown = useMemo(() => filtered.filter((i) => matchesQuery(i, query)), [filtered, query]);
  // Owner 2026-11-22 7:46 PM ("organize these better so you can see the ones that are happening each day below"; her
  // pop-up choice "Pick a day"): a row of day chips, Today first, then every day through the last dated day; the list
  // below shows everything happening on the chosen day (one-day events that date, multi-day events and light displays
  // whose dates cover it), then the undated light displays and "Dates TBA" in their own open sections. Today (Louisiana
  // time) is chosen on arrival; the chosen day is in the URL (?day=YYYY-MM-DD, none for today). A When filter narrows the
  // chips to its days (Today: one chip; This weekend: Friday to Sunday; Next 7 days: seven) and the chosen day moves
  // into them. A search looks across every date: while one is typed the list is every match, soonest first, grouped by
  // day (no chip pressed); tapping a day ends the search and shows that day.
  const searching = query.trim().length > 0;
  const days = useMemo(() => holidayDayChoices(filtered, today, when === "all" ? null : when), [filtered, today, when]);
  const asked = params.get("day");
  const day = asked && days.includes(asked) ? asked : days[0] ?? null;
  const onDay = useMemo(() => (day ? holidayItemsOn(filtered, day) : []), [filtered, day]);
  const groups = useMemo(() => holidayItemsByDay(shown, today), [shown, today]);
  // Polish audit 11-27 #15: "Light displays, dates not announced" and "Dates TBA" meant the same thing (two sections,
  // ~15,000px of cards each saying "Dates TBA"). One section, "Dates not announced yet", of two-line rows; still open.
  const undatedItems = groups.filter((g) => g.key === "lights-tba" || g.key === "tba").flatMap((g) => g.items);
  const undated = undatedItems.length ? [{ key: "undated", day: null, items: undatedItems }] : [];
  const section = (g: (typeof groups)[number]) => g.key === "undated" ? (
    <HolidaySection key="undated" id="holidays-undated" title={W.undated} count={g.items.length} note={W.undatedNote} rows data={{ "data-holiday-undated-section": "" }}>
      {g.items.map((i) => <HolidayUndatedRow key={i.id} item={i} kind={isHolidayLight(i) ? "light" : "event"} />)}
    </HolidaySection>
  ) : (
    <HolidaySection key={g.key} id={`holidays-${g.key}`} title={g.day ? holidayDayHeading(g.day, today) : "Happening now"}
      count={g.items.length}>
      {g.items.map((i) => <HolidayCard key={i.id} item={i} kind={isHolidayLight(i) ? "light" : "event"} tag={tagFor(i)} />)}
    </HolidaySection>
  );
  const pickDay = (d: string) => {
    if (searching || searchOpen) {
      setQuery("");
      setSearchOpen(false);
    }
    set("day", d === today ? "all" : d);
  };
  // The chosen chip scrolls into the row's view (a shared ?day= link far down the season), the page itself never moves.
  const dayRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = dayRow.current;
    const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !chip) return;
    if (chip.offsetLeft < row.scrollLeft || chip.offsetLeft + chip.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = chip.offsetLeft - 16;
  }, [day, searching]);
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
  // The count's words, drawn once: the row's left when closed, and (open) the words a wide row shows beside the field.
  const countWords = <>{shown.length ? holidayCountLabel(shown) : ""}{unlisted > 0 && <span data-holiday-unlisted="">{` · plus ${unlisted} with no cost listed`}</span>}</>;

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
    // GuidesTop: "Holiday gift guides" by the back arrow, its green banner) with the guides' menu beside it. The row's
    // right side is Share alone (tools="share"): no gift search (owner 11-22: one magnifier, the Hub's own), and no
    // shipping pill or My list heart (owner 11-22 7:49 PM: "remove order by and the heart at the top ... i thought we
    // didnt do that for this section?"). No affiliate link here, so the frame shows no disclosures (GuidesDisclosure).
    <PublicHeaderPage title={W.hubTitle} backTo="/gift-guides" wrapTitle hideHeader bottomPaddingClassName="pb-12 md:pb-16">
      <style>{GIFT_GUIDES_CSS}</style>
      <GuidesFrame title={W.hubTitle} path="/holidays" banner={G.pageBanners["/holidays"]} tools="share">
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
            {/* Consistency audit 1122 #3: the guides' count style ("146 gifts": gg-itemcount, 12px/600, muted). */}
            <p className={`${searchOpen ? "hh-count-open" : "min-w-0 flex-1"} gg-itemcount !m-0`} aria-live="polite" data-holiday-count="">
              {searchOpen ? (
                <><span className="hh-count-full">{countWords}</span><span className="hh-count-short" aria-hidden="true">{shown.length || ""}</span></>
              ) : countWords}
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
              aria-label={active.length ? G.filterLabelActive(active.length) : G.filterLabel}>
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

        {days.length > 0 && (
          // One row, sideways scroll on a phone (and a thin bar to drag on a mouse screen); 44px chips in the guides'
          // chip look (gg-chip: filled when chosen, outlined otherwise, as the For Her people chips).
          <div ref={dayRow} role="group" aria-label="Pick a day" className="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]" data-holiday-days="">
            {days.map((d) => {
              const on = !searching && d === day;
              return (
                <Button key={d} type="button" variant={on ? "default" : "outline"} size="sm" className="gg-chip shrink-0" aria-pressed={on}
                  onClick={() => pickDay(d)} data-holiday-day={d}>
                  {holidayDayChipLabel(d, today)}
                </Button>
              );
            })}
          </div>
        )}
        {searching ? (
          groups.length === 0 ? (
            // Polish audit 1122 #29: a search with no match says so and clears the search, not "these filters".
            active.length === 0 ? (
              <HolidayNothing onClear={() => setQuery("")} clearLabel="Clear search">
                {`No lights or events match "${query.trim()}".`}
              </HolidayNothing>
            ) : (
              <HolidayNothing onClear={clearAll}>Nothing matches these filters.</HolidayNothing>
            )
          ) : [...groups.filter((g) => g.key !== "lights-tba" && g.key !== "tba"), ...undated].map(section)
        ) : filtered.length === 0 ? (
          <HolidayNothing onClear={clearAll}>
            {when !== "all" ? `Nothing matches these filters ${WHEN_NOTHING[when]}.` : "Nothing matches these filters."}
          </HolidayNothing>
        ) : (
          <>
            {day && (
              <HolidaySection key={day} id="holidays-day" title={holidayDayHeading(day, today)} count={onDay.length} data={{ "data-holiday-day-list": day }}>
                {onDay.length ? onDay.map((i) => <HolidayCard key={i.id} item={i} kind={isHolidayLight(i) ? "light" : "event"} tag={tagFor(i)} />)
                  : <li className="text-ds-14 text-muted-foreground" data-holiday-day-empty="">Nothing listed for this day. Try another day.</li>}
              </HolidaySection>
            )}
            {/* Everything with no 2026 date yet stays reachable under the day, in one open band (polish audit 11-27 #15). */}
            {undated.map(section)}
          </>
        )}
        <p className="text-ds-14 text-muted-foreground">{W.checkFirst}</p>
        {/* Owner 2026-11-21: Louisiana small businesses ask to be featured free on the Small Business Saturday page.
            Visual audit 1122-night #7: it read as plain grey text; it wears the guides' text-link look (olive, semibold,
            "›", as on Small Business Saturday), "Get featured free ›" kept whole on its line. */}
        <p className="text-ds-14 text-muted-foreground" data-holiday-shop-small="">
          <Link to="/gift-guides/small-business-saturday#get-featured" className="link-standard inline-flex min-h-11 flex-wrap items-center gap-x-1 font-semibold text-[hsl(var(--bark))]">
            {SHOP_SMALL_GO ? <><span>{SHOP_SMALL_ASK}?</span><span className="whitespace-nowrap">{SHOP_SMALL_GO}&nbsp;›</span></> : <>{SBS_WORDS.landingLink}&nbsp;›</>}
          </Link>
        </p>
        {/* Owner pop-up 11-22 9:40 PM: common questions answered from the lights and events, the Updated day, who made it. */}
        <LazyGuideQa kind="holidays" page="holidays" />
      </div>
      </GuidesFrame>
    </PublicHeaderPage>
  );
}
