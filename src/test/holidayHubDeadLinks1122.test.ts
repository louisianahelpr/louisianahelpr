/**
 * Guide audit, links and content 1122 night (Guide-audit-links-content-1122-night.md #1-#6): a Holiday Hub card's
 * Website link never goes to a taken-over or dead site. "Christmas in the Country" (E060, St. Francisville):
 * stfrancisvillefestivals.com now redirects through 4 hops to a gambling spam site (High); Dark Woods (L082), Ala Bayou
 * Terrebonne boat parade (E122) and Ruston Christmas Parade (E161) are 404s, Miracle on Fulton (L053) is down and
 * Christmas in Minden (E140) sits behind a password wall. Each has no link (url null: the card shows no Website link)
 * until a checked official page replaces it, and the bad addresses never return on any Hub item.
 * @mutate src/content/holidayHub/events.mjs | "id":"E060","name":"Christmas in the Country","region":"baton-rouge","city":"St. Francisville","address":"Commerce St & Burnett Rd, St. Francisville","lat":null,"lng":null,"dates":null,"start":null,"end":null,"hours":null,"price":"Free","cost":"free","category":"festival","url":null | "id":"E060","name":"Christmas in the Country","region":"baton-rouge","city":"St. Francisville","address":"Commerce St & Burnett Rd, St. Francisville","lat":null,"lng":null,"dates":null,"start":null,"end":null,"hours":null,"price":"Free","cost":"free","category":"festival","url":"https://stfrancisvillefestivals.com/"
 * @mutate src/content/holidayHub/lights.mjs | 4343 University Pkwy, Natchitoches","lat":null,"lng":null,"dates":null,"start":null,"end":null,"hours":null,"price":null,"cost":"paid","format":"drive-through","url":null | 4343 University Pkwy, Natchitoches","lat":null,"lng":null,"dates":null,"start":null,"end":null,"hours":null,"price":null,"cost":"paid","format":"drive-through","url":"https://darkwoodschristmas.com/"
 */
import { describe, expect, it } from "vitest";
import { HOLIDAY_LIGHTS } from "@/content/holidayHub/lights.mjs";
import { HOLIDAY_EVENTS } from "@/content/holidayHub/events.mjs";

const BAD_HOSTS = ["stfrancisvillefestivals.com", "darkwoodschristmas.com", "miracleonfulton.com", "holidaytrailoflights.com"];
const BAD_URLS = ["explorehouma.com/?p=1901", "rustonlincoln.com/events/ruston-christmas-parade"];

describe("Holiday Hub: no taken-over or dead Website links (links audit 1122 night)", () => {
  const items = [...HOLIDAY_LIGHTS, ...HOLIDAY_EVENTS];
  it("the six named items carry no link, and no Hub item links to a bad address", () => {
    expect(items.length).toBeGreaterThan(200);
    expect(items.filter((i) => i.url).length).toBeGreaterThan(80);
    for (const id of ["E060", "E122", "E140", "E161", "L053", "L082"]) {
      const i = items.find((x) => x.id === id);
      expect(i, id).toBeDefined();
      expect(i!.url, id).toBeNull();
    }
    const bad = items.filter((i) => i.url && (BAD_HOSTS.some((h) => new URL(i.url!).hostname.replace(/^www\./, "") === h) || BAD_URLS.some((u) => i.url!.includes(u))));
    expect(bad.map((i) => i.id)).toEqual([]);
  });
});
