/**
 * POSTED / WORKING: THE OPEN SEARCH NEVER LEAVES A CUT CHIP (audit 2026-10-28 F20; lead's choice (A)).
 *
 * The bug: on a phone the open search field kept its fixed `clamp(200px,55vw,320px)` and the status chip row
 * kept every chip in what was left: 129px of scroller at 375, 80px at 320 (helper-e2e, Working, measured on a
 * local build on prod data), so the field sat on a sliver of cut chips ("Ne", "Waitir") under the row's fade.
 *
 * The fix, within the owner's rules (the search is an icon that opens in place in its row, owner 2026-10-25 /
 * 10-27, src/test/jobsSearchIsAnIcon.test.tsx): while the field is open on a phone the chip row shows ONLY the
 * lit chip (All when nothing is picked) at its own width with no fade, the field takes the rest of the row
 * (`min-w-0 flex-1`, exactly the free width), and every chip comes back when the field closes. Desktop keeps every chip (its
 * 260px pill leaves room). Measured after (same build and account): at 320 and 375 the lit chip is whole with
 * no other chip drawn: "All · 57" 78/78 beside a 194px / 249px field, and the longest, "Not picked · 19",
 * 134/134 beside a 138px / 193px field (below 160px the magnifier steps aside so "Search" stays whole). Every
 * chip is back after Escape; 1440 is unchanged.
 *
 * Choice C (lead 2026-10-29): with the magnifier's 40px slot held at the row's end (searchDismissAndOverlay), the
 * field fell to 90px at 320 with "Not picked · 19" lit and its input to 22px ("Sea"). So while the field is open on
 * a phone the lone lit chip drops its count ("Not picked", "All"); every count is back when the field closes.
 *
 * @mutate src/components/sections/StatusBoxes.tsx | {count > 0 && !onlyLit && <span | {count > 0 && <span
 * @mutate src/components/job-card/embeddedActivity.tsx |             onlyLit={searchOpen && !desktop} |             onlyLit={false}
 * @mutate src/components/sections/StatusBoxes.tsx | {boxes.filter((b) => !onlyLit \|\| b.key === value).map( | {boxes.map(
 * @mutate src/components/sections/StatusBoxes.tsx | {(!onlyLit \|\| value === null) && chip(ALL, | {chip(ALL,
 * @mutate src/components/sections/StatusBoxes.tsx |               "-mx-1 flex flex-none gap-2 px-1 pb-0.5" |               "-mx-1 flex min-w-0 flex-1 gap-2 pl-1 pr-11 pb-0.5 [mask-image:linear-gradient(to_right,#000_calc(100%-44px),transparent)]"
 * @mutate src/components/sections/InlineListSearch.tsx | ${fill ? "search-fill min-w-0 flex-1" : "w-[clamp(200px,55vw,320px)] shrink-0"} | w-[clamp(200px,55vw,320px)] shrink-0
 * @mutate src/components/sections/InlineListSearch.tsx | ${fill && !desktop ? "search-fill-glyph" : ""} | ${""}
 * @mutate src/index.css | @container (max-width: 159px) {\n  .search-fill-glyph { display: none; } | @container (max-width: 99px) {\n  .search-fill-glyph { display: none; }
 * @mutate src/components/sections/InlineListSearch.tsx |     onOpenChangeRef.current?.(open);\n |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { blankCssComments } from "./helpers/blankNonCode";

const env = vi.hoisted(() => ({ desktop: false }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => env.desktop }));

import { EmbeddedActivityHeader } from "@/components/job-card/embeddedActivity";

afterEach(() => {
  cleanup();
  env.desktop = false;
});

const COUNTS = { all: 57, needs_you: 16, waiting: 3, scheduled: 1, done: 37, cancelled: 19 };

function renderHeader(statusFilter = "all", search = "") {
  return render(
    <EmbeddedActivityHeader header={null} tab="applied" statusFilter={statusFilter} counts={COUNTS} onFilter={() => {}} search={search} onSearch={() => {}} />,
  );
}

const chips = () => within(screen.getByRole("group", { name: "Filter by status" })).getAllByRole("button").map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim());
const classes = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);
const open = () => fireEvent.click(screen.getByRole("button", { name: "Search jobs you're working" }));

describe("Posted / Working: the open search keeps only the lit chip on a phone (F20)", () => {
  it("closed: every chip, in a scroller with the end fade", () => {
    renderHeader();
    // Inventory floor: All plus the five buckets.
    expect(chips().length).toBeGreaterThan(5);
    expect(classes(screen.getByRole("group", { name: "Filter by status" }))).toContain("overflow-x-auto");
  });

  it("open with nothing picked: All alone, whole (no scroller, no fade); the field fills the row", () => {
    renderHeader();
    open();
    expect(chips()).toEqual(["All"]);
    const row = classes(screen.getByRole("group", { name: "Filter by status" }));
    expect(row).toContain("flex-none");
    expect(row.join(" ")).not.toMatch(/mask-image|overflow-x-auto|pr-11/);
    const field = classes(screen.getByRole("search", { name: "Search jobs you're working" }));
    expect(field).toContain("flex-1");
    expect(field).toContain("min-w-0");
    expect(field.join(" ")).not.toMatch(/clamp\(200px/);
  });

  it("open with a bucket picked: that chip alone, still lit", () => {
    renderHeader("waiting");
    open();
    expect(chips()).toEqual(["Waiting"]);
    expect(screen.getByRole("button", { name: /Waiting/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("closing the field (Escape) brings every chip back, each with its count", () => {
    renderHeader();
    open();
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search jobs you're working" }), { key: "Escape" });
    expect(chips().length).toBeGreaterThan(5);
    expect(chips()[0]).toBe("All · 57");
    expect(chips()).toContain("Waiting · 3");
  });

  it("choice C: the lone lit chip shows no count while the phone field is open; desktop keeps every count", () => {
    renderHeader("waiting");
    open();
    const group = screen.getByRole("group", { name: "Filter by status" });
    expect(group.querySelectorAll("[data-chip-count]").length).toBe(0);
    cleanup();
    env.desktop = true;
    renderHeader("waiting");
    open();
    expect(screen.getByRole("group", { name: "Filter by status" }).querySelectorAll("[data-chip-count]").length).toBeGreaterThan(4);
  });

  it("arriving with words in ?q= opens the field, and the row already shows only the lit chip", () => {
    renderHeader("all", "AA5");
    expect(screen.getByRole("search", { name: "Search jobs you're working" })).toBeTruthy();
    expect(chips()).toEqual(["All"]);
  });

  it("desktop keeps every chip while the 260px pill is open", () => {
    env.desktop = true;
    renderHeader();
    open();
    expect(chips().length).toBeGreaterThan(5);
  });

  it("a narrow filling field keeps its word: below 160px the decorative magnifier steps aside (index.css)", () => {
    renderHeader();
    open();
    const form = screen.getByRole("search", { name: "Search jobs you're working" });
    expect(classes(form)).toContain("search-fill");
    const glyph = form.querySelector("svg");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(classes(glyph!)).toContain("search-fill-glyph");
    // Measured: "Not picked · 19" lit at 320 leaves the field 138px, where the word read "Searc" beside the glyph.
    const css = blankCssComments(readFileSync(resolve(__dirname, "../index.css"), "utf8"));
    expect(css).toMatch(/\.search-fill\s*\{\s*container-type:\s*inline-size;\s*\}/);
    expect(css).toMatch(/@container \(max-width: 159px\) \{\s*\.search-fill-glyph \{ display: none; \}/);
  });
});
