/**
 * /holidays/lights (Louisiana Holiday Hub, owner-approved 2026-11-20): every Christmas light display, grouped by region,
 * filtered by region, drive or walk, and free or paid (the filters live in the URL, so a filtered list can be shared).
 * A display with no confirmed 2026 date says "Dates TBA". Each has an "Open in Maps" link (a plain maps search, no map
 * library). The data (lights.mjs) is imported here only, so it ships in this page's own lazy chunk.
 * Guard: src/test/holidayHub.test.tsx.
 */
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { HOLIDAY_LIGHTS } from "@/content/holidayHub/lights.mjs";
import {
  HOLIDAY_EVENTS_PATH, HOLIDAY_HIRE_PATH, HOLIDAY_HUB_PATH, HOLIDAY_LIGHT_FORMAT, HOLIDAY_REGIONS, HOLIDAY_WORDS as W,
  filterLights, lightsByRegion, louisianaToday, type HolidayCost, type HolidayRegion,
} from "@/content/holidayHub/holidayHub.mjs";
import { HUB_COLUMN, HUB_HEADER_COLUMN, HolidayCard, HolidayFilterRow, HolidayNothing, HolidaySection, useHolidayPageView } from "./holidayParts";

const REGION_OPTIONS = [{ value: "all", label: "All regions" }, ...HOLIDAY_REGIONS.map((r) => ({ value: r.slug, label: r.label }))] as const;
const WAY_OPTIONS = [{ value: "all", label: "Any" }, { value: "drive", label: "Drive" }, { value: "walk", label: "Walk" }] as const;
const COST_OPTIONS = [{ value: "all", label: "Any" }, { value: "free", label: "Free" }, { value: "paid", label: "Paid" }] as const;

const pick = <T extends string>(v: string | null, allowed: readonly { value: string }[]): T | "all" =>
  v && allowed.some((o) => o.value === v) ? (v as T) : "all";

export default function HolidayLights() {
  usePageMeta(PUBLIC_PAGE_META["/holidays/lights"]);
  useHolidayPageView("holidays_lights");
  const [params, setParams] = useSearchParams();
  const region = pick<HolidayRegion>(params.get("region"), REGION_OPTIONS);
  const way = pick<"drive" | "walk">(params.get("way"), WAY_OPTIONS);
  const cost = pick<HolidayCost>(params.get("cost"), COST_OPTIONS);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const today = louisianaToday();
  const groups = useMemo(
    () => lightsByRegion(filterLights(HOLIDAY_LIGHTS, { region: region === "all" ? null : region, way: way === "all" ? null : way, cost: cost === "all" ? null : cost }, today)),
    [region, way, cost, today],
  );
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <PublicHeaderPage title={W.lightsTitle} backTo={HOLIDAY_HUB_PATH} wrapTitle bottomPaddingClassName="pb-12 md:pb-16" headerWrapperClassName={HUB_HEADER_COLUMN}>
      <div className={`${HUB_COLUMN} space-y-6 font-sans`} data-holiday-page="lights">
        <p className="max-w-[68ch] text-ds-15 text-muted-foreground">{W.lightsIntro}</p>
        <div className="space-y-3" data-holiday-filters="">
          <HolidayFilterRow label="Region" options={REGION_OPTIONS} value={region} onChange={(v) => set("region", v)} attr="data-holiday-region" />
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <HolidayFilterRow label="How you see it" options={WAY_OPTIONS} value={way} onChange={(v) => set("way", v)} attr="data-holiday-way" />
            <HolidayFilterRow label="Cost" options={COST_OPTIONS} value={cost} onChange={(v) => set("cost", v)} attr="data-holiday-cost" />
          </div>
        </div>
        <p className="text-ds-14 text-muted-foreground" aria-live="polite" data-holiday-count="">
          {shown === 1 ? "1 display" : `${shown} displays`}
        </p>
        {groups.length === 0 ? (
          <HolidayNothing onClear={() => setParams(new URLSearchParams(), { replace: true })}>No light displays match these filters.</HolidayNothing>
        ) : (
          groups.map((g) => (
            <HolidaySection key={g.region.slug} id={`lights-${g.region.slug}`} title={g.region.label} count={g.items.length}>
              {g.items.map((l) => <HolidayCard key={l.id} item={l} kind="light" tag={l.format ? HOLIDAY_LIGHT_FORMAT[l.format] : null} />)}
            </HolidaySection>
          ))
        )}
        <p className="text-ds-14 text-muted-foreground">{W.checkFirst}</p>
        <nav aria-label="More from the Holiday Hub" className="flex flex-wrap gap-x-6 gap-y-2 text-ds-15">
          <Link to={HOLIDAY_EVENTS_PATH} className="link-standard inline-flex min-h-11 items-center">Holiday events</Link>
          <Link to={HOLIDAY_HIRE_PATH} className="link-standard inline-flex min-h-11 items-center">Hire a Helpr for the holidays</Link>
        </nav>
      </div>
    </PublicHeaderPage>
  );
}
