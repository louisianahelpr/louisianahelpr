// Board 6 (Explore · Jobs · Browse): the "Farther away" divider and the hero
// card's picture band. (Its category-group chip row was removed by the owner
// 2026-10-21: categories live only in the filter sheet; src/test/browseCategoryGroups.test.tsx.)
// @mutate src/pages/home/fartherAwaySplit.ts | if (miles != null && miles > NEARBY_MILES) { | if (miles != null && miles > NEARBY_MILES * 100) {
// @mutate src/components/dashboard/JobCardHeroBand.tsx |   if (!photo) return null; |   if (false) return null;
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NEARBY_MILES, splitFartherAway } from "@/pages/home/fartherAwaySplit";
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
    expect(splitFartherAway(jobs, null, null)).toEqual({ ordered: jobs, fartherFrom: null, label: null });
    expect(splitFartherAway([job("x", "Caddo")], LAF.lat, LAF.lng).fartherFrom).toBeNull();
    const many = Array.from({ length: 30 }, (_, i) => job(`j${i}`, i % 2 ? "Caddo" : "Lafayette"));
    const out = splitFartherAway(many, LAF.lat, LAF.lng).ordered.map((j) => j.id).sort();
    expect(out).toEqual(many.map((j) => j.id).sort());
    expect(out.length).toBeGreaterThan(20);
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
