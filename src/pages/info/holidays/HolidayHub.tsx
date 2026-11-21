/**
 * /holidays, the Louisiana Holiday Hub (owner-approved 2026-11-20; one page 2026-11-21, owner: "put christmas lights and
 * holiday events into 1 and a small strip with hire a helpr for the holidays at the top"). The title, one line, a slim
 * "Hire a Helpr for the holidays" strip, then every light display and event in one list with one set of filters: what
 * (Christmas lights, all events, or one kind of event), when (all dates or this weekend), region, and cost. The list
 * runs "Happening now", then by date, then "Dates TBA". The filters live in the URL, so a filtered list can be shared,
 * and the old /holidays/lights and /holidays/events land here with theirs (HolidayLegacyRedirect). The lights page's
 * "drive or walk" filter was dropped: it only fit the lights, and each light card still says how you see it.
 * The data (lights.mjs, events.mjs) is imported here only, so it ships in this page's own lazy chunk.
 * Guard: src/test/holidayHub.test.tsx.
 */
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { HOLIDAY_LIGHTS } from "@/content/holidayHub/lights.mjs";
import { HOLIDAY_EVENTS } from "@/content/holidayHub/events.mjs";
import {
  DATES_TBA, HOLIDAY_EVENT_KIND, HOLIDAY_HIRE_PATH, HOLIDAY_LIGHT_FORMAT, HOLIDAY_REGIONS, HOLIDAY_WHAT, HOLIDAY_WORDS as W,
  filterHolidayItems, holidayCountLabel, holidayDayHeading, holidayItemsByDay, isHolidayLight, louisianaToday,
  resolveHolidayWhat, type HolidayCost, type HolidayItem, type HolidayRegion,
} from "@/content/holidayHub/holidayHub.mjs";
import { HUB_COLUMN, HUB_HEADER_COLUMN, HolidayCard, HolidayFilterRow, HolidayNothing, HolidaySection, useHolidayPageView } from "./holidayParts";

const WHAT_OPTIONS = [{ value: "all", label: "Everything" }, ...HOLIDAY_WHAT.map((w) => ({ value: w.slug, label: w.label }))] as const;
const WHEN_OPTIONS = [{ value: "all", label: "All dates" }, { value: "weekend", label: "This weekend" }] as const;
const REGION_OPTIONS = [{ value: "all", label: "All regions" }, ...HOLIDAY_REGIONS.map((r) => ({ value: r.slug, label: r.label }))] as const;
const COST_OPTIONS = [{ value: "all", label: "Any" }, { value: "free", label: "Free" }, { value: "paid", label: "Paid" }] as const;

const pick = <T extends string>(v: string | null, allowed: readonly { value: string }[]): T | "all" =>
  v && allowed.some((o) => o.value === v) ? (v as T) : "all";

/** A light card's tag says it is a light display and how you see it; an event's says its kind. */
function tagFor(item: HolidayItem): string {
  if (isHolidayLight(item)) return item.format ? `Christmas lights · ${HOLIDAY_LIGHT_FORMAT[item.format]}` : "Christmas lights";
  return HOLIDAY_EVENT_KIND[item.category];
}

export default function HolidayHub() {
  usePageMeta(PUBLIC_PAGE_META["/holidays"]);
  useHolidayPageView("holidays");
  const [params, setParams] = useSearchParams();
  const what = resolveHolidayWhat(params.get("what"), params.get("kind")) ?? "all";
  const when = pick<"weekend">(params.get("when"), WHEN_OPTIONS);
  const region = pick<HolidayRegion>(params.get("region"), REGION_OPTIONS);
  const cost = pick<HolidayCost>(params.get("cost"), COST_OPTIONS);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    // A redirected URL may still carry the old pages' `kind` or `way`: fold `kind` into `what`, drop both.
    next.delete("kind");
    next.delete("way");
    if (what !== "all") next.set("what", what);
    if (value === "all") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const today = louisianaToday();
  const shown = useMemo(
    () => filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {
      what: what === "all" ? null : what,
      region: region === "all" ? null : region,
      cost: cost === "all" ? null : cost,
      weekend: when === "weekend",
    }, today),
    [what, region, cost, when, today],
  );
  const groups = useMemo(() => holidayItemsByDay(shown, today), [shown, today]);
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
        <div className="space-y-3" data-holiday-filters="">
          <HolidayFilterRow label="What" options={WHAT_OPTIONS} value={what} onChange={(v) => set("what", v)} attr="data-holiday-what" />
          <HolidayFilterRow label="Region" options={REGION_OPTIONS} value={region} onChange={(v) => set("region", v)} attr="data-holiday-region" />
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <HolidayFilterRow label="When" options={WHEN_OPTIONS} value={when} onChange={(v) => set("when", v)} attr="data-holiday-when-filter" />
            <HolidayFilterRow label="Cost" options={COST_OPTIONS} value={cost} onChange={(v) => set("cost", v)} attr="data-holiday-cost" />
          </div>
        </div>
        {/* The count line; with nothing to count, the empty card below says so instead. */}
        <p className="text-ds-14 text-muted-foreground" aria-live="polite" data-holiday-count="">{shown.length ? holidayCountLabel(shown) : ""}</p>
        {groups.length === 0 ? (
          <HolidayNothing onClear={() => setParams(new URLSearchParams(), { replace: true })}>
            {when === "weekend" ? "Nothing matches these filters this weekend." : "Nothing matches these filters."}
          </HolidayNothing>
        ) : (
          groups.map((g) => (
            <HolidaySection key={g.key} id={`holidays-${g.key}`} title={g.day ? holidayDayHeading(g.day, today) : g.key === "now" ? "Happening now" : DATES_TBA} count={g.items.length}>
              {g.items.map((i) => <HolidayCard key={i.id} item={i} kind={isHolidayLight(i) ? "light" : "event"} tag={tagFor(i)} />)}
            </HolidaySection>
          ))
        )}
        <p className="text-ds-14 text-muted-foreground">{W.checkFirst}</p>
        <p className="text-ds-14 text-muted-foreground">
          Shopping too? <Link to="/gift-guides" className="link-standard">See the holiday gift guides</Link>.
        </p>
      </div>
    </PublicHeaderPage>
  );
}
