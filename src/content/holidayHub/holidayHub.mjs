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

/** Minutes since midnight in Louisiana at `now`. */
export function louisianaMinutes(now = new Date()) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now).split(":").map(Number);
  return h * 60 + m;
}

/** "4", "4:30", "noon", "midnight" with an am/pm (or the range's own) -> minutes since midnight; null when unclear. */
function clockMinutes(t, fallbackHalf) {
  const s = t.trim().toLowerCase();
  if (s === "noon") return 12 * 60;
  if (s === "midnight") return 24 * 60;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  const half = m?.[3] ?? fallbackHalf;
  if (!m || !half || Number(m[1]) > 12) return null;
  return ((Number(m[1]) % 12) + (half === "pm" ? 12 : 0)) * 60 + Number(m[2] ?? 0);
}

/**
 * Whether a one-day item on `today` has already closed at `minutes` (Louisiana): only when its hours are one simple
 * range ("11 am-2 pm", "5:30-7:30 pm", "Noon-3 pm"); a start time alone, or hours with more after a ";", never ends it
 * early (holiday audit 1121 area 5 #10: at 8 PM "Today" still listed an 11 am-2 pm market).
 */
export function endedEarlierToday(item, today, minutes) {
  if (item.tba || item.start !== today || (item.end ?? item.start) !== today || !item.hours) return false;
  const m = /^\s*(noon|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–]\s*(noon|midnight|\d{1,2}(?::\d{2})?\s*(am|pm))\s*$/i.exec(item.hours);
  if (!m) return false;
  const end = clockMinutes(m[2], m[3]?.toLowerCase());
  return end !== null && end <= minutes;
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
  // An event with gaps in its dates (`days`) runs only on those days (guide audit 1123 #20 / I1: Cookies With Santa,
  // Sat Nov 21 and Sat Dec 12, was listed on every day between). Guard: src/test/guideAuditFixes1123.test.tsx.
  if (Array.isArray(item.days) && item.days.length) return item.days.some((d) => d >= from && d <= to);
  return first <= to && last >= from;
}

/** The text a maps search gets: the place's name and its address (with the town and LA when the address lacks them). */
export function holidayMapsQuery(item) {
  const address = (item.address ?? "").trim();
  const town = item.city ? `${item.city}, LA` : "Louisiana";
  const where = !address ? town : address.toLowerCase().includes((item.city ?? "").toLowerCase()) ? address : `${address}, ${town}`;
  return `${item.name}, ${where}`;
}

/**
 * Whether an item's cost passes the Cost filter: "free" / "paid" match their own; "unlisted" matches an item with no
 * cost listed (holiday audit 1121 area 5 #3: 47 items with no cost showed under neither Free nor Paid, and nothing said
 * so; they now have their own choice, and the count line names them).
 */
export const costMatches = (itemCost, cost) => !cost || (cost === "unlisted" ? itemCost == null : itemCost === cost);

/**
 * The price as a card shows it (holiday audit 1121 area 5 #7: a bare "$" read like a glitch): "$" alone -> "Paid",
 * "$ (Saturdays)" -> "Paid (Saturdays)"; anything else as written.
 */
export function holidayPriceLabel(price) {
  const s = (price ?? "").trim();
  if (!s) return null;
  if (/^\$+$/.test(s)) return "Paid";
  const m = /^\$+\s*(\(.*\))$/.exec(s);
  if (m) return `Paid ${m[1]}`;
  // "$ museum admission" -> "Museum admission".
  const words = /^\$+\s+([a-z].*)$/i.exec(s);
  return words ? words[1][0].toUpperCase() + words[1].slice(1) : s;
}

/** The card's place line: the city, then the region unless the region's name already starts with the city (#15). */
export function holidayWhereLabel(item) {
  const region = regionLabel(item.region);
  if (!item.city) return region ?? "";
  if (region && region.toLowerCase().startsWith(item.city.toLowerCase())) return region;
  return [item.city, region].filter(Boolean).join(" · ");
}

/** The lights' filters. `way`: "drive" (drive-through, drive by, or both) or "walk" (walk-through or both). */
export function filterLights(items, { region = null, way = null, cost = null } = {}, today) {
  return items.filter((l) => {
    if (today && isOver(l, today)) return false;
    if (region && l.region !== region) return false;
    if (way === "drive" && !["drive-through", "drive-by", "both"].includes(l.format)) return false;
    if (way === "walk" && !["walk", "both"].includes(l.format)) return false;
    if (!costMatches(l.cost, cost)) return false;
    return true;
  });
}

/** The events' filters. `weekend`: only events on this weekend's days (never a TBA one). */
/**
 * The When filter's days as [from, to] (YYYY-MM-DD), or null for all dates: "weekend" (Friday to Sunday), "today", or
 * "week" (today and the 6 days after; holiday audit 1121 area 5 #20 added Today and Next 7 days). `weekend: true` is the
 * old spelling of when "weekend".
 */
export function whenRange(when, today) {
  if (!today || !when) return null;
  if (when === "weekend") return weekendRange(today);
  if (when === "today") return [today, today];
  if (when === "week") return [today, addDays(today, 6)];
  return null;
}

export function filterEvents(items, { region = null, category = null, cost = null, weekend = false, when = null } = {}, today) {
  const range = whenRange(when ?? (weekend ? "weekend" : null), today);
  return items.filter((e) => {
    if (today && isOver(e, today)) return false;
    if (region && e.region !== region) return false;
    if (category && e.category !== category) return false;
    if (!costMatches(e.cost, cost)) return false;
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
export function filterHolidayItems(lights, events, { what = null, region = null, cost = null, weekend = false, when = null } = {}, today) {
  const showLights = !what || what === "lights";
  const category = what && what !== "lights" && what !== "events" ? what : null;
  const showEvents = what !== "lights";
  const days = when ?? (weekend ? "weekend" : null);
  const range = whenRange(days, today);
  const inWeekend = (i) => !range || runsBetween(i, range[0], range[1]);
  return [
    ...(showLights ? filterLights(lights, { region, cost }, today).filter(inWeekend) : []),
    ...(showEvents ? filterEvents(events, { region, category, cost, when: days }, today) : []),
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
 * group per start day from today on, then "Dates TBA" (light displays with no date come right after "Happening now", in
 * their own group, holiday audit 1121 area 5 #5). Items over before today never reach here (isOver). Within a day
 * and within TBA, by name. `day` is YYYY-MM-DD or null for the two others.
 */
export function holidayItemsByDay(items, today) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const closingSoonest = (a, b) => (a.end ?? "9999-12-31").localeCompare(b.end ?? "9999-12-31") || byName(a, b);
  const now = [];
  const days = new Map();
  const tba = [];
  // Holiday audit 1121 area 5 #5: 57 of 82 light displays have no 2026 date, and under "Dates TBA" they sat after every
  // dated event (47,000 px down on a phone); they get their own group right after "Happening now".
  const lightsTba = [];
  for (const e of items) {
    if ((e.tba || (!e.start && !e.end)) && isHolidayLight(e)) lightsTba.push(e);
    else if (e.tba || (!e.start && !e.end)) tba.push(e);
    else if (!e.start || e.start < today) now.push(e);
    else {
      const day = e.start;
      days.set(day, [...(days.get(day) ?? []), e]);
    }
  }
  return [
    ...(now.length ? [{ key: "now", day: null, items: now.sort(closingSoonest) }] : []),
    ...(lightsTba.length ? [{ key: "lights-tba", day: null, items: lightsTba.sort(byName) }] : []),
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

/**
 * The "Pick a day" chips (owner 2026-11-22 7:46 PM: "organize these better so you can see the ones that are happening
 * each day below"; her pop-up choice "Pick a day"): every day from today through the last day any dated item in `items`
 * runs (an open-ended one, the season's end), one chip each, no gaps. A When filter narrows the chips to its own days
 * (Today: today only; This weekend: Friday to Sunday; Next 7 days: today and the 6 after). No dated item: no chips.
 */
export function holidayDayChoices(items, today, when = null) {
  let last = null;
  for (const i of items) {
    const l = lastDay(i);
    if (l && (i.start ?? i.end) && (!last || l > last)) last = l;
  }
  if (!last || last < today) return [];
  const range = whenRange(when, today);
  let from = today;
  let to = last;
  if (range) {
    if (range[0] > from) from = range[0];
    if (range[1] < to) to = range[1];
  }
  const days = [];
  for (let d = from; d <= to && days.length < 400; d = addDays(d, 1)) days.push(d);
  return days;
}

/**
 * Everything happening on `day`: one-day items on that date, multi-day items whose range covers it, and the light
 * displays open that night (a dated range covering it). Undated items never. Those starting that day come first (by
 * name), then the ones already running, closing soonest first.
 */
export function holidayItemsOn(items, day) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const on = items.filter((i) => runsBetween(i, day, day));
  // A one-day stop of an event with gaps (`days`) is a fresh start that day, not a long run.
  const startsOn = (i) => (i.start ?? i.end) === day || (Array.isArray(i.days) && i.days.includes(day));
  const starts = on.filter(startsOn).sort(byName);
  const running = on.filter((i) => !startsOn(i))
    .sort((a, b) => (lastDay(a) ?? "9999-12-31").localeCompare(lastDay(b) ?? "9999-12-31") || byName(a, b));
  return [...starts, ...running];
}

/** A day chip's words: "Today", else "Mon 23" ("Tue Dec 1" on the first of a month). */
export function holidayDayChipLabel(day, today) {
  if (day === today) return "Today";
  const d = new Date(`${day}T12:00:00Z`);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(d);
  const md = d.getUTCDate();
  if (md === 1) return `${wd} ${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short" }).format(d)} 1`;
  return `${wd} ${md}`;
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
  lightsTba: "Light displays, dates not announced",
  lightsTbaNote: "Dates TBA means the 2026 dates are not announced yet. Most house displays are lit most evenings in December.",
  // Polish audit 11-27 #15: the one section for every item with no 2026 date yet (light displays and events).
  undated: "Dates not announced yet",
  undatedNote: "Most house displays are lit most evenings in December.",
  checkFirst: "Dates and times can change, so check with the organizer before you go. Dates TBA means the 2026 dates are not announced yet; most house displays are lit most evenings in December.",
};
