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
 * @mutate src/pages/info/holidays/HolidayHub.tsx |             <p className={`${searchOpen ? "hh-count-open" : "min-w-0 flex-1"} text-ds-14 | <p hidden={searchOpen} className={`${searchOpen ? "hh-count-open" : "min-w-0 flex-1"} text-ds-14
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
 * @mutate src/pages/info/giftGuides/GiftGuidesSidebar.tsx |         <li><Link to="/holidays" data-gift-side-holiday-hub=""> |         <li><Link to="/help" data-gift-side-holiday-hub="">
 * @mutate src/pages/info/holidays/holidayParts.tsx |             onClick={() => track("holiday_maps_click", { kind, id: item.id, region: item.region })} |
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
  endedEarlierToday, whenRange, holidayItemsByDay, holidayLegacyHref, holidayMapsQuery, holidayPriceLabel, isHolidayLight, isOver, louisianaToday, resolveHolidayWhat, runsBetween,
  weekendRange,
} from "@/content/holidayHub/holidayHub.mjs";
import { holidayEventsLd, holidayHubBody, holidayHubLd, holidayLightsItemListLd } from "@/lib/holidayHubSeo.mjs";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import HolidayHub from "@/pages/info/holidays/HolidayHub";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

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
    expect(ids.length).toBe(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today).length);
    expect(ids.filter((id) => lightIds.has(id)).length).toBeGreaterThan(50);
    expect(ids.filter((id) => eventIds.has(id)).length).toBeGreaterThan(100);
    const headings = [...container.querySelectorAll("h2")].map((h) => h.textContent ?? "");
    expect(headings[0]).toMatch(/^Happening now/);
    expect(headings[headings.length - 1]).toMatch(/^Dates TBA/);
    expect(headings.some((h) => h.startsWith("Today, Friday, November 20"))).toBe(true);
    expect(container.querySelector("[data-holiday-count]")!.textContent).toMatch(/^\d+ light displays and \d+ events$/);
    expect(track).toHaveBeenCalledWith("page_view", { page: "holidays" });
  });

  it("filters start folded: plain search and filter icons (no words, no border), All / Lights / Events inside the panel", () => {
    // Owner 2026-11-21: "move all lights and events into filter, remove the circle around filter and leave just the
    // icons, add a search icon".
    const { container } = at("/holidays", <HolidayHub />);
    const button = container.querySelector("[data-holiday-filters-button]") as HTMLButtonElement;
    expect(button.textContent).toBe("");
    expect(button.getAttribute("aria-label")).toBe("Filters");
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
    expect(short.textContent).toBe(String(shownIds(container).length));
    // The soft field (the guides' own: 16px words, light ring) with the 44px ✕.
    expect(row.querySelector("[data-holiday-search-box]")!.className).toContain("gg-search rounded-xl focus-within:ring-2 focus-within:ring-[hsl(var(--bark)/0.22)]");
    fireEvent.change(input, { target: { value: "natchitoches" } });
    expect(count.querySelector(".hh-count-short")!.textContent).toBe(String(shownIds(container).length));
    const hits = shownIds(container);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(all);
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
    const cards = [...container.querySelectorAll("[data-holiday-item]")];
    expect(cards.length).toBeGreaterThan(100);
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
    expect(shownIds(container).sort()).toEqual(expected.map((i) => i.id).sort());
    expect(panel.querySelector('[data-holiday-what="lights"]')!.getAttribute("aria-pressed")).toBe("true");
    // The address bar follows (a shareable link) without a router navigation, which would remount the page and close
    // the panel under PageTransition's location.key.
    expect(new URLSearchParams(window.location.search).get("region")).toBe("baton-rouge");
    expect(new URLSearchParams(window.location.search).get("what")).toBe("lights");
    const show = within(panel).getByRole("button", { name: `Show ${expected.length} results` });
    fireEvent.click(show);
    expect(screen.queryByRole("dialog", { name: "Filters" })).toBeNull();
    expect(button.textContent).toBe("3"); // the icon and its count badge
    expect(button.getAttribute("aria-label")).toBe("Filters, 3 on");
  });

  it("a URL preset shows as removable chips with the count; removing one widens the list, Clear all empties them", () => {
    const { container } = at("/holidays?region=baton-rouge&cost=free&what=parade", <HolidayHub />);
    const chips = () => [...container.querySelectorAll("[data-holiday-active-chip]")].map((c) => c.textContent);
    expect(chips()).toEqual(["Parades", "Baton Rouge", "Free"]);
    expect(container.querySelector("[data-holiday-filter-count]")!.textContent).toBe("3");
    const parades = shownIds(container).map((id) => HOLIDAY_EVENTS.find((e) => e.id === id));
    expect(parades.length).toBeGreaterThan(3);
    expect(parades.every((e) => e?.category === "parade" && e.region === "baton-rouge" && e.cost === "free")).toBe(true);
    fireEvent.click(within(container).getByRole("button", { name: "Remove filter: Baton Rouge" }));
    expect(chips()).toEqual(["Parades", "Free"]);
    expect(shownIds(container).sort()).toEqual(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { what: "parade", cost: "free" }, today).map((i) => i.id).sort());
    fireEvent.click(container.querySelector("[data-holiday-filters-button]")!);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Filters" })).getByRole("button", { name: "Clear all" }));
    expect(container.querySelector("[data-holiday-active]")).toBeNull();
    expect(shownIds(container).length).toBe(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today).length);
  });

  it("This weekend lists only this weekend's lights and events; a filter set that matches nothing shows the empty state", () => {
    const { container, unmount } = at("/holidays?when=weekend", <HolidayHub />);
    const expected = filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, { weekend: true }, today).map((i) => i.id).sort();
    expect(shownIds(container).sort()).toEqual(expected);
    expect(within(container).queryByText(/^Dates TBA/)).toBeNull();
    unmount();
    const none = at("/holidays?what=reveillon&region=natchitoches&cost=free&when=weekend", <HolidayHub />);
    expect(none.container.querySelector("[data-holiday-empty]")).not.toBeNull();
    expect(none.container.querySelector("[data-holiday-count]")!.textContent).toBe("");
    fireEvent.click(within(none.container).getByRole("button", { name: "Clear filters" }));
    expect(shownIds(none.container).length).toBe(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today).length);
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
    expect(read("src/pages/info/giftGuides/GiftGuidesSidebar.tsx")).toContain('<Link to="/holidays" data-gift-side-holiday-hub="">');
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
 * @mutate src/pages/info/holidays/holidayParts.tsx |   const price = holidayPriceLabel(item.price); |   const price = item.price;
 * @mutate src/content/holidayHub/holidayHub.mjs |   if (region && region.toLowerCase().startsWith(item.city.toLowerCase())) return region; |
 * @mutate src/pages/info/holidays/HolidayHub.tsx |     }, today).filter((i) => !endedEarlierToday(i, today, minutes) && matchesQuery(i, query)), |     }, today).filter((i) => matchesQuery(i, query)),
 * @mutate src/pages/info/holidays/HolidayHub.tsx | <Link to="/gift-guides/small-business-saturday#get-featured" className="link-standard inline-flex min-h-11 items-center"> | <Link to="/gift-guides/small-business-saturday#get-featured" className="link-standard">
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
    expect(hub().querySelector("#holidays-lights-tba")?.textContent).toContain("Light displays, dates not announced");
  });

  it("never shows a bare '$' as a price, and never repeats the city in the place line", () => {
    expect(holidayPriceLabel("$")).toBe("Paid");
    expect(holidayPriceLabel("$ (prix fixe)")).toBe("Paid (prix fixe)");
    expect(holidayPriceLabel("$ museum admission")).toBe("Museum admission");
    expect(holidayPriceLabel("$10 ages 2+")).toBe("$10 ages 2+");
    const c = hub();
    const prices = [...c.querySelectorAll("[data-holiday-price]")].map((e) => e.textContent ?? "");
    expect(prices.length).toBeGreaterThan(50);
    for (const p of prices) expect(p).not.toMatch(/^\$\s*(\(|$)|^\$ [a-z]/i);
    const places = [...c.querySelectorAll("[data-holiday-item] h3 + p")].map((e) => e.textContent ?? "");
    expect(places.length).toBeGreaterThan(50);
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
    expect(ids.length).toBeGreaterThan(50);
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
 * @mutate src/lib/holidayIcs.ts |     `DTEND;VALUE=DATE:${ymd(dayAfter(last))}`, |     `DTEND;VALUE=DATE:${ymd(last)}`,
 * @mutate src/lib/holidayIcs.ts | .replace(/;/g, "\\;") |
 * @mutate src/pages/info/holidays/holidayParts.tsx |         {item.start && !item.tba && ( |         {false && (
 */
/**
 * Holiday audit 1121 area 5 #5 (rest): the days more than two weeks out and "Dates TBA" fold under one "Later dates"
 * (open on arrival since owner 2026-11-22: "make everything open expanded"); a When filter or a search shows every
 * group as a plain section.
 * @mutate src/pages/info/holidays/HolidayHub.tsx |   const folds = when === "all" && !query.trim(); |   const folds = false;
 * @mutate src/pages/info/holidays/HolidayHub.tsx |   const isLater = (g: (typeof groups)[number]) => folds && (g.key === "tba" \|\| (!!g.day && g.day > foldAfter)); |   const isLater = (g: (typeof groups)[number]) => folds && g.key === "tba";
 */
describe("Holiday Hub: Later dates fold", () => {
  const today = "2026-11-20";
  const at = (path: string, el: React.ReactElement) => render(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>);
  const shownIds = (c: HTMLElement) => [...c.querySelectorAll("[data-holiday-item]")].map((el) => el.getAttribute("data-holiday-item")!);
  it("days past two weeks and Dates TBA sit in Later dates (open on arrival); the next two weeks come first", () => {
    const { container, unmount } = at("/holidays", <HolidayHub />);
    const later = container.querySelector<HTMLDetailsElement>("details[data-holiday-later]")!;
    expect(later).not.toBeNull();
    expect(later.open).toBe(true);
    const inLater = [...later.querySelectorAll("h2")].map((h) => h.textContent ?? "");
    expect(inLater[inLater.length - 1]).toMatch(/^Dates TBA/);
    expect(inLater.some((h) => /December 2[0-9]/.test(h))).toBe(true);
    const open = [...container.querySelectorAll("h2")].filter((h) => !later.contains(h)).map((h) => h.textContent ?? "");
    expect(open[0]).toMatch(/^Happening now/);
    expect(open.some((h) => /December 2[0-9]/.test(h))).toBe(false);
    // Every item is still on the page (folded, not dropped).
    expect(shownIds(container).length).toBe(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today).length);
    unmount();
    const week = at("/holidays?when=week", <HolidayHub />);
    expect(week.container.querySelector("details[data-holiday-later]")).toBeNull();
  });
});

/**
 * Guides polish 1122 #18: the undated light displays sit in their own group (open on arrival since owner 2026-11-22),
 * after the dated days and before "Later dates", titled with their count and carrying the TBA note; a When filter shows
 * them as a normal section.
 * @mutate src/pages/info/holidays/HolidayHub.tsx |   const tbaLights = folds ? groups.find((g) => g.key === "lights-tba") : undefined; |   const tbaLights = folds ? undefined : groups.find((g) => g.key === "lights-tba");
 * @mutate src/content/holidayHub/holidayHub.mjs |   lightsTba: "Light displays, dates not announced", |   lightsTba: "Light displays",
 * @mutate src/pages/info/holidays/HolidayHub.tsx | <p className="text-ds-14 text-muted-foreground">{W.lightsTbaNote}</p> | <p></p>
 */
describe("Holiday Hub: undated lights fold (guides polish 1122 #18)", () => {
  it("an open group with a count and the note, after the dated days and before Later dates", () => {
    const { container, unmount } = render(<MemoryRouter initialEntries={["/holidays"]}><HolidayHub /></MemoryRouter>);
    const lights = container.querySelector<HTMLDetailsElement>("details[data-holiday-lights-tba]")!;
    expect(lights).not.toBeNull();
    expect(lights.open).toBe(true);
    expect(lights.querySelector("summary")!.textContent).toMatch(/^Light displays, dates not announced\(\d+\)$/);
    expect(lights.textContent).toContain("Dates TBA means the 2026 dates are not announced yet");
    const later = container.querySelector("details[data-holiday-later]")!;
    expect(lights.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const lastOpenDay = [...container.querySelectorAll("section h2")].filter((h) => !later.contains(h)).pop()!;
    expect(lastOpenDay.compareDocumentPosition(lights) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    const week = render(<MemoryRouter initialEntries={["/holidays?when=week"]}><HolidayHub /></MemoryRouter>);
    expect(week.container.querySelector("details[data-holiday-lights-tba]")).toBeNull();
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
    expect(dated).toBeGreaterThan(50);
  });
});
