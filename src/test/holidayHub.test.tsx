/**
 * Louisiana Holiday Hub (owner-approved 2026-11-20): /holidays, /holidays/lights, /holidays/events and
 * /holidays/hire-a-helpr. Pins the routing on every layer (App.tsx lazy route, vercel.json's two rewrites, the sitemap,
 * the meta table, the document-scroll list, the footer and gift guides links, never the phone top nav), the data
 * (public fields only, the research's dates_tbc rule shown as "Dates TBA"), the filters (region, drive or walk, free or
 * paid; kind, region, this weekend), the pre-JS SEO (one H1 each, ItemList on lights, Event only for confirmed dates)
 * and the analytics (page_view, the Open in Maps click, no personal data).
 *
 * Red first (2026-11-20) against origin/main 4c37a03005: no route, no data, no page.
 *
 * @mutate src/content/holidayHub/holidayHub.mjs |   return item.tba \|\| !item.dates ? DATES_TBA : item.dates; |   return item.dates ?? DATES_TBA;
 * @mutate src/content/holidayHub/holidayHub.mjs |     if (range && !runsBetween(e, range[0], range[1])) return false; |
 * @mutate src/content/holidayHub/holidayHub.mjs |     if (cost && l.cost !== cost) return false; |
 * @mutate src/content/holidayHub/holidayHub.mjs |     if (way === "walk" && !["walk", "both"].includes(l.format)) return false; |
 * @mutate src/lib/holidayHubSeo.mjs |     .filter((e) => !e.tba && e.start) |     .filter((e) => Boolean(e))
 * @mutate src/App.tsx |       <Route path="/holidays/lights" element= |       <Route path="/holidays/lights-old" element=
 * @mutate src/components/Footer.tsx |               <Link to="/holidays" className={FOOTER_LINK}> |               <Link to="/help" className={FOOTER_LINK}>
 * @mutate src/pages/info/holidays/holidayParts.tsx |         onClick={() => track("holiday_maps_click", { kind, id: item.id, region: item.region })}> |         >
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
  DATES_TBA, HOLIDAY_HUB_PATHS, HOLIDAY_REGIONS, filterEvents, filterLights, holidayDateLabel, holidayMapsQuery, isOver,
  louisianaToday, runsBetween, weekendRange, eventsByDay,
} from "@/content/holidayHub/holidayHub.mjs";
import { holidayEventsLd, holidayHubBody, holidayHubLd, holidayLightsItemListLd } from "@/lib/holidayHubSeo.mjs";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import HolidayHub from "@/pages/info/holidays/HolidayHub";
import HolidayLights from "@/pages/info/holidays/HolidayLights";
import HolidayEvents from "@/pages/info/holidays/HolidayEvents";
import HolidayHire from "@/pages/info/holidays/HolidayHire";

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
    const groups = eventsByDay(all, today);
    expect(groups[groups.length - 1]?.key).toBe("tba");
    expect(groups.filter((g) => g.day).map((g) => g.day)).toEqual([...groups.filter((g) => g.day).map((g) => g.day)].sort());
  });

  it("the maps search carries the name and the address, with the town when the address lacks it", () => {
    expect(holidayMapsQuery({ name: "A", address: "1 Main St", city: "Sulphur" })).toBe("A, 1 Main St, Sulphur, LA");
    expect(holidayMapsQuery({ name: "A", address: "1 Main St, Sulphur, LA 70663", city: "Sulphur" })).toBe("A, 1 Main St, Sulphur, LA 70663");
    expect(holidayMapsQuery({ name: "A", address: null, city: "Sulphur" })).toBe("A, Sulphur, LA");
  });
});

describe("Holiday Hub pages", () => {
  const at = (path: string, el: React.ReactElement) => render(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>);

  it("/holidays: three cards (lights, events, hire) and one page_view", () => {
    const { container } = at("/holidays", <HolidayHub />);
    const cards = [...container.querySelectorAll("[data-holiday-card]")].map((a) => a.getAttribute("href"));
    expect(cards).toEqual(["/holidays/lights", "/holidays/events", "/holidays/hire-a-helpr"]);
    expect(track).toHaveBeenCalledWith("page_view", { page: "holidays" });
  });

  it("/holidays/lights: a TBA display says Dates TBA; ?region=&cost= filter the list; a chip changes it", () => {
    const { container } = at("/holidays/lights?region=baton-rouge&cost=free", <HolidayLights />);
    const items = [...container.querySelectorAll("[data-holiday-item]")];
    const expected = filterLights(HOLIDAY_LIGHTS, { region: "baton-rouge", cost: "free" }, "2026-11-20");
    expect(items.length).toBe(expected.length);
    expect(items.length).toBeGreaterThan(3);
    for (const el of items) {
      const l = HOLIDAY_LIGHTS.find((x) => x.id === el.getAttribute("data-holiday-item"))!;
      expect(l.region).toBe("baton-rouge");
      expect(l.cost).toBe("free");
      expect(el.querySelector("[data-holiday-when]")!.textContent).toBe(l.tba ? "Dates TBA" : l.dates);
    }
    expect(items.some((el) => el.querySelector("[data-holiday-when]")!.textContent === "Dates TBA")).toBe(true);
    // "Paid" narrows to the paid ones.
    fireEvent.click(container.querySelector('[data-holiday-cost="paid"]')!);
    const paid = [...container.querySelectorAll("[data-holiday-item]")].map((el) => HOLIDAY_LIGHTS.find((x) => x.id === el.getAttribute("data-holiday-item"))!);
    expect(paid.every((l) => l.cost === "paid" && l.region === "baton-rouge")).toBe(true);
    expect(container.querySelector('[data-holiday-cost="paid"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(track).toHaveBeenCalledWith("page_view", { page: "holidays_lights" });
  });

  it("Open in Maps: a plain maps search with the name, and a click event with no personal data", () => {
    const { container } = at("/holidays/lights?region=acadiana", <HolidayLights />);
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

  it("/holidays/events: This weekend lists only this weekend's events, grouped by day; TBA under Dates TBA", () => {
    const { container, unmount } = at("/holidays/events", <HolidayEvents />);
    const headings = [...container.querySelectorAll("h2")].map((h) => h.textContent ?? "");
    expect(headings[headings.length - 1]).toMatch(/^Dates TBA/);
    expect(headings.some((h) => h.startsWith("Today, Friday, November 20"))).toBe(true);
    unmount();
    const weekend = at("/holidays/events?when=weekend", <HolidayEvents />);
    const ids = [...weekend.container.querySelectorAll("[data-holiday-item]")].map((el) => el.getAttribute("data-holiday-item"));
    const expected = filterEvents(HOLIDAY_EVENTS, { weekend: true }, "2026-11-20").map((e) => e.id).sort();
    expect([...ids].sort()).toEqual(expected);
    expect(within(weekend.container).queryByText(/^Dates TBA/)).toBeNull();
    // A kind chip narrows further.
    fireEvent.click(weekend.container.querySelector('[data-holiday-kind="all"]')!);
    expect(weekend.container.querySelector('[data-holiday-when-filter="weekend"]')!.getAttribute("aria-pressed")).toBe("true");
  });

  it("/holidays/hire-a-helpr: Post a job and Find work, each holiday job opens Post a job filled in, and no ID prompt", () => {
    const { container } = at("/holidays/hire-a-helpr", <HolidayHire />);
    expect(container.querySelector("[data-holiday-post]")!.getAttribute("href")).toBe(`/signup?redirect=${encodeURIComponent("/post-job")}`);
    expect(container.querySelector("[data-holiday-find-work]")!.getAttribute("href")).toBe("/browse");
    const lights = container.querySelector('[data-holiday-help-post="Hang Christmas lights"]')!.getAttribute("href")!;
    expect(decodeURIComponent(lights)).toBe("/signup?redirect=/post-job?mm=1&cat=handyman&t=Hang+Christmas+lights");
    expect(container.querySelectorAll("[data-holiday-help]").length).toBe(7);
    expect(container.textContent).not.toMatch(/\bID\b|identity|verify your/i);
  });
});

describe("Holiday Hub routing, on every layer", () => {
  const app = read("src/App.tsx");
  const vercel = JSON.parse(raw("vercel.json")) as { rewrites: { source: string; destination: string }[] };
  const sitemap = raw("public/sitemap.xml");

  it("has its inventory", () => {
    expect(HOLIDAY_HUB_PATHS).toEqual(["/holidays", "/holidays/lights", "/holidays/events", "/holidays/hire-a-helpr"]);
  });

  it.each([
    ["/holidays", "HolidayHub"],
    ["/holidays/lights", "HolidayLights"],
    ["/holidays/events", "HolidayEvents"],
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

  it("document scroll, linked from the footer and the gift guides landing, never the phone top nav", () => {
    expect(read("src/hooks/useAppShellViewport.ts")).toMatch(/^\s*"\/holidays",/m);
    expect(read("src/components/Footer.tsx")).toContain('<Link to="/holidays" className={FOOTER_LINK}>');
    expect(read("src/pages/info/giftGuides/GiftGuideLanding.tsx")).toContain('<Link to="/holidays" className="gg-helpr-btn"');
    expect(read("src/components/Navbar.tsx")).not.toContain("/holidays");
  });

  it("each list's data loads only in its own page (the landing and the hire page import none)", () => {
    expect(read("src/pages/info/holidays/HolidayLights.tsx")).toContain('from "@/content/holidayHub/lights.mjs"');
    expect(read("src/pages/info/holidays/HolidayEvents.tsx")).toContain('from "@/content/holidayHub/events.mjs"');
    for (const f of ["HolidayHub", "HolidayHire", "holidayParts"]) expect(read(`src/pages/info/holidays/${f}.tsx`)).not.toMatch(/holidayHub\/(lights|events)\.mjs/);
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
    const lights = holidayHubBody("/holidays/lights", today)!;
    for (const l of filterLights(HOLIDAY_LIGHTS, {}, today).slice(0, 10)) expect(lights).toContain(l.name.replace(/&/g, "&amp;").replace(/'/g, "&#39;"));
    expect(lights).toContain("Dates TBA");
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
    expect(holidayHubLd("/holidays/events", today)!.length).toBe(1 + events.length);
  });
});
