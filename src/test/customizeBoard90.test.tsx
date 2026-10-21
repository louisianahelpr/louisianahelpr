/**
 * Customize sections = board 90 (2026-10-20): Home and Messages in an ALWAYS ON
 * group, each section with its both-sides line and a switch, "Opening soon"
 * (no switch) while a section is closed to the viewer, and a Done button in the
 * shared sheet footer. The copy never says "drag" (reorder is the arrows).
 *
 * @mutate src/components/sections/CustomizeSheet.tsx |                 {on ? ( |                 {true ? (
 * @mutate src/components/sections/CustomizeSheet.tsx |           <SheetPrimaryAction onClick={() => onOpenChange(false)}>Done</SheetPrimaryAction> |           <SheetPrimaryAction>Done</SheetPrimaryAction>
 * @mutate src/components/sections/CustomizeSheet.tsx |           Use the arrows to reorder. |           Drag to reorder.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// The "Preview" mark's read (useSectionTabs) stubbed as not loaded: no section is marked here (src/test/previewMark.test.tsx owns it).
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k === "declutter" }));
vi.mock("@/components/sections/useSectionPrefs", () => ({
  useSectionPrefs: () => ({ prefs: { order: ["jobs", "declutter", "shops", "homes"], hidden: [] }, setHidden: () => true, move: () => {} }),
}));

import { CustomizeSheet } from "@/components/sections/CustomizeSheet";

afterEach(cleanup);

describe("Customize sections matches board 90", () => {
  it("Always on group, a both-sides line per section, switches only for open sections", () => {
    render(<CustomizeSheet open onOpenChange={() => {}} />);
    expect(screen.getByText("Customize sections")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-always-on]").length).toBe(2);
    expect(screen.getByText("Hire help or find work")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show Jobs" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show Declutter" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Show Shops" })).toBeNull();
    expect([...document.querySelectorAll("[data-section-soon]")].map((e) => e.getAttribute("data-section-soon"))).toEqual(["shops", "homes"]);
    expect(document.body.textContent).not.toMatch(/drag/i);
  });

  it("Done closes the sheet", () => {
    const close = vi.fn();
    render(<CustomizeSheet open onOpenChange={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(close).toHaveBeenCalledWith(false);
  });
});
