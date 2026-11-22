/**
 * The Louisiana Holiday Hub's pre-JavaScript bodies and JSON-LD (owner-approved 2026-11-20; owner 11-19: show up for
 * every search Louisiana Helpr relates to). api/share.ts serves them for /holidays (lights and events in one list since
 * 2026-11-21) and /holidays/hire-a-helpr, the same way it serves the gift guides (src/lib/seoBodies.mjs): plain semantic HTML inside
 * #root that React replaces on its first render, and the page's JSON-LD in <head>. Built from the same data the pages
 * read, so the two never disagree: an ItemList of the light displays, and an Event for each event whose 2026 date
 * is confirmed (never a "Dates TBA" one). Plain dependency-free ESM (no Vite in the function). Types: holidayHubSeo.d.mts.
 * Guard: src/test/holidayHub.test.tsx.
 */
import { SEO_SITE_ORIGIN, breadcrumbLd, escapeHtml, seoPageBody } from "./seoBodies.mjs";
import { HOLIDAY_LIGHTS } from "../content/holidayHub/lights.mjs";
import { HOLIDAY_EVENTS } from "../content/holidayHub/events.mjs";
import {
  HOLIDAY_EVENT_KIND, HOLIDAY_HELP, HOLIDAY_HIRE_PATH, HOLIDAY_HUB_PATH, HOLIDAY_LIGHT_FORMAT, HOLIDAY_WORDS as W, DATES_TBA,
  filterEvents, filterHolidayItems, filterLights, holidayDateLabel, holidayDayHeading, holidayItemsByDay, holidayPriceLabel, isHolidayLight,
} from "../content/holidayHub/holidayHub.mjs";

const HOME = { name: "Louisiana Helpr", path: "/" };
const HUB = { name: W.hubTitle, path: HOLIDAY_HUB_PATH };
const PAGES = {
  [HOLIDAY_HUB_PATH]: [HOME, HUB],
  [HOLIDAY_HIRE_PATH]: [HOME, HUB, { name: "Hire a Helpr for the holidays", path: HOLIDAY_HIRE_PATH }],
};

/** One light or event as a line: its name, the town, when (or "Dates TBA"), hours, cost and a line about it. */
function itemLine(item, tag) {
  const bits = [item.city, holidayDateLabel(item), item.hours, holidayPriceLabel(item.price), item.note].filter(Boolean).map(escapeHtml);
  return `<li><strong>${escapeHtml(item.name)}</strong>${tag ? ` (${escapeHtml(tag)})` : ""}${bits.length ? `: ${bits.join(". ")}` : ""}</li>`;
}

/** A light's tag: that it is a light display and how you see it; an event's: its kind. */
const tagFor = (item) =>
  isHolidayLight(item) ? (item.format ? `Christmas lights, ${HOLIDAY_LIGHT_FORMAT[item.format]}` : "Christmas lights") : HOLIDAY_EVENT_KIND[item.category];

/** The body for a hub path, or null for any other path. `today` is Louisiana's YYYY-MM-DD. */
export function holidayHubBody(path, today) {
  if (!Object.prototype.hasOwnProperty.call(PAGES, path)) return null;
  const crumbs = PAGES[path];
  if (path === HOLIDAY_HUB_PATH) {
    const groups = holidayItemsByDay(filterHolidayItems(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, {}, today), today);
    const sections = groups
      .map((g) => `<h2>${escapeHtml(g.day ? holidayDayHeading(g.day, today) : g.key === "now" ? "Happening now" : g.key === "lights-tba" ? W.lightsTba : DATES_TBA)}</h2><ul>${g.items.map((i) => itemLine(i, tagFor(i))).join("")}</ul>`)
      .join("");
    return seoPageBody(crumbs, `<h1>${escapeHtml(W.hubTitle)}</h1><p>${escapeHtml(W.hubIntro)}</p>` +
      `<p><a href="${HOLIDAY_HIRE_PATH}">${escapeHtml(W.stripTitle)}</a>: ${escapeHtml(W.stripLine)}</p>` +
      `${sections}<p>${escapeHtml(W.checkFirst)}</p><p><a href="/gift-guides">Holiday gift guides</a></p>`);
  }
  const help = HOLIDAY_HELP.map((h) => `<li><strong>${escapeHtml(h.title)}</strong>: ${escapeHtml(h.body)}</li>`).join("");
  return seoPageBody(crumbs, `<h1>${escapeHtml(W.hireTitle)}</h1><p>${escapeHtml(W.hireIntro)}</p><h2>What a Helpr can do</h2><ul>${help}</ul>` +
    `<p><a href="/post-job">Post a job</a> · <a href="/browse">Find work near you</a></p>` +
    `<ul><li><a href="${HOLIDAY_HUB_PATH}">Christmas lights and holiday events in Louisiana</a></li><li><a href="/gift-guides">Holiday gift guides</a></li></ul>`);
}

function postalAddress(item) {
  return {
    "@type": "PostalAddress",
    ...(item.address ? { streetAddress: item.address } : {}),
    ...(item.city ? { addressLocality: item.city } : {}),
    addressRegion: "LA",
    addressCountry: "US",
  };
}

function place(item, name) {
  return {
    "@type": "Place",
    name,
    address: postalAddress(item),
    ...(typeof item.lat === "number" && typeof item.lng === "number" ? { geo: { "@type": "GeoCoordinates", latitude: item.lat, longitude: item.lng } } : {}),
  };
}

/** ItemList of every light display still running (places; no dates, which many displays lack). */
export function holidayLightsItemListLd(today) {
  const items = filterLights(HOLIDAY_LIGHTS, {}, today);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Christmas lights in Louisiana",
    url: `${SEO_SITE_ORIGIN}${HOLIDAY_HUB_PATH}?what=lights`,
    numberOfItems: items.length,
    itemListElement: items.map((l, i) => ({ "@type": "ListItem", position: i + 1, item: place(l, l.name) })),
  };
}

/** An Event for each event with a confirmed 2026 date that is not over. A "Dates TBA" event gets none. */
export function holidayEventsLd(today) {
  return filterEvents(HOLIDAY_EVENTS, {}, today)
    .filter((e) => !e.tba && e.start)
    .map((e) => ({
      "@context": "https://schema.org",
      "@type": "Event",
      name: e.name,
      startDate: e.start,
      ...(e.end ? { endDate: e.end } : {}),
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: place(e, (e.address ?? "").split(",")[0].trim() || e.city || "Louisiana"),
      description: e.note ?? `${HOLIDAY_EVENT_KIND[e.category]} in ${e.city ?? "Louisiana"}.`,
      url: e.url ?? `${SEO_SITE_ORIGIN}${HOLIDAY_HUB_PATH}`,
      ...(e.cost === "free" ? { isAccessibleForFree: true } : {}),
    }));
}

/** Every JSON-LD block a hub path carries (breadcrumb first), or null for any other path. */
export function holidayHubLd(path, today) {
  if (!Object.prototype.hasOwnProperty.call(PAGES, path)) return null;
  const crumbs = breadcrumbLd(PAGES[path]);
  if (path === HOLIDAY_HUB_PATH) return [crumbs, holidayLightsItemListLd(today), ...holidayEventsLd(today)];
  return [crumbs];
}
