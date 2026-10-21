// Board 6 (Explore · Jobs · Browse): the "Farther away" divider and the hero
// card's picture band. (Its category-group chip row was removed by the owner
// 2026-10-21: categories live only in the filter sheet; src/test/browseCategoryGroups.test.tsx.)
// @mutate src/pages/home/fartherAwaySplit.ts | if (miles != null && miles > NEARBY_MILES) { | if (miles != null && miles > NEARBY_MILES * 100) {
// @mutate src/components/dashboard/JobCardHeroBand.tsx |   if (!photo) return null; |   if (false) return null;
// Quiet near you (owner 2026-10-21):
// @mutate src/pages/home/fartherAwaySplit.ts |   if (near.length < QUIET_NEAR_MIN) { |   if (near.length < 0) {
// @mutate src/pages/home/fartherAwaySplit.ts |     const band = far.filter((f) => f.miles <= QUIET_MAX_MILES).sort((a, b) => a.miles - b.miles); |     const band = far.filter((f) => f.miles <= QUIET_MAX_MILES);
// @mutate src/pages/home/fartherAwaySplit.ts |   return place ? `~${Math.round(miles)} mi away · ${place}` : `~${Math.round(miles)} mi away`; |   return "";
// @mutate src/components/dashboard/BrowseTasksFeed.tsx |                 splitFarther={filters.sortBy === "smart" && filters.nearbyMiles === null} |                 splitFarther={filters.sortBy === "smart"}
// @mutate src/components/dashboard/MainFeedSection.tsx |                 {QUIET_LINE} |                 {null}
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NEARBY_MILES, QUIET_LINE, QUIET_MAX_MILES, QUIET_NEAR_MIN, splitFartherAway } from "@/pages/home/fartherAwaySplit";
import { PARISH_CENTROIDS } from "@/lib/parishCentroids";
import { haversineMiles, tripMiles } from "@/lib/geo";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { JobCardHeroBand } from "@/components/dashboard/JobCardHeroBand";

// The viewer stands on Lafayette parish's centroid.
const LAF = { lat: 30.2241, lng: -92.0198 };
const job = (id: string, parish: string | null) => ({ id, parish, location: null });

describe("board 6: Farther away divider", () => {
  it("puts jobs beyond 25 mi after a divider whose range comes from the real distances", () => {
    const jobs = [job("far1", "Caddo"), job("near1", "Lafayette"), job("near2", "Lafayette"), job("unknown", null)];
    const s = splitFartherAway(jobs, LAF.lat, LAF.lng);
    expect(s.ordered.map((j) => j.id)).toEqual(["near1", "near2", "unknown", "far1"]);
    expect(s.fartherFrom).toBe(3);
    // Caddo is ~180 mi from Lafayette: over 100, so the label names no made-up top end.
    expect(s.label).toBe(`Farther away · over ${NEARBY_MILES} mi`);
  });

  it("names the top of the range when it is close ('Farther away · 25–N mi')", () => {
    const s = splitFartherAway([job("a", "Lafayette"), job("b", "East Baton Rouge")], LAF.lat, LAF.lng);
    expect(s.label).toMatch(/^Farther away · 25–\d+ mi$/);
    expect(s.ordered.map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("never loses or invents a job, and draws no divider without a location or a near/far mix", () => {
    const jobs = [job("x", "Caddo"), job("y", "Lafayette")];
    expect(splitFartherAway(jobs, null, null)).toEqual({ ordered: jobs, fartherFrom: null, label: null, quietFrom: null, distanceLabels: new Map() });
    expect(splitFartherAway([job("x", "Caddo")], LAF.lat, LAF.lng).fartherFrom).toBeNull();
    const many = Array.from({ length: 30 }, (_, i) => job(`j${i}`, i % 2 ? "Caddo" : "Lafayette"));
    const out = splitFartherAway(many, LAF.lat, LAF.lng).ordered.map((j) => j.id).sort();
    expect(out).toEqual(many.map((j) => j.id).sort());
    expect(out.length).toBeGreaterThan(20);
  });
});

describe("quiet near you: farther jobs up to 50 mi, nearest first, with their distance (owner 2026-10-21)", () => {
  // Parishes by their real centroid distance from the viewer (Lafayette's centroid), measured, not assumed.
  const milesTo = (p: string) => tripMiles(haversineMiles(LAF.lat, LAF.lng, PARISH_CENTROIDS[p].lat, PARISH_CENTROIDS[p].lng))!;
  const parishes = Object.keys(PARISH_CENTROIDS);
  const band = parishes.filter((p) => milesTo(p) > NEARBY_MILES && milesTo(p) <= QUIET_MAX_MILES).sort((a, b) => milesTo(a) - milesTo(b));
  const beyond = parishes.filter((p) => milesTo(p) > QUIET_MAX_MILES + 10);
  const near = (n: number) => Array.from({ length: n }, (_, i) => job(`near${i}`, "Lafayette"));

  it("has real parishes in the 25-50 mi band to test with", () => {
    expect(band.length).toBeGreaterThan(2);
    expect(beyond.length).toBeGreaterThan(2);
  });

  it("fewer than 5 near: the 25-50 mi jobs come right after them, nearest first, each labelled; beyond 50 keeps the divider", () => {
    const farthest = band[band.length - 1], closest = band[0];
    const jobs = [job("far-beyond", beyond[0]), job("b-far", farthest), ...near(QUIET_NEAR_MIN - 1), job("b-close", closest)];
    const s = splitFartherAway(jobs, LAF.lat, LAF.lng);
    expect(s.quietFrom).toBe(QUIET_NEAR_MIN - 1);
    expect(s.ordered.slice(s.quietFrom!).map((j) => j.id)).toEqual(["b-close", "b-far", "far-beyond"]);
    expect(s.distanceLabels.get("b-close")).toBe(`~${Math.round(milesTo(closest))} mi away · ${closest}`);
    expect(s.distanceLabels.get("b-far")).toMatch(/^~\d+ mi away · /);
    expect(s.distanceLabels.has("far-beyond")).toBe(false);
    expect(s.fartherFrom).toBe(s.quietFrom! + 2);
    expect(s.label).toMatch(/^Farther away · (50–\d+|over 50) mi$/);
    // Nothing hidden, nothing invented.
    expect(s.ordered.map((j) => j.id).sort()).toEqual(jobs.map((j) => j.id).sort());
    expect(QUIET_LINE).toBe("Showing jobs farther out while it's quiet near you");
  });

  it("5 or more near: no quiet band, no labels (the plain divider as before)", () => {
    const s = splitFartherAway([...near(QUIET_NEAR_MIN), job("b", band[0])], LAF.lat, LAF.lng);
    expect(s.quietFrom).toBeNull();
    expect(s.distanceLabels.size).toBe(0);
    expect(s.fartherFrom).toBe(QUIET_NEAR_MIN);
  });

  it("a distance filter the member set is never widened: the feed only splits with no radius and the default order", () => {
    const feed = blankComments(readFileSync(resolve(__dirname, "../components/dashboard/BrowseTasksFeed.tsx"), "utf8"));
    expect(feed).toMatch(/splitFarther=\{filters\.sortBy === "smart" && filters\.nearbyMiles === null\}/);
    const section = blankComments(readFileSync(resolve(__dirname, "../components/dashboard/MainFeedSection.tsx"), "utf8"));
    expect(section).toMatch(/\{QUIET_LINE\}/);
    expect(section).toMatch(/split\.distanceLabels\.get\(job\.id\)/);
  });
});

describe("board 6: hero picture band", () => {
  it("shows the job's own photo, and nothing at all without one (no empty block, no stock picture)", () => {
    const { container, rerender } = render(<JobCardHeroBand photo="https://x.test/p.jpg" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://x.test/p.jpg");
    rerender(<JobCardHeroBand photo={null} />);
    expect(container.innerHTML).toBe("");
  });
});
