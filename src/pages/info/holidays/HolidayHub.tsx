/**
 * /holidays, the Louisiana Holiday Hub (owner-approved 2026-11-20; one page 2026-11-21, owner: "put christmas lights and
 * holiday events into 1 and a small strip with hire a helpr for the holidays at the top"). The title, one line, a slim
 * "Hire a Helpr for the holidays" strip, then every light display and event in one list, soonest first: "Happening now"
 * (closing soonest first), then one group per start day from today on, then "Dates TBA". Anything over (ended before
 * today, Louisiana time) is hidden.
 *
 * Filters fold away (owner 11-21: "make a filter tab or something so they don't all show as soon as you open it"): one
 * row with a quick All / Lights / Events choice and a "Filters" button with a count, which opens the app's one filter
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
import { SlidersHorizontal, X } from "lucide-react";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { FilterSheet, type FilterSheetSection } from "@/components/dashboard/FilterSheet";
import { FilterChip } from "@/components/ui/FilterChip";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { SBS_WORDS } from "@/content/sbsFeaturedLocal";
import { HOLIDAY_LIGHTS } from "@/content/holidayHub/lights.mjs";
import { HOLIDAY_EVENTS } from "@/content/holidayHub/events.mjs";
import {
  DATES_TBA, HOLIDAY_EVENT_KIND, HOLIDAY_HIRE_PATH, HOLIDAY_LIGHT_FORMAT, HOLIDAY_REGIONS, HOLIDAY_WHAT, HOLIDAY_WORDS as W,
  endedEarlierToday, filterHolidayItems, holidayCountLabel, holidayDayHeading, holidayItemsByDay, isHolidayLight, louisianaMinutes, louisianaToday,
  resolveHolidayWhat, type HolidayCostFilter, type HolidayItem, type HolidayRegion,
} from "@/content/holidayHub/holidayHub.mjs";
import { HUB_COLUMN, HUB_HEADER_COLUMN, HolidayCard, HolidayNothing, HolidaySection, useHolidayPageView } from "./holidayParts";

type Option = { value: string; label: string };
const WHAT_OPTIONS: Option[] = [{ value: "all", label: "Everything" }, ...HOLIDAY_WHAT.map((w) => ({ value: w.slug, label: w.label }))];
const WHEN_OPTIONS: Option[] = [{ value: "all", label: "All dates" }, { value: "weekend", label: "This weekend" }];
const REGION_OPTIONS: Option[] = [{ value: "all", label: "All regions" }, ...HOLIDAY_REGIONS.map((r) => ({ value: r.slug, label: r.label }))];
// Holiday audit 1121 area 5 #3: items with no cost listed have their own choice (they showed under neither Free nor Paid).
const COST_OPTIONS: Option[] = [{ value: "all", label: "Any" }, { value: "free", label: "Free" }, { value: "paid", label: "Paid" }, { value: "unlisted", label: "Cost not listed" }];
/** The quick choice on the row: "Events" covers every kind of event (a single kind shows as its own chip below). */
const QUICK_OPTIONS = [{ value: "all", label: "All" }, { value: "lights", label: "Lights" }, { value: "events", label: "Events" }] as const;

const pick = <T extends string>(v: string | null, allowed: readonly Option[]): T | "all" =>
  v && allowed.some((o) => o.value === v) ? (v as T) : "all";
const labelOf = (options: readonly Option[], value: string) => options.find((o) => o.value === value)?.label ?? value;

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
  const filtersButton = useRef<HTMLButtonElement>(null);
  const what = resolveHolidayWhat(params.get("what"), params.get("kind")) ?? "all";
  const when = pick<"weekend">(params.get("when"), WHEN_OPTIONS);
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
      weekend: when === "weekend",
    }, today).filter((i) => !endedEarlierToday(i, today, minutes)),
    [what, region, cost, when, today, minutes],
  );
  const groups = useMemo(() => holidayItemsByDay(shown, today), [shown, today]);
  // With Free or Paid on, the count line says how many more have no cost listed (#3), so none drop out unsaid.
  const unlisted = useMemo(
    () => (cost === "free" || cost === "paid" ? filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {
      what: what === "all" ? null : what,
      region: region === "all" ? null : region,
      cost: "unlisted",
      weekend: when === "weekend",
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
  const quick = what === "all" || what === "lights" ? what : "events";
  const sections: FilterSheetSection[] = [
    { key: "what", title: "What", content: <ChipChoice label="What" options={WHAT_OPTIONS} value={what} onChange={(v) => set("what", v)} attr="data-holiday-what" /> },
    { key: "when", title: "When", content: <ChipChoice label="When" options={WHEN_OPTIONS} value={when} onChange={(v) => set("when", v)} attr="data-holiday-when-filter" /> },
    { key: "region", title: "Region", content: <ChipChoice label="Region" options={REGION_OPTIONS} value={region} onChange={(v) => set("region", v)} attr="data-holiday-region" /> },
    { key: "cost", title: "Cost", content: <ChipChoice label="Cost" options={COST_OPTIONS} value={cost} onChange={(v) => set("cost", v)} attr="data-holiday-cost" /> },
  ];

  return (
    <PublicHeaderPage title={W.hubTitle} backTo="/" wrapTitle bottomPaddingClassName="pb-12 md:pb-16" headerWrapperClassName={HUB_HEADER_COLUMN}>
      <div className={`${HUB_COLUMN} space-y-section font-sans`} data-holiday-page="hub">
        <div className="space-y-4">
          <p className="max-w-[68ch] text-ds-17 text-foreground">{W.hubIntro}</p>
          {/* The slim strip (owner 11-21): one line from sm up, two on a phone (title and chevron, then the line). The
              whole strip is the link; the antique-gold edge is the 25 Days palette's, as the old hub cards had. */}
          <aside aria-label={W.stripTitle} data-holiday-hire-strip="">
            <Link to={HOLIDAY_HIRE_PATH} data-holiday-hire-link=""
              className="group flex min-h-11 flex-wrap items-baseline gap-x-3 rounded-[14px] border border-border border-l-[3px] bg-[hsl(var(--card))] px-3.5 py-2 text-ds-13 text-foreground no-underline transition-colors ctl-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:px-4 sm:py-2.5 sm:text-ds-14"
              style={{ borderLeftColor: "#b08d57" }}>
              <span className="font-semibold">{W.stripTitle}</span>
              <span className="order-last basis-full text-muted-foreground sm:order-none sm:basis-auto">{W.stripLine}</span>
              <span className="ml-auto font-semibold text-[hsl(var(--olivewood))]" aria-hidden="true">
                <span className="hidden sm:inline">{W.stripCta} </span>›
              </span>
            </Link>
          </aside>
        </div>

        <div className="space-y-2.5" data-holiday-filters="">
          {/* One row: the quick choice on the left, Filters on the right (the desktop drop-down opens under it). */}
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Show" className="flex min-w-0 gap-2">
              {QUICK_OPTIONS.map((o) => (
                <FilterChip key={o.value} size="tight" pressed={quick === o.value} onClick={() => set("what", o.value)} data-holiday-quick={o.value}>
                  {o.label}
                </FilterChip>
              ))}
            </div>
            <Button ref={filtersButton} type="button" variant="outline" size="sm" data-holiday-filters-button=""
              onClick={() => setFiltersOpen(true)} aria-haspopup="dialog" aria-expanded={filtersOpen}
              aria-label={active.length ? `Filters, ${active.length} on` : "Filters"}
              className={`ml-auto shrink-0 gap-1.5 rounded-full ${active.length ? "border-[hsl(var(--bark)/0.45)] text-[hsl(var(--bark))]" : ""}`}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              Filters{active.length > 0 && <span data-holiday-filter-count="">{`· ${active.length}`}</span>}
            </Button>
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

        {/* The count line; with nothing to count, the empty card below says so instead. */}
        <p className="text-ds-14 text-muted-foreground" aria-live="polite" data-holiday-count="">{shown.length ? holidayCountLabel(shown) : ""}{unlisted > 0 && <span data-holiday-unlisted="">{` · plus ${unlisted} with no cost listed`}</span>}</p>
        {groups.length === 0 ? (
          <HolidayNothing onClear={clearAll}>
            {when === "weekend" ? "Nothing matches these filters this weekend." : "Nothing matches these filters."}
          </HolidayNothing>
        ) : (
          groups.map((g) => (
            <HolidaySection key={g.key} id={`holidays-${g.key}`} title={g.day ? holidayDayHeading(g.day, today) : g.key === "now" ? "Happening now" : g.key === "lights-tba" ? W.lightsTba : DATES_TBA} count={g.items.length}>
              {g.items.map((i) => <HolidayCard key={i.id} item={i} kind={isHolidayLight(i) ? "light" : "event"} tag={tagFor(i)} />)}
            </HolidaySection>
          ))
        )}
        <p className="text-ds-14 text-muted-foreground">{W.checkFirst}</p>
        <p className="text-ds-14 text-muted-foreground">
          Shopping too? <Link to="/gift-guides" className="link-standard inline-flex min-h-11 items-center">See the holiday gift guides</Link>
        </p>
        {/* Owner 2026-11-21: Louisiana small businesses ask to be featured free on /shop-small. */}
        <p className="text-ds-14 text-muted-foreground" data-holiday-shop-small="">
          <Link to="/shop-small" className="link-standard inline-flex min-h-11 items-center">{SBS_WORDS.landingLink}</Link>
        </p>
      </div>
    </PublicHeaderPage>
  );
}
