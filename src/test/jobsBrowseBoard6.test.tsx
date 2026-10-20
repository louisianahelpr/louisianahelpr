// Board 6 (Explore · Jobs · Browse): the category-group chip row, the
// "Farther away" divider, and the hero card's picture band.
// @mutate src/pages/home/fartherAwaySplit.ts | if (miles != null && miles > NEARBY_MILES) { | if (miles != null && miles > NEARBY_MILES * 100) {
// @mutate src/components/dashboard/JobGroupChips.tsx | setSelectedCategory(on ? null : g.items[0].value); | setOpenGroup(g.id);
// @mutate src/components/dashboard/JobCardHeroBand.tsx | {photo ? ( | {false ? (
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NEARBY_MILES, splitFartherAway } from "@/pages/home/fartherAwaySplit";
import { JobGroupChips } from "@/components/dashboard/JobGroupChips";
import { JobCardHeroBand } from "@/components/dashboard/JobCardHeroBand";
import { JOB_CATEGORY_GROUPS } from "@/lib/jobCategoryGroups";

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

describe("board 6: category group chips", () => {
  const setup = (selected: string | null = null, open: string | null = null) => {
    const setSelectedCategory = vi.fn();
    const setOpenGroup = vi.fn();
    render(
      <JobGroupChips
        selectedCategory={selected}
        setSelectedCategory={setSelectedCategory}
        openGroup={open as never}
        setOpenGroup={setOpenGroup}
      />,
    );
    return { setSelectedCategory, setOpenGroup };
  };

  it("lists All first, then every group", () => {
    setup();
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels[0]).toBe("All");
    expect(labels.slice(1)).toEqual(JOB_CATEGORY_GROUPS.map((g) => g.label));
    expect(labels.length).toBeGreaterThan(5);
  });

  it("a one-category group picks that category; a bigger group opens its sub-chips", () => {
    const one = JOB_CATEGORY_GROUPS.find((g) => g.items.length === 1)!;
    const big = JOB_CATEGORY_GROUPS.find((g) => g.items.length > 1)!;
    const { setSelectedCategory, setOpenGroup } = setup();
    fireEvent.click(screen.getByRole("button", { name: one.label }));
    expect(setSelectedCategory).toHaveBeenCalledWith(one.items[0].value);
    fireEvent.click(screen.getByRole("button", { name: big.label }));
    expect(setOpenGroup).toHaveBeenCalledWith(big.id);
  });

  it("an open group's sub-chip picks the real category value", () => {
    const big = JOB_CATEGORY_GROUPS.find((g) => g.items.length > 1)!;
    const { setSelectedCategory } = setup(null, big.id);
    fireEvent.click(screen.getByRole("button", { name: big.items[1].label }));
    expect(setSelectedCategory).toHaveBeenCalledWith(big.items[1].value);
  });
});

describe("board 6: hero picture band", () => {
  it("shows the job's own photo, else the category icon (never a stock picture)", () => {
    const { container, rerender } = render(<JobCardHeroBand photo="https://x.test/p.jpg" category="cleaning" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://x.test/p.jpg");
    rerender(<JobCardHeroBand photo={null} category="cleaning" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
