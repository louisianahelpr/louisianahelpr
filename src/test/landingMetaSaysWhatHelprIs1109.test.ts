/**
 * L012 (landing audit 11-09): the home page's description, og/twitter text, keywords and JSON-LD said Jobs only and
 * named New Orleans, Baton Rouge and Shreveport, while Helpr is jobs AND Declutter and its live listings are in New
 * Iberia (prod 11-09: 253 of 254 live listings say New Iberia, 1 New Iberia & Delcambre). Since the 11-09 subhead
 * ("Hire help, find work, or buy and sell") the head says the same, and no city Helpr is not busy in.
 * (publicRoutesServeOwnHead pins index.html's tags to LANDING_PAGE_META word for word.)
 *
 * @mutate src/lib/publicPageMeta.mjs |     "Hire help, find work, or buy and sell with real Louisiana neighbors. | "Hire a Helpr or find local work in Louisiana, New Orleans.
 * @mutate src/pages/info/Index.tsx |         text: "Helpr is open across Louisiana and busiest today in New Iberia and the towns around it.", |         text: "Helpr serves New Orleans, Baton Rouge and more.",
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LANDING_PAGE_META, LEGAL_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const NOT_HERE = /New Orleans|Baton Rouge|Shreveport/;

describe("L012: the home page's head says Jobs and Declutter, and only towns Helpr is in", () => {
  it("description and og text name buying and selling, and no far-off city", () => {
    for (const t of [LANDING_PAGE_META.description, LANDING_PAGE_META.ogDescription]) {
      expect(t.length).toBeGreaterThan(30);
      expect(t).toMatch(/buy and sell/);
      expect(t).not.toMatch(NOT_HERE);
    }
    expect(LANDING_PAGE_META.description).toMatch(/Declutter/);
  });

  it("index.html's keywords and LocalBusiness description, and the landing's schema, too", () => {
    const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
    const keywords = /<meta name="keywords" content="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(keywords).toMatch(/Declutter/);
    expect(keywords).not.toMatch(NOT_HERE);
    expect(/"@type": "LocalBusiness",[\s\S]*?"description": "([^"]+)"/.exec(html)?.[1]).toMatch(/Declutter/);
    const index = blankComments(readFileSync(resolve(ROOT, "src/pages/info/Index.tsx"), "utf8"));
    expect(index).toMatch(/Declutter/);
    expect(index).not.toMatch(NOT_HERE);
  });

  it("the Terms' description no longer names membership tiers (retired 11-04, L029)", () => {
    expect(LEGAL_PAGE_META.terms.description).not.toMatch(/membership tiers/);
  });
});
