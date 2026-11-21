/**
 * /holidays/events (Louisiana Holiday Hub, owner-approved 2026-11-20): every holiday event by date ("Happening now",
 * then one group per day, then "Dates TBA"), filtered by kind (parades, boat parades, markets, Santa, tree lightings,
 * bonfires, Réveillon, concerts...), by region, and "This weekend" (Friday to Sunday, Louisiana time). Filters live in the
 * URL. The data (events.mjs) is imported here only, so it ships in this page's own lazy chunk.
 * Guard: src/test/holidayHub.test.tsx.
 */
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { HOLIDAY_EVENTS } from "@/content/holidayHub/events.mjs";
import {
  DATES_TBA, HOLIDAY_EVENT_CATEGORIES, HOLIDAY_EVENT_KIND, HOLIDAY_HIRE_PATH, HOLIDAY_HUB_PATH, HOLIDAY_LIGHTS_PATH, HOLIDAY_REGIONS,
  HOLIDAY_WORDS as W, eventsByDay, filterEvents, holidayDayHeading, louisianaToday, type HolidayEventCategory, type HolidayRegion,
} from "@/content/holidayHub/holidayHub.mjs";
import { HUB_COLUMN, HUB_HEADER_COLUMN, HolidayCard, HolidayFilterRow, HolidayNothing, HolidaySection, useHolidayPageView } from "./holidayParts";

const WHEN_OPTIONS = [{ value: "all", label: "All dates" }, { value: "weekend", label: "This weekend" }] as const;
const KIND_OPTIONS = [{ value: "all", label: "Everything" }, ...HOLIDAY_EVENT_CATEGORIES.map((c) => ({ value: c.slug, label: c.label }))] as const;
const REGION_OPTIONS = [{ value: "all", label: "All regions" }, ...HOLIDAY_REGIONS.map((r) => ({ value: r.slug, label: r.label }))] as const;

const pick = <T extends string>(v: string | null, allowed: readonly { value: string }[]): T | "all" =>
  v && allowed.some((o) => o.value === v) ? (v as T) : "all";

export default function HolidayEvents() {
  usePageMeta(PUBLIC_PAGE_META["/holidays/events"]);
  useHolidayPageView("holidays_events");
  const [params, setParams] = useSearchParams();
  const when = pick<"weekend">(params.get("when"), WHEN_OPTIONS);
  const kind = pick<HolidayEventCategory>(params.get("kind"), KIND_OPTIONS);
  const region = pick<HolidayRegion>(params.get("region"), REGION_OPTIONS);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const today = louisianaToday();
  const groups = useMemo(
    () => eventsByDay(filterEvents(HOLIDAY_EVENTS, { region: region === "all" ? null : region, category: kind === "all" ? null : kind, weekend: when === "weekend" }, today), today),
    [region, kind, when, today],
  );
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <PublicHeaderPage title={W.eventsTitle} backTo={HOLIDAY_HUB_PATH} wrapTitle bottomPaddingClassName="pb-12 md:pb-16" headerWrapperClassName={HUB_HEADER_COLUMN}>
      <div className={`${HUB_COLUMN} space-y-section font-sans`} data-holiday-page="events">
        <p className="max-w-[68ch] text-ds-15 text-muted-foreground">{W.eventsIntro}</p>
        <div className="space-y-3" data-holiday-filters="">
          <HolidayFilterRow label="When" options={WHEN_OPTIONS} value={when} onChange={(v) => set("when", v)} attr="data-holiday-when-filter" />
          <HolidayFilterRow label="What" options={KIND_OPTIONS} value={kind} onChange={(v) => set("kind", v)} attr="data-holiday-kind" />
          <HolidayFilterRow label="Region" options={REGION_OPTIONS} value={region} onChange={(v) => set("region", v)} attr="data-holiday-region" />
        </div>
        <p className="text-ds-14 text-muted-foreground" aria-live="polite" data-holiday-count="">
          {shown === 1 ? "1 event" : `${shown} events`}
        </p>
        {groups.length === 0 ? (
          <HolidayNothing onClear={() => setParams(new URLSearchParams(), { replace: true })}>
            {when === "weekend" ? "No events match these filters this weekend." : "No events match these filters."}
          </HolidayNothing>
        ) : (
          groups.map((g) => (
            <HolidaySection key={g.key} id={`events-${g.key}`} title={g.day ? holidayDayHeading(g.day, today) : g.key === "now" ? "Happening now" : DATES_TBA} count={g.items.length}>
              {g.items.map((e) => <HolidayCard key={e.id} item={e} kind="event" tag={HOLIDAY_EVENT_KIND[e.category]} />)}
            </HolidaySection>
          ))
        )}
        <p className="text-ds-14 text-muted-foreground">{W.checkFirst}</p>
        <nav aria-label="More from the Holiday Hub" className="flex flex-wrap gap-x-6 gap-y-2 text-ds-15">
          <Link to={HOLIDAY_LIGHTS_PATH} className="link-standard inline-flex min-h-11 items-center">Christmas lights</Link>
          <Link to={HOLIDAY_HIRE_PATH} className="link-standard inline-flex min-h-11 items-center">Hire a Helpr for the holidays</Link>
        </nav>
      </div>
    </PublicHeaderPage>
  );
}
