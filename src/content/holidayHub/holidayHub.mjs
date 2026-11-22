/**
 * Louisiana Holiday Hub (owner-approved 2026-11-20; one page 2026-11-21): /holidays (Christmas lights and holiday
 * events in one list, one set of filters, a slim "Hire a Helpr for the holidays" strip on top) and
 * /holidays/hire-a-helpr. The old /holidays/lights and /holidays/events redirect to /holidays with the matching filter
 * (owner 11-21: "put christmas lights and holiday events into 1"). The words, regions, categories and the plain rules
 * both sides of each page share: the React pages, and api/share.ts's pre-JavaScript body and JSON-LD
 * (src/lib/holidayHubSeo.mjs). Plain dependency-free ESM so the serverless function imports it with no build step. The
 * data itself is lights.mjs and events.mjs beside this file, imported only by the /holidays page's lazy chunk.
 * Types: holidayHub.d.mts. Guard: src/test/holidayHub.test.tsx.
 */

export const HOLIDAY_HUB_PATH = "/holidays";
export const HOLIDAY_HIRE_PATH = "/holidays/hire-a-helpr";

/** Every page of the hub (routes, rewrites, sitemap and the meta table are checked against this list). */
export const HOLIDAY_HUB_PATHS = [HOLIDAY_HUB_PATH, HOLIDAY_HIRE_PATH];

/** The two retired list pages (2026-11-21), each now a redirect to /holidays with its filter preset. */
const HOLIDAY_RETIRED_PAGES = { "/holidays/lights": "lights", "/holidays/events": "events" };

/** The regions, in the order the lists show them (the research's region names, shortened). */
export const HOLIDAY_REGIONS = [
  { slug: "acadiana", label: "Acadiana" },
  { slug: "baton-rouge", label: "Baton Rouge" },
  { slug: "new-orleans", label: "New Orleans & Northshore" },
  { slug: "lake-charles", label: "Lake Charles & SWLA" },
  { slug: "houma-thibodaux", label: "Houma-Thibodaux" },
  { slug: "alexandria", label: "Alexandria & Central" },
  { slug: "shreveport", label: "Shreveport-Bossier" },
  { slug: "monroe", label: "Monroe & NELA" },
  { slug: "natchitoches", label: "Natchitoches" },
];

/** The event kinds, in the order the filter shows them. */
export const HOLIDAY_EVENT_CATEGORIES = [
  { slug: "parade", label: "Parades" },
  { slug: "boat-parade", label: "Boat parades" },
  { slug: "market", label: "Markets" },
  { slug: "santa", label: "Santa" },
  { slug: "tree-lighting", label: "Tree lightings" },
  { slug: "bonfire", label: "Bonfires" },
  { slug: "reveillon", label: "Réveillon" },
  { slug: "concert", label: "Concerts" },
  { slug: "festival", label: "Festivals" },
  { slug: "fun-run", label: "Fun runs" },
];

/** The "What" filter on /holidays: everything, the light displays, every event, or one kind of event. */
export const HOLIDAY_WHAT = [
  { slug: "lights", label: "Christmas lights" },
  { slug: "events", label: "All events" },
  ...HOLIDAY_EVENT_CATEGORIES,
];

/** One event's kind, singular, for its card. */
export const HOLIDAY_EVENT_KIND = {
  parade: "Parade",
  "boat-parade": "Boat parade",
  market: "Market",
  santa: "Santa",
  "tree-lighting": "Tree lighting",
  bonfire: "Bonfire",
  reveillon: "Réveillon dinner",
  concert: "Concert",
  festival: "Festival",
  "fun-run": "Fun run",
};

/** How you see a light display. */
export const HOLIDAY_LIGHT_FORMAT = {
  "drive-through": "Drive-through",
  "drive-by": "Drive by",
  walk: "Walk-through",
  both: "Drive or walk",
};

/** Shown in place of a date when no 2026 date is confirmed (README: dates_tbc). */
export const DATES_TBA = "Dates TBA";

export function regionLabel(slug) {
  return HOLIDAY_REGIONS.find((r) => r.slug === slug)?.label ?? "";
}

/** The date line a card shows: the confirmed dates, or "Dates TBA". A TBA item never shows a date. */
export function holidayDateLabel(item) {
  return item.tba || !item.dates ? DATES_TBA : item.dates;
}

/** Today's date in Louisiana (America/Chicago), as YYYY-MM-DD. */
export function louisianaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(iso) {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/**
 * "This weekend" as [from, to] (YYYY-MM-DD): Friday to Sunday. From Friday through Sunday it runs from today to Sunday;
 * Monday to Thursday it is the coming Friday to Sunday.
 */
export function weekendRange(today) {
  const dow = weekday(today);
  if (dow === 0) return [today, today];
  if (dow >= 5) return [today, addDays(today, 7 - dow)];
  return [addDays(today, 5 - dow), addDays(today, 7 - dow)];
}

/**
 * The last day of the hub's season: an item that "Opens" on a day, or runs for "the season", with no end date published
 * stays listed through it (holiday audit 1121, High: Lafayette Holiday Market and Timber Ridge counted as over the day
 * after they opened, because a missing end read as a one-day item).
 */
export const HOLIDAY_SEASON_END = "2026-12-31";

/** Whether an item's date words say it keeps running after its start ("Opens Nov 21", "(season run)"). */
export const isOpenEnded = (item) => !item.tba && Boolean(item.start) && !item.end && /\bopens\b|\bseason\b/i.test(item.dates ?? "");

/** The last day an item runs (its end; an open-ended item, the season's end; else its start), or null with no date. */
function lastDay(item) {
  if (item.tba) return null;
  if (isOpenEnded(item)) return HOLIDAY_SEASON_END;
  return item.end ?? item.start ?? null;
}

/** Over: a confirmed item whose last day is before today. A TBA item is never over. */
export function isOver(item, today) {
  const last = lastDay(item);
  return last !== null && last < today;
}

/** True when a confirmed item runs on any day from `from` to `to`. A TBA item never does. */
export function runsBetween(item, from, to) {
  if (item.tba) return false;
  const first = item.start ?? item.end;
  const last = lastDay(item);
  if (!first || !last) return false;
  return first <= to && last >= from;
}

/** The text a maps search gets: the place's name and its address (with the town and LA when the address lacks them). */
export function holidayMapsQuery(item) {
  const address = (item.address ?? "").trim();
  const town = item.city ? `${item.city}, LA` : "Louisiana";
  const where = !address ? town : address.toLowerCase().includes((item.city ?? "").toLowerCase()) ? address : `${address}, ${town}`;
  return `${item.name}, ${where}`;
}

/** The lights' filters. `way`: "drive" (drive-through, drive by, or both) or "walk" (walk-through or both). */
export function filterLights(items, { region = null, way = null, cost = null } = {}, today) {
  return items.filter((l) => {
    if (today && isOver(l, today)) return false;
    if (region && l.region !== region) return false;
    if (way === "drive" && !["drive-through", "drive-by", "both"].includes(l.format)) return false;
    if (way === "walk" && !["walk", "both"].includes(l.format)) return false;
    if (cost && l.cost !== cost) return false;
    return true;
  });
}

/** The events' filters. `weekend`: only events on this weekend's days (never a TBA one). */
export function filterEvents(items, { region = null, category = null, cost = null, weekend = false } = {}, today) {
  const range = weekend && today ? weekendRange(today) : null;
  return items.filter((e) => {
    if (today && isOver(e, today)) return false;
    if (region && e.region !== region) return false;
    if (category && e.category !== category) return false;
    if (cost && e.cost !== cost) return false;
    if (range && !runsBetween(e, range[0], range[1])) return false;
    return true;
  });
}

/** True for a light display (lights carry `format`), false for an event (events carry `category`). */
export function isHolidayLight(item) {
  return !("category" in item);
}

/**
 * The "What" choice a URL asks for: `what`, or the retired events page's `kind` (an old shared link may carry it). A
 * known kind of event wins over the broad "events"; anything unknown is everything (null).
 */
export function resolveHolidayWhat(what, kind) {
  const known = (v) => Boolean(v) && HOLIDAY_WHAT.some((w) => w.slug === v);
  const isKind = (v) => Boolean(v) && HOLIDAY_EVENT_CATEGORIES.some((c) => c.slug === v);
  if (isKind(kind) && (!known(what) || what === "events")) return kind;
  return known(what) ? what : null;
}

/**
 * The /holidays list: the light displays and the events still running, narrowed by what (lights, events or one kind of
 * event), region, cost (free or paid) and this weekend (Friday to Sunday; a TBA item never shows on a weekend).
 */
export function filterHolidayItems(lights, events, { what = null, region = null, cost = null, weekend = false } = {}, today) {
  const showLights = !what || what === "lights";
  const category = what && what !== "lights" && what !== "events" ? what : null;
  const showEvents = what !== "lights";
  const range = weekend && today ? weekendRange(today) : null;
  const inWeekend = (i) => !range || runsBetween(i, range[0], range[1]);
  return [
    ...(showLights ? filterLights(lights, { region, cost }, today).filter(inWeekend) : []),
    ...(showEvents ? filterEvents(events, { region, category, cost, weekend }, today) : []),
  ];
}

/**
 * Where a retired list page sends you: /holidays with its filter preset, keeping the filters /holidays still has
 * (region, cost; when; the events page's kind becomes what). /holidays/lights -> /holidays?what=lights, /holidays/events
 * -> /holidays?what=events. The lights page's "drive or walk" filter is gone, so `way` is dropped.
 */
export function holidayLegacyHref(path, search = "") {
  const from = HOLIDAY_RETIRED_PAGES[path];
  if (!from) return HOLIDAY_HUB_PATH;
  const old = new URLSearchParams(search);
  const next = new URLSearchParams();
  next.set("what", from === "lights" ? "lights" : resolveHolidayWhat("events", old.get("kind")) ?? "events");
  for (const key of from === "lights" ? ["region", "cost"] : ["when", "region"]) {
    const v = old.get(key);
    if (v) next.set(key, v);
  }
  return `${HOLIDAY_HUB_PATH}?${next.toString()}`;
}

/** "82 light displays and 128 events", "1 light display", "3 events" or "Nothing" for the list's count line. */
export function holidayCountLabel(items) {
  const lights = items.filter(isHolidayLight).length;
  const events = items.length - lights;
  const parts = [
    ...(lights ? [`${lights} light ${lights === 1 ? "display" : "displays"}`] : []),
    ...(events ? [`${events} ${events === 1 ? "event" : "events"}`] : []),
  ];
  return parts.length ? parts.join(" and ") : "Nothing";
}

/**
 * The list as the page shows it, soonest first (owner 11-21: "sorted by happened soonest"): "Happening now" (started
 * before today, or with no start, and still running; the one closing soonest first, an open-ended one last), then one
 * group per start day from today on, then "Dates TBA". Items over before today never reach here (isOver). Within a day
 * and within TBA, by name. `day` is YYYY-MM-DD or null for the two others.
 */
export function holidayItemsByDay(items, today) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const closingSoonest = (a, b) => (a.end ?? "9999-12-31").localeCompare(b.end ?? "9999-12-31") || byName(a, b);
  const now = [];
  const days = new Map();
  const tba = [];
  for (const e of items) {
    if (e.tba || (!e.start && !e.end)) tba.push(e);
    else if (!e.start || e.start < today) now.push(e);
    else {
      const day = e.start;
      days.set(day, [...(days.get(day) ?? []), e]);
    }
  }
  return [
    ...(now.length ? [{ key: "now", day: null, items: now.sort(closingSoonest) }] : []),
    ...[...days.keys()].sort().map((day) => ({ key: day, day, items: days.get(day).sort(byName) })),
    ...(tba.length ? [{ key: "tba", day: null, items: tba.sort(byName) }] : []),
  ];
}

/** "Saturday, November 28" for a YYYY-MM-DD day ("Today, …" / "Tomorrow, …" when it is). */
export function holidayDayHeading(day, today) {
  const label = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
  if (today && day === today) return `Today, ${label}`;
  if (today && day === addDays(today, 1)) return `Tomorrow, ${label}`;
  return label;
}

/** The holiday jobs the hire page offers, each opening Post a job filled in (category from the real list). */
export const HOLIDAY_HELP = [
  { title: "Hang Christmas lights", body: "Roofline, trees and porch lights up, and taken down after New Year's.", category: "handyman" },
  { title: "Decorate the house", body: "The tree, the mantel, wreaths and the boxes back up to the attic.", category: "events" },
  { title: "Holiday cleaning", body: "A deep clean before family comes, or after the party.", category: "cleaning" },
  { title: "Party setup and cleanup", body: "Tables, chairs and decorations set out, then everything put back.", category: "events" },
  { title: "Wrap gifts", body: "Hand over the bags and get them back wrapped and labeled.", category: "errands" },
  { title: "Haul it away", body: "Old furniture, boxes and the tree after Christmas.", category: "moving" },
  { title: "Yard ready for guests", body: "Mow, rake, edge and pressure wash before company comes.", category: "yard_work" },
];

/** The hub's words (one place, read by the pages and the pre-JavaScript bodies alike). */
export const HOLIDAY_WORDS = {
  hubTitle: "Louisiana Holiday Hub",
  hubIntro: "Christmas lights, parades, markets and holiday events across Louisiana for the 2026 season, by date.",
  stripTitle: "Hire a Helpr for the holidays",
  stripLine: "Lights, decorating, cleaning and party setup.",
  stripCta: "Get holiday help",
  hireTitle: "Holiday help from a local Helpr",
  hireIntro: "Hire a local Helpr for the holidays: hang the lights, decorate, clean before family comes, set up and clean up the party, wrap gifts, haul things away and get the yard ready for guests. Post the job and name your price.",
  checkFirst: "Dates and times can change, so check with the organizer before you go. Dates TBA means the 2026 dates are not announced yet; most house displays are lit most evenings in December.",
};
