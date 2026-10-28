/**
 * DESKTOP FILTERS ARE A SMALL DROP-DOWN OVER THE PAGE (owner 2026-10-28, desktop /jobs: "make filters open like
 * notification like it's just over the page it's on"; then, pointing at the search mockup's recent-searches panel:
 * "filters should be a small drop down like this").
 *
 * On the desktop website the ONE shared filter presentation (FilterSheet) opens FilterDropdown: an anchored popover
 * under the Filters button, ~380px wide, the page neither dimmed nor blurred, Escape / click-outside close it, and
 * focus goes back to the button. Phone and the native app keep the slide-up floor sheet.
 *
 * Class: every surface that mounts the shared sheet (Jobs Browse, guest Browse, Declutter Browse, Homes Browse)
 * hands it the Filters button as `anchorRef`, or the drop-down has nothing to hang under.
 *
 * @mutate src/components/dashboard/FilterSheet.tsx |   if (webDesktop) { |   if (false) {
 * @mutate src/components/dashboard/filterSheet/FilterDropdown.tsx |       <PopoverDismissLayer /> |       <PopoverDismissLayer className="bg-black/40 backdrop-blur" />
 * @mutate src/components/dashboard/filterSheet/FilterDropdown.tsx |           button.focus({ preventScroll: true }); |           void button;
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |       anchorRef={filtersButtonRef} |       anchorRef={undefined}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

const env = vi.hoisted(() => ({ desktop: true }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => env.desktop }));

import { FilterSheet } from "@/components/dashboard/FilterSheet";

afterEach(() => {
  cleanup();
  env.desktop = true;
});

function Harness() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} type="button" onClick={() => setOpen(true)}>Filters</button>
      <p>the page under it</p>
      <FilterSheet
        open={open}
        onOpenChange={setOpen}
        anchorRef={button}
        title="Filter jobs"
        sections={[{ key: "sort", title: "Sort", content: <button type="button" aria-pressed>Newest</button> }]}
        activeFilterCount={0}
        onClearAll={() => {}}
        resultCount={3}
        resultNoun={["job", "jobs"]}
      />
    </>
  );
}

describe("desktop website: Filters open a small drop-down over the page (owner 2026-10-28)", () => {
  it("opens the anchored drop-down, not a modal sheet, with nothing dimming or blurring the page", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const panel = screen.getByRole("dialog", { name: "Filter jobs" });
    expect(panel.hasAttribute("data-filter-dropdown")).toBe(true);
    expect(panel.className).not.toContain("sheet-floor");
    expect(document.querySelector("[data-radix-dialog-overlay], .sheet-overlay")).toBeNull();
    const layer = document.querySelector<HTMLElement>("[data-anchored-panel-dismiss]");
    expect(layer).not.toBeNull();
    // The layer only takes the closing click; it paints nothing.
    expect(layer!.className).not.toMatch(/\bbg-(?!transparent\b)|backdrop-blur/);
    expect(panel.style.width).toBe("380px");
    expect(screen.getByRole("button", { name: "Show 3 jobs" })).toBeTruthy();
  });

  it("Escape closes it and focus goes back to the Filters button", async () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Filters" });
    fireEvent.click(button);
    const panel = screen.getByRole("dialog", { name: "Filter jobs" });
    await act(async () => {
      fireEvent.keyDown(panel, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("phone and the app keep the slide-up floor sheet", () => {
    env.desktop = false;
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = screen.getByRole("dialog");
    expect(sheet.className).toContain("sheet-floor");
    expect(sheet.hasAttribute("data-filter-dropdown")).toBe(false);
  });

  it("every surface that mounts the shared filter sheet hands it the Filters button to hang under", () => {
    const mounts: string[] = [];
    const missing: string[] = [];
    for (const file of walkSource(["src"])) {
      if (/\.test\.tsx?$/.test(file) || file.includes("/src/test/")) continue;
      const raw = readSource(file);
      if (raw === null) continue;
      const code = blankComments(raw);
      for (const m of code.matchAll(/<(FilterSheet|DeclutterFilterSheet)\b([\s\S]*?)\/>/g)) {
        mounts.push(`${file}:${m[1]}`);
        if (!/\banchorRef=\{(?!undefined\})/.test(m[2])) missing.push(`${file}:${m[1]}`);
      }
    }
    // BrowseTasksToolbar (Jobs + guest), DeclutterBrowseBar (FilterSheet), DeclutterBrowseView, RentBrowse.
    expect(mounts.length).toBeGreaterThan(3);
    expect(missing).toEqual([]);
  });
});
