/**
 * Louisiana Holiday Hub (owner-approved 2026-11-20): /holidays, /holidays/lights, /holidays/events and
 * /holidays/hire-a-helpr. The words, regions, categories and the plain rules both sides of each page share: the React
 * pages, and api/share.ts's pre-JavaScript body and JSON-LD (src/lib/holidayHubSeo.mjs). Plain dependency-free ESM so
 * the serverless function imports it with no build step. The data itself is lights.mjs and events.mjs beside this file,
 * each imported only by its own page's lazy chunk. Types: holidayHub.d.mts. Guard: src/test/holidayHub.test.tsx.
 */

export const HOLIDAY_HUB_PATH = "/holidays";
export const HOLIDAY_LIGHTS_PATH = "/holidays/lights";
export const HOLIDAY_EVENTS_PATH = "/holidays/events";
export const HOLIDAY_HIRE_PATH = "/holidays/hire-a-helpr";

/** Every page of the hub (routes, rewrites, sitemap and the meta table are checked against this list). */
export const HOLIDAY_HUB_PATHS = [HOLIDAY_HUB_PATH, HOLIDAY_LIGHTS_PATH, HOLIDAY_EVENTS_PATH, HOLIDAY_HIRE_PATH];

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

/** The last day an item runs (its end, else its start), or null when it has no confirmed date. */
function lastDay(item) {
  if (item.tba) return null;
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
  const last = item.end ?? item.start;
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

/** The lights page's filters. `way`: "drive" (drive-through, drive by, or both) or "walk" (walk-through or both). */
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

/** The lights grouped by region, in HOLIDAY_REGIONS order: confirmed dates first, then TBA, each by name. */
export function lightsByRegion(items) {
  const byName = (a, b) => Number(a.tba) - Number(b.tba) || a.name.localeCompare(b.name);
  return HOLIDAY_REGIONS.map((r) => ({ region: r, items: items.filter((l) => l.region === r.slug).sort(byName) })).filter((g) => g.items.length > 0);
}

/** The events page's filters. `weekend`: only events on this weekend's days (never a TBA one). */
export function filterEvents(items, { region = null, category = null, weekend = false } = {}, today) {
  const range = weekend && today ? weekendRange(today) : null;
  return items.filter((e) => {
    if (today && isOver(e, today)) return false;
    if (region && e.region !== region) return false;
    if (category && e.category !== category) return false;
    if (range && !runsBetween(e, range[0], range[1])) return false;
    return true;
  });
}

/**
 * The events as the page lists them: "Happening now" (started before today and still running), then one group per
 * start day from today on, then "Dates TBA". Each list by name. `day` is YYYY-MM-DD or null for the two others.
 */
export function eventsByDay(items, today) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const now = [];
  const days = new Map();
  const tba = [];
  for (const e of items) {
    if (e.tba || (!e.start && !e.end)) tba.push(e);
    else if ((e.start ?? today) < today) now.push(e);
    else {
      const day = e.start;
      days.set(day, [...(days.get(day) ?? []), e]);
    }
  }
  return [
    ...(now.length ? [{ key: "now", day: null, items: now.sort(byName) }] : []),
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
  hubIntro: "Christmas lights, parades, markets and holiday events across Louisiana for the 2026 season, and a local Helpr when you need an extra pair of hands.",
  lightsTitle: "Christmas lights in Louisiana",
  lightsCard: "Drive-throughs, park festivals and neighborhood displays, by region.",
  lightsIntro: "Drive-throughs, park light festivals and neighborhood displays across Louisiana for the 2026 season. Dates TBA means the 2026 dates are not announced yet; most house displays are lit most evenings in December.",
  eventsTitle: "Holiday events in Louisiana",
  eventsCard: "Parades, boat parades, markets, Santa, bonfires and Réveillon, by date.",
  eventsIntro: "Christmas parades, boat parades, markets, Santa visits, tree lightings, bonfires on the levee and Réveillon dinners across Louisiana, by date. Check with the organizer before you go: weather can change plans.",
  hireTitle: "Holiday help from a local Helpr",
  hireCard: "Lights hung, the house decorated and cleaned, the party set up and cleaned up.",
  hireIntro: "Hire a local Helpr for the holidays: hang the lights, decorate, clean before family comes, set up and clean up the party, wrap gifts, haul things away and get the yard ready for guests. Post the job and name your price.",
  checkFirst: "Dates and times can change. Check with the organizer before you go.",
};
