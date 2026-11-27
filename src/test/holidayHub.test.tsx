/**
 * Louisiana Holiday Hub (owner-approved 2026-11-20; one page 2026-11-21): /holidays and /holidays/hire-a-helpr. Pins
 * the routing on every layer (App.tsx lazy route, vercel.json's two rewrites, the sitemap, the meta table, the
 * document-scroll list, the footer and gift guides links, never the phone top nav), the retired /holidays/lights and
 * /holidays/events (a redirect in the app, each to /holidays with its filter preset; served the app shell only, out
 * of the sitemap and the meta table), the data (public fields only, the research's dates_tbc rule shown as "Dates TBA"), the
 * one list on /holidays (lights and events together, soonest first, no hire strip (owner 11-21 evening): happening now, then by
 * date, TBA last, past hidden; the filters folded behind a plain filter icon with a count, a search icon beside it, in the shared FilterSheet,
 * with a quick All / Lights / Events choice and a removable chip per filter in effect), the pre-JS SEO (one H1 each, ItemList of the lights and an Event
 * only for confirmed dates on /holidays) and the analytics (page_view, the Open in Maps click, no personal data).
 *
 * Red first (2026-11-20) against origin/main 4c37a03005: no route, no data, no page. One-page red (2026-11-21) against
 * origin/main de0b2274ad: /holidays held three cards and no list, and /holidays/lights and /holidays/events were pages.
 *
 * @mutate src/content/holidayHub/holidayHub.mjs |   return item.tba \|\| !item.dates ? DATES_TBA : item.dates; |   return item.dates ?? DATES_TBA;
 * @mutate src/content/holidayHub/holidayHub.mjs |     if (range && !runsBetween(e, range[0], range[1])) return false; |
 * @mutate src/content/holidayHub/holidayHub.mjs |     if (!costMatches(l.cost, cost)) return false; |
 * @mutate src/content/holidayHub/holidayHub.mjs |     if (!costMatches(e.cost, cost)) return false; |
 * @mutate src/content/holidayHub/holidayHub.mjs |     if (way === "walk" && !["walk", "both"].includes(l.format)) return false; |
 * @mutate src/lib/holidayHubSeo.mjs |     .filter((e) => !e.tba && e.start) |     .filter((e) => Boolean(e))
 * @mutate src/App.tsx |       <Route path="/holidays/lights" element= |       <Route path="/holidays/lights-old" element=
 * @mutate src/content/holidayHub/holidayHub.mjs |   const showLights = !what \|\| what === "lights"; |   const showLights = what === "lights";
 * @mutate src/content/holidayHub/holidayHub.mjs |     else if (!e.start \|\| e.start < today) now.push(e); |     else if (e.start < today) now.push(e);
 * @mutate src/content/holidayHub/holidayHub.mjs |     ...(showLights ? filterLights(lights, { region, cost }, today).filter(inWeekend) : []), |     ...(showLights ? filterLights(lights, { region, cost }, today) : []),
 * @mutate src/content/holidayHub/holidayHub.mjs |   next.set("what", from === "lights" ? "lights" : |   next.set("what", from === "lights" ? "events" :
 * @mutate src/pages/info/holidays/HolidayHub.tsx |           <div className="flex min-h-11 items-center gap-1" data-holiday-searchrow={searchOpen ? "open" : "closed"}> |           <div className="flex min-h-11 items-center gap-1" data-holiday-searchrow={searchOpen ? "open" : "closed"}><a href="/holidays/hire-a-helpr" data-holiday-hire-strip="">Hire a Helpr for the holidays</a>
 * @mutate src/pages/info/holidays/HolidayHub.tsx |             <p className={`${searchOpen ? "hh-count-open" : "min-w-0 flex-1"} gg-itemcount | <p hidden={searchOpen} className={`${searchOpen ? "hh-count-open" : "min-w-0 flex-1"} gg-itemcount
 * @mutate src/pages/info/holidays/HolidayHub.tsx | <RoundIconButton ref={searchButton} className="gg-icon" | <RoundIconButton ref={searchButton} className="rounded-ds-md ctl-tint"
 * @mutate src/pages/info/holidays/HolidayHub.tsx | <RoundIconButton ref={filtersButton} className="gg-icon" | <RoundIconButton ref={filtersButton} className="rounded-ds-md ctl-tint"
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .hh-search{flex:1 0 160px;min-width:160px;margin-left:auto} | .hh-search{flex:1 1 100%;min-width:0;margin-left:auto}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | @container (max-width:499px){.hh-count-full{position:absolute; | @container (max-width:499px){.hh-count-full{display:none;
 * @mutate src/pages/info/holidays/HolidayHub.tsx |   return words.every((w) => hay.includes(w)); |   return true;
 * @mutate src/pages/info/holidays/HolidayHub.tsx |                   onKeyDown={(e) => { if (e.key === "Escape") closeSearch(); }} |                   onKeyDown={() => undefined}
 * @mutate src/pages/info/holidays/holidayParts.tsx |       <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</ul> |       <ul className="grid gap-3 md:grid-cols-2">{children}</ul>
 * @mutate src/pages/info/holidays/holidayParts.tsx |       {tag && <p className= |       {false && <p className=
 * @mutate src/pages/info/holidays/HolidayHub.tsx |     window.history.replaceState(window.history.state, "", `${window.location.pathname}${q ? `?${q}` : ""}`); |     void q;
 * @mutate src/pages/info/holidays/HolidayHub.tsx |   const [filtersOpen, setFiltersOpen] = useState(false); |   const [filtersOpen, setFiltersOpen] = useState(true);
 * @mutate src/pages/info/holidays/HolidayHub.tsx |                   <FilterChip size="tight" onClick={() => set(f.key, "all")} |                   <FilterChip size="tight" onClick={() => undefined}
 * @mutate src/pages/info/holidays/HolidayHub.tsx |     ...(region !== "all" ? [{ key: "region", label: labelOf(REGION_OPTIONS, region) }] : []), |
 * @mutate src/content/holidayHub/holidayHub.mjs |     ...(now.length ? [{ key: "now", day: null, items: now.sort(closingSoonest) }] : []), |     ...(now.length ? [{ key: "now", day: null, items: now.sort(byName) }] : []),
 * @mutate src/content/holidayHub/holidayHub.mjs |     if (today && isOver(e, today)) return false; |
 * @mutate src/components/Footer.tsx |               <Link to="/holidays" className={FOOTER_LINK}> |               <Link to="/help" className={FOOTER_LINK}>
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx |         <li><Link to="/holidays" {...current("/holidays")} data-gift-side-holiday-hub=""> |         <li><Link to="/help" {...current("/holidays")} data-gift-side-holiday-hub="">
 * @mutate src/pages/info/holidays/holidayParts.tsx | data-holiday-maps={item.id}\n          onClick={() => track("holiday_maps_click", { kind, id: item.id, region: item.region })} | data-holiday-maps={item.id}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics", () => ({ track, AhaEvent: new Proxy({}, { get: (_t, k) => String(k) }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));

import { HOLIDAY_LIGHTS } from "@/content/holidayHub/lights.mjs";
import { HOLIDAY_EVENTS } from "@/content/holidayHub/events.mjs";
import {
  DATES_TBA, HOLIDAY_HUB_PATHS, HOLIDAY_REGIONS, HOLIDAY_SEASON_END, isOpenEnded, filterEvents, filterHolidayItems, filterLights, holidayCountLabel, holidayDateLabel,
  endedEarlierToday, whenRange, holidayDayChipLabel, holidayDayChoices, holidayItemsOn, holidayItemsByDay, holidayLegacyHref, holidayMapsQuery, holidayPriceLabel, isHolidayLight, isOver, louisianaToday, resolveHolidayWhat, runsBetween,
  weekendRange,
} from "@/content/holidayHub/holidayHub.mjs";
import { holidayEventsLd, holidayHubBody, holidayHubLd, holidayLightsItemListLd } from "@/lib/holidayHubSeo.mjs";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import HolidayHub from "@/pages/info/holidays/HolidayHub";
import { HolidayCard, holidayDatesDisplay } from "@/pages/info/holidays/holidayParts";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

/**
 * What the Hub lists with no search typed (owner 11-22 "Pick a day"): everything on the chosen day (the first chip unless
 * `day` is given), then the undated light displays and "Dates TBA".
 */
const onPage = (items: HolidayItemLike[], today: string, when: "today" | "weekend" | "week" | null = null, day?: string) => {
  const d = day ?? holidayDayChoices(items, today, when)[0];
  const undated = holidayItemsByDay(items, today).filter((g) => g.key === "lights-tba" || g.key === "tba").flatMap((g) => g.items);
  return [...(d ? holidayItemsOn(items, d) : []), ...undated].map((i) => i.id);
};
type HolidayItemLike = ReturnType<typeof filterHolidayItems>[number];

/** The day after a YYYY-MM-DD day. */
const addDay = (ymd: string) => new Date(Date.parse(`${ymd}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
import HolidayHire from "@/pages/info/holidays/HolidayHire";
import HolidayLegacyRedirect from "@/pages/info/holidays/HolidayLegacyRedirect";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));
const raw = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
/** Friday Nov 20, 2026, noon in Louisiana. */
const FRIDAY = new Date("2026-11-20T18:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FRIDAY);
  track.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("Holiday Hub data: public fields only, the dates_tbc rule", () => {
  it("holds every display and event the research found (82 lights, 172 events; 57 and 44 TBA)", () => {
    expect(HOLIDAY_LIGHTS.length).toBe(82);
    expect(HOLIDAY_EVENTS.length).toBe(172);
    expect(HOLIDAY_LIGHTS.filter((l) => l.tba).length).toBe(57);
    expect(HOLIDAY_EVENTS.filter((e) => e.tba).length).toBe(44);
  });

  it("no research field and no source note reaches the app", () => {
    const keys = new Set([...HOLIDAY_LIGHTS, ...HOLIDAY_EVENTS].flatMap((i) => Object.keys(i)));
    for (const k of ["source_url", "notes", "dates_2026", "dates_tbc", "last_verified", "official_url"]) expect(keys.has(k), k).toBe(false);
    const words = /aggregator|Lafayette Mom|Red Stick Mom|Visit Baton Rouge|KEDM|CVB|\bconfirm\b|not stated|not posted|disagree|\(2025|\(prior/i;
    const hits = [...HOLIDAY_LIGHTS, ...HOLIDAY_EVENTS].flatMap((i) =>
      Object.entries(i).filter(([, v]) => typeof v === "string" && words.test(v)).map(([k, v]) => `${i.id}.${k}: ${v}`));
    expect(hits).toEqual([]);
    for (const i of [...HOLIDAY_LIGHTS, ...HOLIDAY_EVENTS]) if (i.url) expect(i.url, i.id).toMatch(/^https:\/\/[^\s"'<>]+$/);
  });

  it("a TBA item keeps no date at all, and every region is a known one", () => {
    for (const i of [...HOLIDAY_LIGHTS, ...HOLIDAY_EVENTS].filter((x) => x.tba)) {
      expect([i.dates, i.start, i.end, i.hours], i.id).toEqual([null, null, null, null]);
      expect(holidayDateLabel(i)).toBe(DATES_TBA);
    }
    const slugs = HOLIDAY_REGIONS.map((r) => r.slug);
    for (const i of [...HOLIDAY_LIGHTS, ...HOLIDAY_EVENTS]) expect(slugs, i.id).toContain(i.region);
  });

  it('"Dates TBA" wins over any date text when tba is set', () => {
    expect(holidayDateLabel({ tba: true, dates: "Dec 5, 2026" })).toBe("Dates TBA");
    expect(holidayDateLabel({ tba: false, dates: "Dec 5, 2026" })).toBe("Dec 5, 2026");
    expect(holidayDateLabel({ tba: false, dates: null })).toBe("Dates TBA");
  });
});

describe("Holiday Hub filters", () => {
  it("this weekend is Friday to Sunday in Louisiana", () => {
    expect(louisianaToday(FRIDAY)).toBe("2026-11-20");
    // 11 PM in Louisiana on Friday is already Saturday in UTC: still Friday here.
    expect(louisianaToday(new Date("2026-11-21T05:00:00Z"))).toBe("2026-11-20");
    expect(weekendRange("2026-11-20")).toEqual(["2026-11-20", "2026-11-22"]);
    expect(weekendRange("2026-11-21")).toEqual(["2026-11-21", "2026-11-22"]);
    expect(weekendRange("2026-11-22")).toEqual(["2026-11-22", "2026-11-22"]);
    expect(weekendRange("2026-11-23")).toEqual(["2026-11-27", "2026-11-29"]);
    expect(weekendRange("2026-11-26")).toEqual(["2026-11-27", "2026-11-29"]);
  });

  it("over, and runs-between: a TBA item is never over and never on a weekend", () => {
    expect(isOver({ tba: false, start: "2026-11-19", end: null }, "2026-11-20")).toBe(true);
    expect(isOver({ tba: false, start: "2026-11-01", end: "2026-12-24" }, "2026-11-20")).toBe(false);
    expect(isOver({ tba: true, start: null, end: null }, "2026-12-31")).toBe(false);
    expect(runsBetween({ tba: false, start: "2026-11-27", end: "2026-12-27" }, "2026-12-04", "2026-12-06")).toBe(true);
    expect(runsBetween({ tba: false, start: "2026-12-12", end: "2026-12-12" }, "2026-12-04", "2026-12-06")).toBe(false);
    expect(runsBetween({ tba: true, start: null, end: null }, "2026-12-04", "2026-12-06")).toBe(false);
  });

  // Holiday audit 1121 (High): a missing end read as a one-day item, so Lafayette Holiday Market (opened Nov 20) was
  // hidden on Nov 21 and Timber Ridge ("Opens Nov 21 (season run)") would vanish on Nov 22.
  // @mutate src/content/holidayHub/holidayHub.mjs |   if (isOpenEnded(item)) return HOLIDAY_SEASON_END; |
  // @mutate src/content/holidayHub/events.mjs | "start":"2026-11-20","end":"2026-11-22","hours":"10 am-5 pm (Sun to 4 pm)" | "start":"2026-11-20","end":null,"hours":"10 am-5 pm (Sun to 4 pm)"
  it("an item that opens or runs for the season stays listed until it ends, never the day after it opens", () => {
    const all = [...HOLIDAY_LIGHTS, ...HOLIDAY_EVENTS];
    const byId = (id: string) => all.find((i) => i.id === id)!;
    expect(isOver(byId("E001"), "2026-11-22")).toBe(false);
    expect(isOver(byId("E001"), "2026-11-23")).toBe(true);
    for (const day of ["2026-11-22", "2026-12-15", HOLIDAY_SEASON_END]) expect(isOver(byId("L081"), day), day).toBe(false);
    expect(runsBetween(byId("L081"), "2026-12-04", "2026-12-06")).toBe(true);
    // The class: a dated item with no end is either one day (no "Opens", "season", "through" or a range in its words)
    // or open-ended through the season.
    const noEnd = all.filter((i) => !i.tba && i.start && !i.end);
    expect(all.length).toBeGreaterThan(100);
    for (const i of noEnd) {
      const oneDay = !/\bopens\b|\bseason\b|\bthrough\b|\buntil\b|-|–/i.test(i.dates ?? "");
      expect(oneDay || isOpenEnded(i), `${i.id} ${i.dates}`).toBe(true);
      if (isOpenEnded(i)) expect(isOver(i, addDay(i.start!)), i.id).toBe(false);
    }
  });

  it("lights: region, drive or walk, free or paid each narrow the list", () => {
    const today = "2026-11-20";
    const all = filterLights(HOLIDAY_LIGHTS, {}, today);
    const acadiana = filterLights(HOLIDAY_LIGHTS, { region: "acadiana" }, today);
    expect(acadiana.length).toBeGreaterThan(5);
    expect(acadiana.every((l) => l.region === "acadiana")).toBe(true);
    const walk = filterLights(HOLIDAY_LIGHTS, { way: "walk" }, today);
    expect(walk.length).toBeGreaterThan(5);
    expect(walk.length).toBeLessThan(all.length);
    expect(walk.every((l) => l.format === "walk" || l.format === "both")).toBe(true);
    const drive = filterLights(HOLIDAY_LIGHTS, { way: "drive" }, today);
    expect(drive.every((l) => ["drive-through", "drive-by", "both"].includes(l.format ?? ""))).toBe(true);
    const free = filterLights(HOLIDAY_LIGHTS, { cost: "free" }, today);
    const paid = filterLights(HOLIDAY_LIGHTS, { cost: "paid" }, today);
    expect(free.length).toBeGreaterThan(5);
    expect(paid.length).toBeGreaterThan(2);
    expect(free.every((l) => l.cost === "free") && paid.every((l) => l.cost === "paid")).toBe(true);
  });

  it("events: kind, region and this weekend each narrow the list; a weekend never shows a TBA event", () => {
    const today = "2026-11-20";
    const all = filterEvents(HOLIDAY_EVENTS, {}, today);
    const parades = filterEvents(HOLIDAY_EVENTS, { category: "parade" }, today);
    expect(parades.length).toBeGreaterThan(10);
    expect(parades.every((e) => e.category === "parade")).toBe(true);
    const weekend = filterEvents(HOLIDAY_EVENTS, { weekend: true }, today);
    expect(weekend.length).toBeGreaterThan(0);
    expect(weekend.length).toBeLessThan(all.length);
    expect(weekend.every((e) => !e.tba && runsBetween(e, "2026-11-20", "2026-11-22"))).toBe(true);
    const br = filterEvents(HOLIDAY_EVENTS, { region: "baton-rouge" }, today);
    expect(br.every((e) => e.region === "baton-rouge")).toBe(true);
    // Over events drop out; TBA ones stay listed (under "Dates TBA").
    expect(all.some((e) => e.tba)).toBe(true);
    expect(all.every((e) => !isOver(e, today))).toBe(true);
    const groups = holidayItemsByDay(all, today);
    expect(groups[groups.length - 1]?.key).toBe("tba");
    expect(groups.filter((g) => g.day).map((g) => g.day)).toEqual([...groups.filter((g) => g.day).map((g) => g.day)].sort());
  });

  it("the maps search carries the name and the address, with the town when the address lacks it", () => {
    expect(holidayMapsQuery({ name: "A", address: "1 Main St", city: "Sulphur" })).toBe("A, 1 Main St, Sulphur, LA");
    expect(holidayMapsQuery({ name: "A", address: "1 Main St, Sulphur, LA 70663", city: "Sulphur" })).toBe("A, 1 Main St, Sulphur, LA 70663");
    expect(holidayMapsQuery({ name: "A", address: null, city: "Sulphur" })).toBe("A, Sulphur, LA");
  });
});

describe("/holidays: lights and events in one list", () => {
  const today = "2026-11-20";
  const at = (path: string, el: React.ReactElement) => render(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>);
  const shownIds = (c: HTMLElement) => [...c.querySelectorAll("[data-holiday-item]")].map((el) => el.getAttribute("data-holiday-item")!);
  const lightIds = new Set(HOLIDAY_LIGHTS.map((l) => l.id));
  const eventIds = new Set(HOLIDAY_EVENTS.map((e) => e.id));

  it("the merge: every light and event still running, the what/when/region/cost filters, the count line", () => {
    const all = filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today);
    const lights = filterLights(HOLIDAY_LIGHTS, {}, today);
    const events = filterEvents(HOLIDAY_EVENTS, {}, today);
    expect(all.length).toBe(lights.length + events.length);
    expect(lights.length).toBeGreaterThan(50);
    expect(events.length).toBeGreaterThan(100);
    expect(holidayCountLabel(all)).toBe(`${lights.length} light displays and ${events.length} events`);
    expect(holidayCountLabel([])).toBe("Nothing");
    const onlyLights = filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { what: "lights" }, today);
    expect(onlyLights.length).toBe(lights.length);
    expect(onlyLights.every(isHolidayLight)).toBe(true);
    expect(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { what: "events" }, today).length).toBe(events.length);
    const parades = filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { what: "parade" }, today);
    expect(parades.length).toBeGreaterThan(10);
    expect(parades.every((i) => !isHolidayLight(i) && i.category === "parade")).toBe(true);
    // This weekend: lights and events alike run on Fri-Sun; no TBA item ever shows.
    const weekend = filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { weekend: true }, today);
    expect(weekend.some(isHolidayLight)).toBe(true);
    expect(weekend.some((i) => !isHolidayLight(i))).toBe(true);
    expect(weekend.every((i) => !i.tba && runsBetween(i, "2026-11-20", "2026-11-22"))).toBe(true);
    const free = filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { cost: "free", region: "acadiana" }, today);
    expect(free.length).toBeGreaterThan(5);
    expect(free.every((i) => i.cost === "free" && i.region === "acadiana")).toBe(true);
  });

  it("the order: soonest first. Happening now (closing soonest first), then by start day, then Dates TBA; past hidden", () => {
    const groups = holidayItemsByDay(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today), today);
    expect(groups[0]?.key).toBe("now");
    expect(groups[groups.length - 1]?.key).toBe("tba");
    const days = groups.filter((g) => g.day).map((g) => g.day!);
    expect(days).toEqual([...days].sort());
    expect(days.every((d) => d >= today)).toBe(true);
    expect(groups.every((g) => g.key === "now" || g.key === "lights-tba" || g.key === "tba" || /^\d{4}-\d{2}-\d{2}$/.test(g.key))).toBe(true);
    const noStart = { id: "x", name: "X", tba: false, start: null, end: "2026-12-31" };
    expect(holidayItemsByDay([noStart], today).map((g) => g.key)).toEqual(["now"]);
    // Happening now: the one closing soonest first, an open-ended one last.
    const running = [
      { id: "a", name: "A", tba: false, start: "2026-11-01", end: null },
      { id: "b", name: "B", tba: false, start: "2026-11-01", end: "2027-01-06" },
      { id: "c", name: "C", tba: false, start: "2026-11-10", end: "2026-11-22" },
    ];
    expect(holidayItemsByDay(running, today)[0]!.items.map((i) => i.id)).toEqual(["c", "b", "a"]);
    const now = groups[0]!.items.map((i) => i.end ?? "9999-12-31");
    expect(now).toEqual([...now].sort());
    // Past: anything that ended before today (Louisiana) is never listed.
    const later = "2026-12-06";
    const over = [...HOLIDAY_LIGHTS, ...HOLIDAY_EVENTS].filter((i) => isOver(i, later));
    expect(over.length).toBeGreaterThan(20);
    const listed = new Set(holidayItemsByDay(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, later), later).flatMap((g) => g.items.map((i) => i.id)));
    expect(over.filter((i) => listed.has(i.id))).toEqual([]);
    const tba = groups[groups.length - 1]!.items;
    // Holiday audit 1121 area 5 #5: undated light displays have their own group after Happening now; TBA holds events.
    expect(tba.length > 0 && tba.every((i) => !isHolidayLight(i))).toBe(true);
  });

  it("no hire strip (owner 11-21 evening: \"remove the hire a helpr here\"), both lights and events, one page_view", () => {
    const { container } = at("/holidays", <HolidayHub />);
    expect(container.querySelector("[data-holiday-hire-strip], [data-holiday-hire-link]")).toBeNull();
    expect(container.textContent).not.toContain("Hire a Helpr for the holidays");
    const ids = shownIds(container);
    // Owner 11-22 "Pick a day": today's list (Friday Nov 20 here), then the undated displays and Dates TBA.
    expect(ids).toEqual(onPage(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today), today));
    expect(ids.filter((id) => lightIds.has(id)).length).toBeGreaterThan(40);
    expect(ids.filter((id) => eventIds.has(id)).length).toBeGreaterThan(40);
    const headings = [...container.querySelectorAll("h2")].map((h) => h.textContent ?? "");
    expect(headings[0]).toMatch(/^Today, Friday, November 20 \(\d+\)$/);
    expect(headings[headings.length - 1]).toMatch(/^Dates not announced yet \(\d+\)$/);
    expect(container.querySelector("[data-holiday-count]")!.textContent).toMatch(/^\d+ light displays and \d+ events$/);
    expect(track).toHaveBeenCalledWith("page_view", { page: "holidays" });
  });

  it("filters start folded: plain search and filter icons (no words, no border), All / Lights / Events inside the panel", () => {
    // Owner 2026-11-21: "move all lights and events into filter, remove the circle around filter and leave just the
    // icons, add a search icon".
    const { container } = at("/holidays", <HolidayHub />);
    const button = container.querySelector("[data-holiday-filters-button]") as HTMLButtonElement;
    expect(button.textContent).toBe("");
    // Consistency audit 1122 #6: the sliders icon that filters is "Filter" on every guides page (the sheet's title stays).
    expect(button.getAttribute("aria-label")).toBe("Filter");
    expect(button.className).not.toMatch(/\bborder\b/);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const search = container.querySelector("[data-holiday-search-button]") as HTMLButtonElement;
    expect(search.textContent).toBe("");
    expect(search.className).not.toMatch(/\bborder\b/);
    // Owner 2026-11-22 ("some icons have a circle background some are squared looking. they should all be
    // consistent"): both icons are the guides' toolbar icon (gg-icon: no resting circle or border, a 44px circle fill on
    // a desktop hover only, the same focus ring), never the square ghost fill (rounded-ds-md + ctl-tint).
    for (const icon of [button, search]) {
      expect(icon.className).toMatch(/(^| )gg-icon( |$)/);
      expect(icon.className).not.toMatch(/rounded-ds-md|ctl-tint/);
    }
    expect(document.querySelector("[data-holiday-what]")).toBeNull();
    expect(container.querySelector("[data-holiday-quick]")).toBeNull();
    expect(container.querySelector("[data-holiday-active]")).toBeNull();
    fireEvent.click(button);
    const panel = screen.getByRole("dialog", { name: "Filters" });
    expect([...panel.querySelectorAll("[data-holiday-what]")].map((b) => b.getAttribute("data-holiday-what")).slice(0, 3)).toEqual(["all", "lights", "events"]);
    fireEvent.click(panel.querySelector('[data-holiday-what="lights"]')!);
    expect(shownIds(container).every((id) => lightIds.has(id))).toBe(true);
  });

  it("search: the icon opens a field over names, towns and places; Escape closes it and shows everything again", () => {
    const { container } = at("/holidays", <HolidayHub />);
    const all = shownIds(container).length;
    const closedCount = container.querySelector("[data-holiday-count]")!.textContent;
    fireEvent.click(container.querySelector("[data-holiday-search-button]")!);
    const input = container.querySelector("[data-holiday-search]") as HTMLInputElement;
    expect(input).not.toBeNull();
    // Owner 2026-11-22 ("keep count on row"): open, the count stays on the field's row, at its left (one count, never
    // a line of its own under the row); the field, the held magnifier slot and the filter follow it in that order.
    const row = container.querySelector('[data-holiday-searchrow="open"]')!;
    expect(container.querySelectorAll("[data-holiday-count]").length).toBe(1);
    const count = row.querySelector<HTMLElement>("[data-holiday-count]")!;
    expect(count.hidden).toBe(false);
    expect(row.firstElementChild).toBe(count);
    expect([...row.children].map((e) => e.hasAttribute("data-holiday-count") ? "count" : e.hasAttribute("data-holiday-search-box") ? "field" : e.hasAttribute("data-search-trigger-slot") ? "slot" : e.hasAttribute("data-holiday-filters-button") ? "filter" : e.tagName))
      .toEqual(["count", "field", "slot", "filter"]);
    // The words, and the number a narrow row (every phone) shows in their place; the words stay for screen readers.
    expect(count.querySelector(".hh-count-full")!.textContent).toBe(closedCount);
    const short = count.querySelector(".hh-count-short")!;
    expect(short.getAttribute("aria-hidden")).toBe("true");
    // The count is every item the filters cover, on any date (the chosen day's band carries that day's own count).
    expect(short.textContent).toBe(String(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today).length));
    // The soft field (the guides' own: 16px words, light ring) with the 44px ✕.
    expect(row.querySelector("[data-holiday-search-box]")!.className).toContain("gg-search rounded-xl focus-within:ring-2 focus-within:ring-[hsl(var(--bark)/0.22)]");
    fireEvent.change(input, { target: { value: "natchitoches" } });
    expect(count.querySelector(".hh-count-short")!.textContent).toBe(String(shownIds(container).length));
    const hits = shownIds(container);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today).length);
    const items = [...HOLIDAY_LIGHTS, ...HOLIDAY_EVENTS];
    for (const id of hits) {
      const i = items.find((x) => x.id === id)!;
      expect([i.name, i.city, i.address, i.region].join(" ").toLowerCase(), id).toContain("natchitoches");
    }
    fireEvent.keyDown(input, { key: "Escape" });
    expect(container.querySelector("[data-holiday-search]")).toBeNull();
    expect(shownIds(container).length).toBe(all);
    // The row is back exactly: the count's words, the magnifier, the filter.
    expect(container.querySelector('[data-holiday-searchrow="closed"] [data-holiday-count]')!.textContent).toBe(closedCount);
    expect(container.querySelector('[data-holiday-searchrow="closed"] [data-holiday-search-button]')).not.toBeNull();
  });

  it("the open search row's CSS: the field at least 160px beside the count, at most 360px on a computer; a narrow row shows the number", () => {
    // Owner 2026-11-22: "keep count on row". Measured (Chromium, local dev build): 320 count "246" + field 162px,
    // 375 field 211px, 768 field 342px (number only), 1024/1440 the words + a 360px field; no horizontal overflow.
    const css = GIFT_GUIDES_CSS;
    expect(css).toContain("[data-holiday-searchrow]{container-type:inline-size}");
    expect(css).toContain(".hh-count-open{flex:0 1 auto;min-width:auto}");
    expect(css).toContain(".hh-search{flex:1 0 160px;min-width:160px;margin-left:auto}");
    expect(css).toContain(".hh-search input{padding-right:44px}");
    expect(css).toContain("@media (min-width:768px){.hh-search{max-width:360px}}");
    expect(css).toContain("@container (max-width:499px){.hh-count-full{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.hh-count-short{display:inline}}");
    expect(css).toMatch(/\.hh-count-short\{display:none\}/);
  });

  it("compact cards: the type a small tag, one where-and-when line, the address is the Maps link, no round buttons", () => {
    const { container } = at("/holidays", <HolidayHub />);
    expect(container.querySelectorAll("[data-holiday-item]").length).toBeGreaterThan(60);
    // Polish audit 11-27 #15: the undated items are two-line rows (below); the dated ones keep the card.
    const cards = [...container.querySelectorAll("[data-holiday-item]:not([data-holiday-undated])")];
    expect(cards.length).toBeGreaterThan(5);
    for (const c of cards.slice(0, 40)) {
      expect(c.querySelector("[data-holiday-tag]"), c.getAttribute("data-holiday-item")!).not.toBeNull();
      for (const a of c.querySelectorAll("a")) expect(a.className, c.getAttribute("data-holiday-item")!).not.toMatch(/rounded-full|\bborder\b/);
    }
    expect(container.querySelector("ul.grid")!.className).toMatch(/xl:grid-cols-3/);
  });

  it("Filters opens a labelled panel with What, When, Region and Cost; chips narrow the list; Show N closes it", () => {
    const { container } = at("/holidays", <HolidayHub />);
    const button = container.querySelector("[data-holiday-filters-button]") as HTMLButtonElement;
    button.focus();
    fireEvent.click(button);
    const panel = screen.getByRole("dialog", { name: "Filters" });
    for (const t of ["What", "When", "Region", "Cost"]) expect(within(panel).getByRole("group", { name: t })).toBeTruthy();
    fireEvent.click(panel.querySelector('[data-holiday-what="lights"]')!);
    fireEvent.click(panel.querySelector('[data-holiday-region="baton-rouge"]')!);
    fireEvent.click(panel.querySelector('[data-holiday-cost="free"]')!);
    const expected = filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { what: "lights", region: "baton-rouge", cost: "free" }, today);
    expect(expected.length).toBeGreaterThan(3);
    expect(shownIds(container).sort()).toEqual(onPage(expected, today).sort());
    expect(panel.querySelector('[data-holiday-what="lights"]')!.getAttribute("aria-pressed")).toBe("true");
    // The address bar follows (a shareable link) without a router navigation, which would remount the page and close
    // the panel under PageTransition's location.key.
    expect(new URLSearchParams(window.location.search).get("region")).toBe("baton-rouge");
    expect(new URLSearchParams(window.location.search).get("what")).toBe("lights");
    const show = within(panel).getByRole("button", { name: `Show ${expected.length} results` });
    fireEvent.click(show);
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
    expect(button.textContent).toBe("3"); // the icon and its count badge
    expect(button.getAttribute("aria-label")).toBe("Filter, 3 on");
  });

  it("a URL preset shows as removable chips with the count; removing one widens the list, Clear all empties them", () => {
    const { container } = at("/holidays?region=baton-rouge&cost=free&what=parade", <HolidayHub />);
    const chips = () => [...container.querySelectorAll("[data-holiday-active-chip]")].map((c) => c.textContent);
    expect(chips()).toEqual(["Parades", "Baton Rouge", "Free"]);
    expect(container.querySelector("[data-holiday-filter-count]")!.textContent).toBe("3");
    const parades = shownIds(container).map((id) => HOLIDAY_EVENTS.find((e) => e.id === id));
    expect(parades.length).toBeGreaterThan(0);
    expect(shownIds(container).sort()).toEqual(onPage(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { what: "parade", cost: "free", region: "baton-rouge" }, today), today).sort());
    expect(parades.every((e) => e?.category === "parade" && e.region === "baton-rouge" && e.cost === "free")).toBe(true);
    fireEvent.click(within(container).getByRole("button", { name: "Remove filter: Baton Rouge" }));
    expect(chips()).toEqual(["Parades", "Free"]);
    expect(shownIds(container).sort()).toEqual(onPage(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { what: "parade", cost: "free" }, today), today).sort());
    fireEvent.click(container.querySelector("[data-holiday-filters-button]")!);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Filters" })).getByRole("button", { name: "Clear all" }));
    expect(container.querySelector("[data-holiday-active]")).toBeNull();
    expect(shownIds(container).sort()).toEqual(onPage(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today), today).sort());
  });

  it("This weekend narrows the day chips to Friday-Sunday and lists only this weekend's items; nothing matching shows the empty state", () => {
    const { container, unmount } = at("/holidays?when=weekend", <HolidayHub />);
    const weekend = filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { weekend: true }, today);
    expect([...container.querySelectorAll("[data-holiday-day]")].map((c) => c.getAttribute("data-holiday-day"))).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(shownIds(container).sort()).toEqual(onPage(weekend, today, "weekend").sort());
    const ids = new Set(weekend.map((i) => i.id));
    expect(shownIds(container).every((id) => ids.has(id))).toBe(true);
    expect(within(container).queryByText(/^Dates TBA/)).toBeNull();
    unmount();
    const none = at("/holidays?what=reveillon&region=natchitoches&cost=free&when=weekend", <HolidayHub />);
    expect(none.container.querySelector("[data-holiday-empty]")).not.toBeNull();
    expect(none.container.querySelector("[data-holiday-count]")!.textContent).toBe("");
    fireEvent.click(within(none.container).getByRole("button", { name: "Clear filters" }));
    expect(shownIds(none.container).sort()).toEqual(onPage(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today), today).sort());
  });

  it("Open in Maps: a plain maps search with the name, and a click event with no personal data", () => {
    const { container } = at("/holidays?what=lights&region=acadiana", <HolidayHub />);
    const link = container.querySelector("[data-holiday-maps]") as HTMLAnchorElement;
    const id = link.getAttribute("data-holiday-maps")!;
    const l = HOLIDAY_LIGHTS.find((x) => x.id === id)!;
    expect(link.href).toBe(`https://maps.apple.com/?q=${encodeURIComponent(holidayMapsQuery(l))}`);
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    track.mockClear();
    fireEvent.click(link);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("holiday_maps_click", { kind: "light", id, region: "acadiana" });
  });

  it("a dated card's own place link sends the same click event, and its price is never a bare '$' (polish audit 11-27 #14)", () => {
    const l = HOLIDAY_LIGHTS.find((x) => x.region === "acadiana" && x.address && !x.tba)!;
    const { container } = render(<MemoryRouter><ul><HolidayCard item={{ ...l, price: "$" }} kind="light" tag="Lights" /></ul></MemoryRouter>);
    expect(container.querySelector("[data-holiday-price]")!.textContent).toBe("Paid");
    track.mockClear();
    fireEvent.click(container.querySelector("[data-holiday-maps]")!);
    expect(track).toHaveBeenCalledWith("holiday_maps_click", { kind: "light", id: l.id, region: "acadiana" });
  });

  // Polish audit 11-27 #136: Website and Add to calendar are two equal 14px/600 text buttons (no unlabelled icon).
  // @mutate src/pages/info/holidays/holidayParts.tsx |             Add to calendar<span className="sr-only"> for {item.name}</span> |             <span className="sr-only">Add {item.name} to your calendar</span>
  it("a dated card's actions read 'Website' and 'Add to calendar' in one text style", () => {
    const l = HOLIDAY_LIGHTS.find((x) => x.url && x.start && !x.tba)!;
    const { container } = render(<MemoryRouter><ul><HolidayCard item={l} kind="light" tag="Lights" /></ul></MemoryRouter>);
    const site = container.querySelector("[data-holiday-site]")!;
    const ics = container.querySelector("[data-holiday-ics]")!;
    expect(ics.textContent).toMatch(/^Add to calendar/);
    expect(site.textContent).toMatch(/^Website/);
    for (const el of [site, ics]) expect(el.className).toMatch(/text-ds-14 font-semibold/);
    expect(ics.querySelector("svg")).toBeNull();
  });

  it("/holidays/hire-a-helpr: Post a job and Find work, each holiday job opens Post a job filled in, and no ID prompt", () => {
    const { container } = at("/holidays/hire-a-helpr", <HolidayHire />);
    // Audit 11-21 (P0, owner 11-20/21): a guest starts the post and signs up at the end.
    expect(container.querySelector("[data-holiday-post]")!.getAttribute("href")).toBe("/post-job");
    expect(container.querySelector("[data-holiday-find-work]")!.getAttribute("href")).toBe("/browse");
    const lights = container.querySelector('[data-holiday-help-post="Hang Christmas lights"]')!.getAttribute("href")!;
    expect(decodeURIComponent(lights)).toBe("/post-job?mm=1&cat=handyman&t=Hang+Christmas+lights");
    expect(container.querySelectorAll("[data-holiday-help]").length).toBe(7);
    expect(container.textContent).not.toMatch(/\bID\b|identity|verify your/i);
  });
});

describe("the retired /holidays/lights and /holidays/events", () => {
  function Where() {
    const { pathname, search } = useLocation();
    return <p data-where="">{pathname + search}</p>;
  }
  const landOn = (path: string) => {
    const { container, unmount } = render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/holidays/lights" element={<HolidayLegacyRedirect />} />
          <Route path="/holidays/events" element={<HolidayLegacyRedirect />} />
          <Route path="/holidays" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    const where = container.querySelector("[data-where]")?.textContent;
    unmount();
    return where;
  };

  it("redirect to /holidays with the matching filter preset, keeping the filters /holidays still has", () => {
    expect(landOn("/holidays/lights")).toBe("/holidays?what=lights");
    expect(landOn("/holidays/events")).toBe("/holidays?what=events");
    expect(landOn("/holidays/lights?region=acadiana&way=walk&cost=free")).toBe("/holidays?what=lights&region=acadiana&cost=free");
    expect(landOn("/holidays/events?kind=parade&when=weekend&region=monroe")).toBe("/holidays?what=parade&when=weekend&region=monroe");
    expect(landOn("/holidays/events?kind=nope")).toBe("/holidays?what=events");
    expect(holidayLegacyHref("/holidays/nope")).toBe("/holidays");
  });

  it("a URL that still carries the old ?kind= lands on that kind", () => {
    expect(resolveHolidayWhat("events", "parade")).toBe("parade");
    expect(resolveHolidayWhat("lights", "parade")).toBe("lights");
    expect(resolveHolidayWhat(null, "santa")).toBe("santa");
    expect(resolveHolidayWhat("nope", null)).toBeNull();
    const { container } = render(<MemoryRouter initialEntries={["/holidays?what=events&kind=santa"]}><HolidayHub /></MemoryRouter>);
    expect(container.querySelector('[data-holiday-active-chip="what"]')!.textContent).toBe("Santa");
    const ids = [...container.querySelectorAll("[data-holiday-item]")].map((el) => HOLIDAY_EVENTS.find((e) => e.id === el.getAttribute("data-holiday-item")));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((e) => e?.category === "santa")).toBe(true);
  });
});

describe("Holiday Hub routing, on every layer", () => {
  const app = read("src/App.tsx");
  const vercel = JSON.parse(raw("vercel.json")) as { rewrites: { source: string; destination: string }[] };
  const sitemap = raw("public/sitemap.xml");

  it("has its inventory", () => {
    expect(HOLIDAY_HUB_PATHS).toEqual(["/holidays", "/holidays/hire-a-helpr"]);
  });

  it.each([
    ["/holidays", "HolidayHub"],
    ["/holidays/hire-a-helpr", "HolidayHire"],
  ])("%s: a lazy route, both rewrites, in the sitemap, with its own head", (path, name) => {
    expect(app).toContain(`const ${name} = lazyWithPreload(() => import("./pages/info/holidays/${name}"));`);
    expect(app).toContain(`<Route path="${path}" element={<RouteErrorBoundary>{routeEl(<PageTransition><${name} /></PageTransition>)}</RouteErrorBoundary>} />`);
    expect(vercel.rewrites.filter((r) => r.source === path).map((r) => r.destination)).toEqual([`/api/share?_og=page&_id=${path.slice(1)}`, "/index.html"]);
    expect(sitemap).toContain(`<loc>https://www.louisianahelpr.com${path}</loc>`);
    const meta = PUBLIC_PAGE_META[path as keyof typeof PUBLIC_PAGE_META];
    expect(meta.canonical).toBe(`https://www.louisianahelpr.com${path}`);
    expect(meta.title).toMatch(/ — Helpr$/);
  });

  it.each([
    ["/holidays/lights", "/holidays?what=lights"],
    ["/holidays/events", "/holidays?what=events"],
  ])("%s: a redirect in the app (to %s), served the app shell, out of the sitemap and the meta table", (path, to) => {
    expect(app).toContain(`<Route path="${path}" element={<RouteErrorBoundary>{routeEl(<HolidayLegacyRedirect />)}</RouteErrorBoundary>} />`);
    expect(holidayLegacyHref(path)).toBe(to);
    // Only the app shell: no pre-JS body of its own (publicSiteFilesValid forbids a vercel redirect over an app route).
    expect(vercel.rewrites.filter((r) => r.source === path).map((r) => r.destination)).toEqual(["/index.html"]);
    expect(sitemap).not.toContain(`<loc>https://www.louisianahelpr.com${path}</loc>`);
    expect(Object.keys(PUBLIC_PAGE_META)).not.toContain(path);
  });

  it("document scroll, linked from the footer and the gift guides left menu (owner 11-21: not the main column), never the phone top nav", () => {
    expect(read("src/hooks/useAppShellViewport.ts")).toMatch(/^\s*"\/holidays",/m);
    expect(read("src/components/Footer.tsx")).toContain('<Link to="/holidays" className={FOOTER_LINK}>');
    // Guide consistency audit 1122 #2: marked current on its own page (src/test/giftGuideDisclosureWhereLinked1122.test.tsx).
    expect(read("src/pages/info/giftGuides/GiftGuidesSidebar.tsx")).toContain('<Link to="/holidays" {...current("/holidays")} data-gift-side-holiday-hub="">');
    // No top-nav link to it (polish audit 1122 #28 lists "/holidays" only in NAV_HOME_HIDDEN_ON, the pages that hide Home).
    expect(read("src/components/Navbar.tsx")).not.toMatch(/(?:to|href)=\{?["'`]\/holidays/);
    expect(read("src/components/Navbar.tsx")).toMatch(/NAV_HOME_HIDDEN_ON = \[[^\]]*"\/holidays"/);
  });

  it("the lists' data loads only in /holidays's own chunk (the hire page, the redirect and the parts import none)", () => {
    expect(read("src/pages/info/holidays/HolidayHub.tsx")).toContain('from "@/content/holidayHub/lights.mjs"');
    expect(read("src/pages/info/holidays/HolidayHub.tsx")).toContain('from "@/content/holidayHub/events.mjs"');
    for (const f of ["HolidayHire", "HolidayLegacyRedirect", "holidayParts"]) expect(read(`src/pages/info/holidays/${f}.tsx`)).not.toMatch(/holidayHub\/(lights|events)\.mjs/);
  });
});

describe("Holiday Hub SEO before JavaScript", () => {
  const today = "2026-11-20";

  it("each page: one H1, the breadcrumb, and its own list", () => {
    for (const p of HOLIDAY_HUB_PATHS) {
      const body = holidayHubBody(p, today)!;
      expect(body.match(/<h1>/g)?.length, p).toBe(1);
      expect(body, p).toContain('aria-label="Breadcrumb"');
    }
    expect(holidayHubBody("/holidays/nope", today)).toBeNull();
    expect(holidayHubBody("/holidays/lights", today)).toBeNull();
    const hub = holidayHubBody("/holidays", today)!;
    const esc = (n: string) => n.replace(/&/g, "&amp;").replace(/'/g, "&#39;");
    for (const l of filterLights(HOLIDAY_LIGHTS, {}, today).slice(0, 10)) expect(hub).toContain(esc(l.name));
    for (const e of filterEvents(HOLIDAY_EVENTS, {}, today).slice(0, 10)) expect(hub).toContain(esc(e.name));
    expect(hub).toContain("Dates TBA");
    expect(hub).toContain('<a href="/holidays/hire-a-helpr">Hire a Helpr for the holidays</a>');
  });

  it("an ItemList of the lights still running, and an Event only for each confirmed, not-over event", () => {
    const list = holidayLightsItemListLd(today) as { numberOfItems: number; itemListElement: unknown[] };
    expect(list.numberOfItems).toBe(filterLights(HOLIDAY_LIGHTS, {}, today).length);
    const events = holidayEventsLd(today) as { name: string; startDate: string; endDate?: string }[];
    const confirmed = filterEvents(HOLIDAY_EVENTS, {}, today).filter((e) => !e.tba && e.start);
    expect(events.length).toBe(confirmed.length);
    expect(events.length).toBeGreaterThan(80);
    const tbaNames = new Set(HOLIDAY_EVENTS.filter((e) => e.tba).map((e) => e.name));
    expect(events.filter((e) => tbaNames.has(e.name) && !confirmed.some((c) => c.name === e.name))).toEqual([]);
    for (const e of events) expect(e.startDate).toMatch(/^2026-|^2027-/);
    expect(holidayHubLd("/holidays", today)!.length).toBe(2 + events.length);
    expect(holidayHubLd("/holidays/events", today)).toBeNull();
  });
});

/**
 * Holiday audit 1121 area 5 (Audit-Holiday-printables-hub-1121.json #3, #5, #7, #10, #14, #15).
 * @mutate src/content/holidayHub/holidayHub.mjs | export const costMatches = (itemCost, cost) => !cost \|\| (cost === "unlisted" ? itemCost == null : itemCost === cost); | export const costMatches = (itemCost, cost) => !cost \|\| itemCost === cost;
 * @mutate src/pages/info/holidays/HolidayHub.tsx | {unlisted > 0 && <span data-holiday-unlisted=""> | {false && <span data-holiday-unlisted="">
 * @mutate src/content/holidayHub/holidayHub.mjs |     if ((e.tba \|\| (!e.start && !e.end)) && isHolidayLight(e)) lightsTba.push(e); |     if (false) lightsTba.push(e);
 * @mutate src/pages/info/holidays/holidayParts.tsx |   const price = holidayPriceLabel(item.price);\n  const maps = |   const price = item.price;\n  const maps =
 * @mutate src/content/holidayHub/holidayHub.mjs |   if (region && region.toLowerCase().startsWith(item.city.toLowerCase())) return region; |
 * @mutate src/pages/info/holidays/HolidayHub.tsx |     }, today).filter((i) => !endedEarlierToday(i, today, minutes)), |     }, today),
 * @mutate src/pages/info/holidays/HolidayHub.tsx | <Link to="/gift-guides/small-business-saturday#get-featured" className="link-standard inline-flex min-h-11 flex-wrap items-center gap-x-1 font-semibold text-[hsl(var(--bark))]"> | <Link to="/gift-guides/small-business-saturday#get-featured" className="link-standard flex-wrap gap-x-1 font-semibold text-[hsl(var(--bark))]">
 * @mutate src/pages/info/holidays/HolidayHub.tsx |         <div className="space-y-2.5" data-holiday-filters=""> |         <p className="text-ds-17">{W.hubIntro}</p>\n        <div className="space-y-2.5" data-holiday-filters="">
 */
describe("Holiday Hub audit 1121 area 5: cost not listed, undated lights, prices, places, closed today, tap targets", () => {
  const today = "2026-11-20";
  const hub = (path = "/holidays") => render(<MemoryRouter initialEntries={[path]}><HolidayHub /></MemoryRouter>).container;

  it("items with no cost listed have their own Cost choice, and Free / Paid say how many they leave out", () => {
    const unlisted = filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { cost: "unlisted" }, today);
    expect(unlisted.length).toBeGreaterThan(20);
    expect(unlisted.every((i) => i.cost == null)).toBe(true);
    const free = filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { cost: "free" }, today).length;
    const paid = filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { cost: "paid" }, today).length;
    expect(free + paid + unlisted.length).toBe(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today).length);
    const c = hub("/holidays?cost=free");
    expect(c.querySelector("[data-holiday-unlisted]")?.textContent).toMatch(/plus \d+ with no cost listed/);
  });

  it("light displays with no date sit right after Happening now, not under Dates TBA", () => {
    const groups = holidayItemsByDay(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today), today);
    const keys = groups.map((g) => g.key);
    expect(keys.indexOf("lights-tba")).toBe(keys[0] === "now" ? 1 : 0);
    const tbaLights = groups.find((g) => g.key === "lights-tba")!.items;
    expect(tbaLights.length).toBeGreaterThan(40);
    expect(tbaLights.every((i) => isHolidayLight(i))).toBe(true);
    expect((groups.find((g) => g.key === "tba")?.items ?? []).some((i) => isHolidayLight(i))).toBe(false);
    // Polish audit 11-27 #15: on the page the undated displays and events share one band, "Dates not announced yet".
    expect(hub().querySelector("#holidays-undated")?.textContent).toContain("Dates not announced yet");
  });

  it("never shows a bare '$' as a price, and never repeats the city in the place line", () => {
    expect(holidayPriceLabel("$")).toBe("Paid");
    expect(holidayPriceLabel("$ (prix fixe)")).toBe("Paid (prix fixe)");
    expect(holidayPriceLabel("$ museum admission")).toBe("Museum admission");
    expect(holidayPriceLabel("$10 ages 2+")).toBe("$10 ages 2+");
    const c = hub();
    const prices = [...c.querySelectorAll("[data-holiday-price]")].map((e) => e.textContent ?? "");
    expect(prices.length).toBeGreaterThan(20);
    for (const p of prices) expect(p).not.toMatch(/^\$\s*(\(|$)|^\$ [a-z]/i);
    // Polish audit 11-27 #14: the place is its own line now (the Maps link), not shared with the dates.
    const places = [...c.querySelectorAll("[data-holiday-place]")].map((e) => e.textContent ?? "");
    expect(places.length).toBeGreaterThan(5);
    for (const w of places) {
      const [city, region] = w.split(" · ");
      if (region) expect(region.toLowerCase().startsWith(city.toLowerCase()), w).toBe(false);
    }
  });

  it("a one-day item whose simple hours range has closed leaves Today; one with only a start time stays", () => {
    const one = { tba: false, start: today, end: today, hours: "11 am-2 pm" };
    expect(endedEarlierToday(one, today, 13 * 60)).toBe(false);
    expect(endedEarlierToday(one, today, 14 * 60)).toBe(true);
    expect(endedEarlierToday({ ...one, hours: "5:30-7:30 pm" }, today, 19 * 60 + 31)).toBe(true);
    expect(endedEarlierToday({ ...one, hours: "6:30 pm" }, today, 23 * 60)).toBe(false);
    expect(endedEarlierToday({ ...one, hours: "Noon-7 pm; tree lighting" }, today, 23 * 60)).toBe(false);
    expect(endedEarlierToday({ ...one, end: "2026-11-22" }, today, 23 * 60)).toBe(false);
    // On the page: Nov 21 at 8 PM, La fete de Noel (11 am-2 pm) is gone from Today.
    vi.setSystemTime(new Date("2026-11-22T02:00:00Z"));
    const ids = [...hub().querySelectorAll("[data-holiday-item]")].map((e) => e.getAttribute("data-holiday-item"));
    expect(ids).not.toContain("E004");
    expect(ids.length).toBeGreaterThan(40);
  });

  it("the footer links are 44 px tap targets", () => {
    const c = hub();
    const page = c.querySelector('[data-holiday-page="hub"]')!;
    for (const href of ["/gift-guides/small-business-saturday#get-featured"]) {
      // The hub's own links (owner 11-22 #13: the guides' menu now sits beside the hub with its own "All guides" link).
      const a = [...page.querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`)].pop()!;
      expect(a.className, href).toMatch(/\bmin-h-11\b/);
    }
    // Owner 2026-11-22: no intro and no "Shopping too? See the holiday gift guides" line above the count; the count,
    // search and filter row is the page body's first block, right under the banner.
    expect(page.querySelector('a[href="/gift-guides"]')).toBeNull();
    expect(page.firstElementChild?.hasAttribute("data-holiday-filters")).toBe(true);
    expect(page.firstElementChild?.querySelector("[data-holiday-count]")).not.toBeNull();
    expect(page.firstElementChild?.querySelector("[data-holiday-search-button]")).not.toBeNull();
    expect(page.firstElementChild?.querySelector("[data-holiday-filters-button]")).not.toBeNull();
    expect(page.textContent).not.toContain("Christmas lights, parades, markets");
  });
});

/**
 * Holiday audit 1121 area 5 #20: When offers Today and Next 7 days beside This weekend.
 * @mutate src/content/holidayHub/holidayHub.mjs |   if (when === "week") return [today, addDays(today, 6)]; |
 * @mutate src/pages/info/holidays/HolidayHub.tsx | , { value: "week", label: "Next 7 days" }] | ]
 */
describe("Holiday Hub When: Today and Next 7 days", () => {
  it("Today keeps only what runs today; Next 7 days what runs from today through 6 days on", () => {
    const today = "2026-11-21";
    expect(whenRange("today", today)).toEqual([today, today]);
    expect(whenRange("week", today)).toEqual([today, "2026-11-27"]);
    const all = filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today);
    const day = filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { when: "today" }, today);
    const week = filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { when: "week" }, today);
    expect(day.length).toBeGreaterThan(5);
    expect(week.length).toBeGreaterThan(day.length);
    expect(all.length).toBeGreaterThan(week.length);
    for (const i of day) expect(runsBetween(i, today, today), i.id).toBe(true);
    for (const i of week) expect(runsBetween(i, today, "2026-11-27"), i.id).toBe(true);
    render(<MemoryRouter initialEntries={["/holidays?when=week"]}><HolidayHub /></MemoryRouter>);
    expect(document.querySelector('[data-holiday-active-chip="when"]')?.textContent).toContain("Next 7 days");
  });
});

/**
 * Holiday audit 1121 area 5 #20 (rest): a dated item goes into the visitor's calendar as an all-day .ics entry from
 * its own dates; an undated one has no button and no entry.
 * @mutate src/lib/holidayIcs.ts |   if (item.tba \|\| !item.start \|\| !/^\d{4}-\d{2}-\d{2}$/.test(item.start)) return null; |   if (!item.start) return null;
 * @mutate src/lib/holidayIcs.ts |     `DTEND;VALUE=DATE:${ymd(dayAfter(to))}`, |     `DTEND;VALUE=DATE:${ymd(to)}`,
 * @mutate src/lib/holidayIcs.ts | .replace(/;/g, "\\;") |
 * @mutate src/pages/info/holidays/holidayParts.tsx |         {item.start && !item.tba && ( |         {false && (
 */
/**
 * Polish audit 11-27 #15 (was guides polish 1122 #18): "Light displays, dates not announced (57)" and "Dates TBA (44)"
 * meant the same thing and every card in them said "Dates TBA" (~15,000px on a phone). One open band, "Dates not
 * announced yet (n)", right after the chosen day's list, of two-line rows (name / area · price · Map · Website), no
 * "Dates TBA" on any row; a When filter (dated by definition) shows none.
 * @mutate src/content/holidayHub/holidayHub.mjs |   undated: "Dates not announced yet", |   undated: "Dates TBA",
 * @mutate src/pages/info/holidays/HolidayHub.tsx |   const undated = undatedItems.length ? [{ key: "undated", day: null, items: undatedItems }] : []; |   const undated = groups.filter((g) => g.key === "lights-tba" \|\| g.key === "tba");
 * @mutate src/pages/info/holidays/HolidayHub.tsx |       {g.items.map((i) => <HolidayUndatedRow key={i.id} | {g.items.map((i) => <HolidayCard tag={null} key={i.id}
 * @mutate src/pages/info/holidays/HolidayHub.tsx |             {undated.map(section)} |             {null}
 * @mutate src/pages/info/holidays/HolidayHub.tsx | note={W.undatedNote} rows data= | note={W.undatedNote} data=
 */
describe("Holiday Hub: one undated band of two-line rows (polish audit 11-27 #15)", () => {
  it("one open band with a count right after the day's list; rows, not cards; no 'Dates TBA' anywhere", () => {
    const { container, unmount } = render(<MemoryRouter initialEntries={["/holidays"]}><HolidayHub /></MemoryRouter>);
    const band = container.querySelector<HTMLElement>("section[data-holiday-undated-section]")!;
    expect(band).not.toBeNull();
    expect(container.querySelector("section[data-holiday-lights-tba]")).toBeNull();
    expect(container.querySelector("#holidays-tba")).toBeNull();
    const head = band.querySelector("[data-holiday-section-toggle]")!;
    expect(head.getAttribute("aria-expanded")).toBe("true");
    const n = Number(/^Dates not announced yet \((\d+)\)$/.exec(head.textContent ?? "")?.[1]);
    expect(n).toBeGreaterThan(80);
    const rows = [...band.querySelectorAll<HTMLElement>("[data-holiday-undated]")];
    expect(rows.length).toBe(n);
    expect(band.querySelector("[data-holiday-rows]")).not.toBeNull();
    for (const r of rows) {
      expect(r.className, r.getAttribute("data-holiday-item")!).not.toMatch(/rounded|bg-card/);
      expect(r.querySelectorAll("p").length).toBe(1); // name, then one line
    }
    expect(band.textContent).not.toContain("Dates TBA");
    const dayList = container.querySelector("section[data-holiday-day-list]")!;
    expect(band.previousElementSibling).toBe(dayList);
    unmount();
    const week = render(<MemoryRouter initialEntries={["/holidays?when=week"]}><HolidayHub /></MemoryRouter>);
    expect(week.container.querySelector("section[data-holiday-undated-section]")).toBeNull();
  });
});

/**
 * Polish audit 11-27 #14: a card says one fact per line: the kind, the dates (no "2026"; ranges and "Mon D" never
 * split; never a line that starts with "·"), the hours and cost, then the place.
 * @mutate src/pages/info/holidays/holidayParts.tsx |     .replace(/,? 2026\b/g, "") |     .replace(/,? 2025\b/g, "")
 * @mutate src/pages/info/holidays/holidayParts.tsx | g, `${NB}· `) | g, " · ")
 * @mutate src/pages/info/holidays/holidayParts.tsx |     .replace(new RegExp(`\\b(${MONTH}) (?=\\d)`, "g"), `$1${NB}`); |     ;
 * @mutate src/pages/info/holidays/holidayParts.tsx |         <p className="text-ds-15 font-semibold text-foreground" data-holiday-when="">{holidayDatesDisplay(when)}</p> |         <p className="text-ds-15 font-semibold text-foreground" data-holiday-when="">{holidayWhereLabel(item)} · {when}</p>
 */
describe("Holiday Hub cards: one fact per line (polish audit 11-27 #14)", () => {
  it("holidayDatesDisplay drops 2026, keeps 2027, joins ranges and month-days, and hangs the separator", () => {
    const NB = "\u00a0";
    const WJ = "\u2060";
    expect(holidayDatesDisplay("Nov 27, 2026-Jan 1, 2027; closed Dec 7, 14, 24, 31")).toBe(`Nov${NB}27${NB}– Jan${NB}1, 2027${NB}· closed Dec${NB}7, 14, 24, 31`);
    expect(holidayDatesDisplay("Nov 27-28; Dec 4-5, 2026")).toBe(`Nov${NB}27${WJ}–${WJ}28${NB}· Dec${NB}4${WJ}–${WJ}5`);
    expect(holidayDatesDisplay("Fri Nov 27, 2026")).toBe(`Fri${NB}Nov${NB}27`);
    const every = [...HOLIDAY_LIGHTS, ...HOLIDAY_EVENTS].map((i) => i.dates).filter((d): d is string => Boolean(d));
    expect(every.length).toBeGreaterThan(80);
    for (const d of every) {
      const out = holidayDatesDisplay(d);
      expect(out, d).not.toMatch(/2026/);
      expect(out, d).not.toMatch(/(^| )·/); // a "·" always follows a non-breaking space, never a breaking one
      expect(out, d).not.toMatch(new RegExp("(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d"));
    }
  });

  it("each dated card: kind, then dates alone on their line, then hours and cost, then the place as the Maps link", () => {
    const { container } = render(<MemoryRouter initialEntries={["/holidays"]}><HolidayHub /></MemoryRouter>);
    const cards = [...container.querySelectorAll<HTMLElement>("[data-holiday-item]:not([data-holiday-undated])")];
    expect(cards.length).toBeGreaterThan(5);
    for (const c of cards) {
      const id = c.getAttribute("data-holiday-item")!;
      const when = c.querySelector("[data-holiday-when]")!;
      expect(when, id).not.toBeNull();
      expect(when.textContent, id).not.toMatch(/2026| · [A-Z][a-z]+ & /);
      expect(when.className).toMatch(/font-semibold/);
      const place = c.querySelector("[data-holiday-place]");
      if (place) expect(place.compareDocumentPosition(when) & Node.DOCUMENT_POSITION_PRECEDING, id).toBeTruthy();
    }
  });
});

describe("Holiday Hub: Add to calendar", () => {
  it("an all-day entry from the item's own first to last day (DTEND the day after), its text escaped", async () => {
    const { holidayIcs } = await import("@/lib/holidayIcs");
    const run = HOLIDAY_EVENTS.find((e) => e.start && e.end && e.end > e.start && !e.tba)!;
    const ics = holidayIcs(run, new Date("2026-11-21T18:00:00Z"))!;
    expect(ics).toContain(`DTSTART;VALUE=DATE:${run.start!.replace(/-/g, "")}`);
    const after = new Date(`${run.end}T12:00:00Z`);
    after.setUTCDate(after.getUTCDate() + 1);
    expect(ics).toContain(`DTEND;VALUE=DATE:${after.toISOString().slice(0, 10).replace(/-/g, "")}`);
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain(`UID:${run.id}@louisianahelpr.com`);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const odd = holidayIcs({ ...run, name: "Pie, Coffee; and Lights" }, new Date())!;
    expect(odd).toContain("SUMMARY:Pie\\, Coffee\\; and Lights");
    expect(holidayIcs({ ...run, tba: true }, new Date())).toBeNull();
    expect(holidayIcs({ ...run, start: null }, new Date())).toBeNull();
  });
  it("dated cards carry the button; undated ones do not", () => {
    const { container } = render(<MemoryRouter initialEntries={["/holidays"]}><HolidayHub /></MemoryRouter>);
    const items = [...HOLIDAY_LIGHTS, ...HOLIDAY_EVENTS];
    const cards = [...container.querySelectorAll("[data-holiday-item]")];
    let dated = 0;
    for (const c of cards) {
      const i = items.find((x) => x.id === c.getAttribute("data-holiday-item"))!;
      const has = Boolean(i.start && !i.tba);
      dated += has ? 1 : 0;
      expect(Boolean(c.querySelector("[data-holiday-ics]")), i.id).toBe(has);
    }
    expect(dated).toBeGreaterThan(5);
    expect(cards.length - dated).toBeGreaterThan(50);
  });
});

/**
 * Consistency audit 1122 #3 (Guide-consistency-audit-1122.md): the Hub's section headers ("Happening now (12)", the day
 * headings, "Light displays, dates not announced", "Later dates", "Dates TBA") are the guides' band header
 * (GuideSectionHead: a tinted band in the Hub's green with a left bar, "(n)" and a chevron), open on arrival, a tap
 * closing and reopening its section; the count line is the guides' count style (gg-itemcount: 12px/600, muted), not
 * the old 14px/400 line.
 * @mutate src/pages/info/holidays/holidayParts.tsx | count={count} tint="green" open={open} | count={count} tint="plain" open={open}
 * @mutate src/pages/info/holidays/holidayParts.tsx |         onToggle={() => setOpen((o) => !o)} data= |         onToggle={() => undefined} data=
 * @mutate src/pages/info/holidays/HolidayHub.tsx | "min-w-0 flex-1"} gg-itemcount !m-0` | "min-w-0 flex-1"} text-ds-14 text-muted-foreground`
 */
describe("Holiday Hub: the guides' band headers and count style (consistency audit 1122 #3)", () => {
  it("every section header is a green band button with (n), open on arrival; a tap closes and reopens it", () => {
    const { container } = render(<MemoryRouter initialEntries={["/holidays"]}><HolidayHub /></MemoryRouter>);
    const heads = [...container.querySelectorAll<HTMLElement>("[data-holiday-page] section > h2")];
    expect(heads.length).toBeGreaterThan(1); // the day's band and "Dates not announced yet" (polish audit 11-27 #15)
    for (const h of heads) {
      expect(h.className, h.textContent ?? "").toMatch(/\bgg-sec-toggle-h\b.*\bgg-sec-green\b/);
      const b = h.querySelector("button")!;
      expect(b.getAttribute("aria-expanded"), h.textContent ?? "").toBe("true");
      expect(h.querySelector("[data-gift-section-count]")!.textContent).toMatch(/^ \(\d+\)$/);
    }
    const first = heads[0].querySelector("button")!;
    const body = () => document.getElementById(first.getAttribute("aria-controls")!);
    expect(body()?.querySelector("[data-holiday-item]")).not.toBeNull();
    fireEvent.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(body()).toBeNull();
    fireEvent.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(body()?.querySelector("[data-holiday-item]")).not.toBeNull();
    const count = container.querySelector("[data-holiday-count]")!;
    expect(count.className).toMatch(/\bgg-itemcount\b/);
    expect(count.className).not.toMatch(/text-ds-14/);
  });
});

/**
 * Owner 2026-11-22 7:46 PM ("organize these better so you can see the ones that are happening each day below"; her pop-up
 * choice "Pick a day"): one sideways-scrolling row of 44px day chips under the count/search/filter row (Today, then every
 * day through the last dated day, the chosen one filled as the guides' chips), and below it EVERYTHING happening on the
 * chosen day (one-day events that date, multi-day events and dated light displays whose range covers it) under a band
 * "Today, Sunday, November 22 (n)", then the undated bands. Today (Louisiana) is chosen on arrival; the chosen day is in
 * the URL (?day=); a When filter narrows the chips; a search looks across every date (no chip pressed) and tapping a
 * day ends it.
 * @mutate src/content/holidayHub/holidayHub.mjs |   const on = items.filter((i) => runsBetween(i, day, day)); |   const on = items.filter((i) => i.start === day);
 * @mutate src/content/holidayHub/holidayHub.mjs |     if (range[1] < to) to = range[1]; |
 * @mutate src/content/holidayHub/holidayHub.mjs |   if (day === today) return "Today"; |
 * @mutate src/pages/info/holidays/HolidayHub.tsx |   const day = asked && days.includes(asked) ? asked : days[0] ?? null; |   const day = days[0] ?? null;
 * @mutate src/pages/info/holidays/HolidayHub.tsx |     set("day", d === today ? "all" : d); |     set("day", "all");
 * @mutate src/pages/info/holidays/HolidayHub.tsx | variant={on ? "default" : "outline"} size="sm" className="gg-chip shrink-0" | variant="outline" size="sm" className="gg-chip shrink-0"
 * @mutate src/pages/info/holidays/HolidayHub.tsx |               const on = !searching && d === day; |               const on = d === day;
 * @mutate src/pages/info/holidays/HolidayHub.tsx | className="-mx-1 flex min-w-0 gap-2 overflow-x-auto | className="-mx-1 flex min-w-0 flex-wrap gap-2
 * @mutate src/pages/info/holidays/HolidayHub.tsx |             active.length === 0 ? ( |             false ? (
 */
describe("Holiday Hub: Pick a day (owner 2026-11-22 7:46 PM)", () => {
  const today = "2026-11-22";
  const items = () => filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today);
  const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><HolidayHub /></MemoryRouter>).container;
  const shownIds = (c: HTMLElement, sel = "[data-holiday-day-list]") => [...c.querySelectorAll(`${sel} [data-holiday-item]`)].map((el) => el.getAttribute("data-holiday-item")!);
  beforeEach(() => vi.setSystemTime(new Date("2026-11-22T18:00:00Z")));

  it("the days: today through the last dated day, no gaps; When narrows them; a day lists every item running on it", () => {
    const all = items();
    const days = holidayDayChoices(all, today);
    expect(days[0]).toBe(today);
    const last = all.filter((i) => !i.tba && (i.start || i.end)).map((i) => (isOpenEnded(i) ? HOLIDAY_SEASON_END : i.end ?? i.start!)).sort().pop()!;
    expect(days[days.length - 1]).toBe(last);
    expect(days.length).toBeGreaterThan(30);
    for (let k = 1; k < days.length; k++) expect(days[k]).toBe(addDay(days[k - 1]));
    expect(holidayDayChoices(all, today, "today")).toEqual([today]);
    expect(holidayDayChoices(all, today, "week")).toHaveLength(7);
    expect(holidayDayChoices(all, "2026-11-23", "weekend")).toEqual(["2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(holidayDayChoices([], today)).toEqual([]);
    // Everything on Dec 5: one-day items that date, multi-day items covering it (lights and events), never undated.
    const dec5 = holidayItemsOn(all, "2026-12-05");
    expect(dec5.map((i) => i.id).sort()).toEqual(all.filter((i) => runsBetween(i, "2026-12-05", "2026-12-05")).map((i) => i.id).sort());
    expect(dec5.some((i) => i.start === "2026-12-05" && (i.end ?? i.start) === "2026-12-05")).toBe(true);
    expect(dec5.some((i) => i.start! < "2026-12-05" && !isHolidayLight(i))).toBe(true);
    expect(dec5.some((i) => isHolidayLight(i) && i.start! < "2026-12-05")).toBe(true);
    expect(dec5.every((i) => !i.tba)).toBe(true);
    // A day an event with gaps stops on (its `days`, guide audit 1123) counts as a start that day, like a one-day item.
    const startsDec5 = (i: (typeof dec5)[number]) => (i.start ?? i.end) === "2026-12-05" || Boolean(i.days?.includes("2026-12-05"));
    const firstRunning = dec5.findIndex((i) => !startsDec5(i));
    expect(dec5.slice(firstRunning).every((i) => !startsDec5(i))).toBe(true);
    expect(holidayDayChipLabel(today, today)).toBe("Today");
    expect(holidayDayChipLabel("2026-11-23", today)).toBe("Mon 23");
    expect(holidayDayChipLabel("2026-12-01", today)).toBe("Tue Dec 1");
  });

  it("on arrival: one row of 44px chips, Today chosen, today's band and its items; a tap picks a day and puts it in the URL", () => {
    const c = at("/holidays");
    const row = c.querySelector<HTMLElement>('[role="group"][aria-label="Pick a day"]')!;
    expect(row).not.toBeNull();
    expect(row.className).toMatch(/\boverflow-x-auto\b/);
    expect(row.className).not.toMatch(/flex-wrap/);
    // Right under the count, search and filter row.
    expect(c.querySelector("[data-holiday-filters]")!.nextElementSibling).toBe(row);
    const chips = [...row.querySelectorAll<HTMLButtonElement>("[data-holiday-day]")];
    expect(chips.map((b) => b.textContent).slice(0, 3)).toEqual(["Today", "Mon 23", "Tue 24"]);
    expect(chips.length).toBe(holidayDayChoices(items(), today).length);
    for (const b of chips) expect(b.className).toMatch(/\bh-11\b.*\bgg-chip\b|\bgg-chip\b.*\bh-11\b/);
    expect(chips.filter((b) => b.getAttribute("aria-pressed") === "true")).toEqual([chips[0]]);
    expect(chips[0].className).not.toEqual(chips[1].className);
    const head = () => c.querySelector("[data-holiday-day-list] h2")!.textContent;
    expect(head()).toBe(`Today, Sunday, November 22 (${holidayItemsOn(items(), today).length})`);
    expect(shownIds(c)).toEqual(holidayItemsOn(items(), today).map((i) => i.id));
    fireEvent.click(chips[2]);
    expect(new URLSearchParams(window.location.search).get("day")).toBe("2026-11-24");
    expect(head()).toBe(`Tuesday, November 24 (${holidayItemsOn(items(), "2026-11-24").length})`);
    expect(shownIds(c)).toEqual(holidayItemsOn(items(), "2026-11-24").map((i) => i.id));
    expect(chips[2].getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chips[0]);
    expect(new URLSearchParams(window.location.search).get("day")).toBeNull();
  });

  it("?day= opens that day (a day off the chips opens today); When narrows the chips; a search spans every date", () => {
    const shared = at("/holidays?day=2026-12-05");
    expect(shared.querySelector('[data-holiday-day="2026-12-05"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(shownIds(shared)).toEqual(holidayItemsOn(items(), "2026-12-05").map((i) => i.id));
    cleanup();
    const stale = at("/holidays?day=2026-01-01");
    expect(stale.querySelector("[data-holiday-day-list]")!.getAttribute("data-holiday-day-list")).toBe(today);
    cleanup();
    const one = at("/holidays?when=today");
    expect([...one.querySelectorAll("[data-holiday-day]")].map((b) => b.textContent)).toEqual(["Today"]);
    cleanup();
    const c = at("/holidays");
    fireEvent.click(c.querySelector("[data-holiday-search-button]")!);
    fireEvent.change(c.querySelector("[data-holiday-search]")!, { target: { value: "natchitoches" } });
    expect(c.querySelectorAll('[data-holiday-day][aria-pressed="true"]').length).toBe(0);
    expect(c.querySelector("[data-holiday-day-list]")).toBeNull();
    const hits = [...c.querySelectorAll("[data-holiday-item]")].map((e) => e.getAttribute("data-holiday-item")!);
    const expected = items().filter((i) => [i.name, i.city, i.address, i.region].join(" ").toLowerCase().includes("natchitoches"));
    expect(hits.sort()).toEqual(expected.map((i) => i.id).sort());
    expect(expected.some((i) => !runsBetween(i, today, today))).toBe(true);
    // A search with no match on any date says so and offers Clear search (polish audit 1122 #29).
    fireEvent.change(c.querySelector("[data-holiday-search]")!, { target: { value: "zzqx" } });
    expect(c.querySelector("[data-holiday-empty]")!.textContent).toContain('No lights or events match "zzqx".');
    expect(within(c.querySelector<HTMLElement>("[data-holiday-empty]")!).getByRole("button", { name: "Clear search" })).toBeTruthy();
    fireEvent.click(c.querySelector('[data-holiday-day="2026-11-23"]')!);
    expect(c.querySelector("[data-holiday-search]")).toBeNull();
    expect(c.querySelector("[data-holiday-day-list]")!.getAttribute("data-holiday-day-list")).toBe("2026-11-23");
  });
});
