/**
 * Customize sections = board 90 (2026-10-20): Home and Messages in an ALWAYS ON
 * group, each section with its both-sides line and a switch, "Coming soon"
 * (no switch) while a section is closed to the viewer, and a Done button in the
 * shared sheet footer. The copy never says "drag" (reorder is the arrows).
 *
 * @mutate src/components/sections/CustomizeSheet.tsx |                 {on ? ( |                 {true ? (
 * @mutate src/components/sections/CustomizeSheet.tsx |           <SheetPrimaryAction onClick={() => onOpenChange(false)}>{t("cz.done")}</SheetPrimaryAction> |           <SheetPrimaryAction>{t("cz.done")}</SheetPrimaryAction>
 * @mutate src/lib/i18n/enCreateSheets.ts | "cz.howTo": "Use the arrows to reorder. | "cz.howTo": "Drag to reorder.
 * @mutate src/lib/i18n/enCreateSheets.ts |   "cz.inbox": "Inbox", |   "cz.inbox": "Messages",
 * @mutate src/lib/i18n/enCreateSheets.ts | Hidden sections leave Home, the bottom bar and Create. | Hidden sections leave Dashboard, Explore and the + menu.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// The "Preview" mark's read (useSectionTabs) stubbed as not loaded: no section is marked here (src/test/previewMark.test.tsx owns it).
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
const sw = vi.hoisted(() => ({ on: new Set(["declutter"]) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => sw.on.has(k) }));
vi.mock("@/components/sections/useSectionPrefs", () => ({
  useSectionPrefs: () => ({ prefs: { order: ["jobs", "declutter", "shops", "homes"], hidden: [] }, setHidden: () => true, move: () => {} }),
}));

import { CustomizeSheet } from "@/components/sections/CustomizeSheet";

afterEach(() => { cleanup(); sw.on = new Set(["declutter"]); });

describe("Customize sections matches board 90", () => {
  it("Home and Messages always on (one line), a both-sides line per section, switches only for open sections", () => {
    render(<CustomizeSheet open onOpenChange={() => {}} />);
    expect(screen.getByText("Customize sections")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-always-on]").length).toBe(2);
    // M7 (iOS audit 11-16): the app's own names only (one-name rule).
    expect([...document.querySelectorAll("[data-always-on]")].map((e) => e.textContent)).toEqual(["Home", "Inbox"]);
    expect(document.body.textContent).not.toMatch(/Dashboard|Explore|Messages|\+ menu/);
    expect(screen.getByText("Hire help or find work")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show Jobs" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show Declutter" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Show Shops" })).toBeNull();
    // M8/M9 (owner 11-16): Shops and Homes, closed to this member, are not listed at all (they were "Coming soon").
    expect(document.querySelectorAll("[data-section-soon]").length).toBe(0);
    expect(document.body.textContent).not.toMatch(/Shops|Homes/);
    expect(document.body.textContent).not.toMatch(/drag/i);
  });

  it("Declutter, while its switch read is out, stays listed as Coming soon with no switch", () => {
    sw.on = new Set();
    render(<CustomizeSheet open onOpenChange={() => {}} />);
    expect([...document.querySelectorAll("[data-section-soon]")].map((e) => e.getAttribute("data-section-soon"))).toEqual(["declutter"]);
    expect(screen.queryByRole("switch", { name: "Show Declutter" })).toBeNull();
  });

  it("Done closes the sheet", () => {
    const close = vi.fn();
    render(<CustomizeSheet open onOpenChange={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(close).toHaveBeenCalledWith(false);
  });
});
