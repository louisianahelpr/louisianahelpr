/**
 * You = board 18 (2026-10-20): the page is named "You" (h1 and browser tab,
 * one name), and YOUR ACTIVITY shows both sides of every section the member
 * shows, two tiles each, with a count only when it is real and non-zero. A
 * section not open to this viewer has no tiles; ONE line names every such
 * section (owner 2026-10-21: "Homes is opening soon").
 *
 * @mutate src/components/profile/profileLanding/YourActivity.tsx |                   {n > 0 && <><span aria-hidden="true"> ·</span> {n} {word}</>} |                   {<><span aria-hidden="true"> ·</span> {n} {word}</>}
 * F088 (owner UI audit 11-09): each count carries its status word ("2 live").
 * @mutate src/components/profile/profileLanding/YourActivity.tsx |   posted: "live", |   posted: "",
 * @mutate src/components/profile/profileLanding/YourActivity.tsx |   const open = visible.filter((s) => isOn(s) && isListedHere(s)); |   const open = visible;
 * @mutate src/components/profile/profileLanding/YourActivity.tsx |       {soon && <p | {false && <p
 * @mutate src/pages/home/HomeDashboard.tsx |               {visible.filter(isLive).map((s) => { |               {visible.map((s) => {
 * @mutate src/components/profile/profileLanding/headingContract.ts | export const PROFILE_PAGE_TITLE = "You"; | export const PROFILE_PAGE_TITLE = "Profile";
 * @mutate src/components/profile/ProfileLanding.tsx |       <YourActivity /> |       {null}
 *
 * F087 (owner UI audit 11-09): a tester's preview sections (Shops, Homes: on for them, not open to everyone) showed
 * live-looking tiles. They carry the Coming soon badge inside, slightly dimmed (owner 11-09 badge rule).
 * @mutate src/components/profile/profileLanding/YourActivity.tsx |                 {preview && <>{" "}<PreviewPill className="self-start mt-1" /></>} |
 * @mutate src/components/profile/profileLanding/YourActivity.tsx | style={preview ? { opacity: 0.75 } : undefined} | style={undefined}
 *
 * F449 (audit 11-10): at 375 the tile's count line read "Buying · 1 in ..." (truncate); the words wrap instead.
 * @mutate src/components/profile/profileLanding/YourActivity.tsx | text-foreground break-words${ | text-foreground truncate${
 *
 * Tile heights (pre-push a11y sweep 11-15, button geometry): with "Buying · 6 in progress" wrapping at 360-390, the
 * Declutter tiles stood 89.9px under 65.9px Jobs tiles. Every tile in the grid is one height, and on phones a count
 * tile's line reserves two lines (the earlier decision: count tiles reserve two lines on phones), so counts arriving
 * and wrapping never grow the grid. Measured live at 360/375/390: 65.9/89.9/91.9 -> all 91.9 (~/.lh-shots/b2-small-1115).
 * @mutate src/components/profile/profileLanding/YourActivity.tsx | grid grid-cols-2 auto-rows-fr gap-2.5 | grid grid-cols-2 gap-2.5
 * @mutate src/components/profile/profileLanding/YourActivity.tsx | t.count && !preview ? " max-sm:min-h-[3em]" | false ? " max-sm:min-h-[3em]"
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const toast = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: null }) }));
// The "Preview" mark's read (useSectionTabs) stubbed as not loaded: no section is marked here (src/test/previewMark.test.tsx owns it).
const openAnswer = vi.hoisted(() => ({ value: null as ReadonlySet<string> | null }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => openAnswer.value }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k !== "rentals" }));
vi.mock("@/pages/home/homeDashboard/useHomeSummary", () => ({
  useHomeSummary: () => ({ counts: { posted: 2, working: 0, selling: 1, shopOrders: 0, buying: 3 } }),
}));
vi.mock("@/components/sections/useSectionPrefs", async () => {
  const { SECTIONS } = await import("@/components/sections/sectionsConfig");
  return { useSectionPrefs: () => ({ visible: SECTIONS, prefs: { order: SECTIONS.map((s) => s.key), hidden: [] } }) };
});

import { YourActivity, ACTIVITY_TILES } from "@/components/profile/profileLanding/YourActivity";
import { openingSoonLine } from "@/components/mobileNav/useSectionTabs";
import { PROFILE_PAGE_TITLE } from "@/components/profile/profileLanding/headingContract";

let path = "";
function Where() { path = useLocation().pathname + useLocation().search; return null; }
afterEach(() => { cleanup(); toast.mockClear(); openAnswer.value = null; });

describe("You matches board 18", () => {
  it("is named You: the h1 constant, rendered by ProfileLanding, and the browser tab", () => {
    expect(PROFILE_PAGE_TITLE).toBe("You");
    const landing = blankComments(readFileSync(resolve(__dirname, "../components/profile/ProfileLanding.tsx"), "utf8"));
    expect(landing).toContain("<YourActivity />");
    const page = blankComments(readFileSync(resolve(__dirname, "../pages/profile/useProfileTabNav.ts"), "utf8"));
    expect(page).toContain('"You — Helpr"');
    expect(page).not.toContain("My Profile — Helpr");
  });

  it("both sides of each OPEN section; real non-zero counts only; one line for the rest", () => {
    render(<MemoryRouter><YourActivity /><Where /></MemoryRouter>);
    const tiles = screen.getAllByRole("button");
    expect(Object.values(ACTIVITY_TILES).flat().length).toBe(8);
    expect(tiles.map((t) => t.textContent)).toEqual([
      "Jobs Posted · 2 live", "Jobs Working", "Declutter Buying · 3 in progress", "Declutter Selling · 1 live", "Shops Orders", "Shops My shop",
    ]);
    expect(screen.getByTestId("you-activity-soon").textContent).toBe("Homes is opening soon");
  });

  it("F087: a tester's preview section (on for them, not open to everyone) wears the Coming soon badge, dimmed", () => {
    // Shops is on for this viewer (useFeature mock) and only Declutter is open to everyone.
    openAnswer.value = new Set(["declutter"]);
    const { container } = render(<MemoryRouter><YourActivity /><Where /></MemoryRouter>);
    const tiles = [...container.querySelectorAll("[data-activity-tile]")] as HTMLElement[];
    expect(tiles.length).toBeGreaterThan(4);
    const shops = tiles.filter((t) => t.dataset.activityTile!.startsWith("shops:"));
    expect(shops).toHaveLength(2);
    for (const t of shops) {
      expect(t.dataset.preview).toBe("true");
      expect(t.querySelector("[data-preview-pill]")?.textContent).toBe("Coming soon");
      expect(t.style.opacity).toBe("0.75");
    }
    // Jobs and Declutter are live for everyone: no badge, no dim.
    for (const t of tiles.filter((t) => !t.dataset.activityTile!.startsWith("shops:"))) {
      expect(t.querySelector("[data-preview-pill]")).toBeNull();
      expect(t.style.opacity).toBe("");
    }
  });

  it("an open tile routes to its tab; a closed section has no tile to tap", () => {
    render(<MemoryRouter initialEntries={["/profile"]}><YourActivity /><Where /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /^Jobs\s*Posted\s*2 live$/ }));
    expect(path).toBe("/jobs?tab=posted");
    expect(screen.queryByRole("button", { name: /Homes/ })).toBeNull();
  });

  it("Home's Your sections: a box per OPEN section, and the same one line for the rest", () => {
    const home = blankComments(readFileSync(resolve(__dirname, "../pages/home/HomeDashboard.tsx"), "utf8"));
    expect(home).toContain("{visible.filter(isLive).map((s) => {");
    expect(home).toContain("openingSoonLine(visible.filter((s) => !isLive(s)).map(sectionLabel), { and: t(\"home.and\"), one: t(\"home.soonOne\"), many: t(\"home.soonMany\") })");
    expect(openingSoonLine(["Casas", "Tiendas"], { and: "y", one: "{names} abre pronto", many: "{names} abren pronto" })).toBe("Casas y Tiendas abren pronto");
    expect(home).not.toMatch(/>Opening soon</);
  });

  it("F449: a tile's count line wraps rather than cutting off (no truncate on it)", () => {
    const { container } = render(<MemoryRouter><YourActivity /><Where /></MemoryRouter>);
    const tile = container.querySelector('[data-activity-tile="declutter:Buying"]') as HTMLElement;
    const line = [...tile.querySelectorAll("span")].find((el) => el.textContent?.includes("in progress")) as HTMLElement;
    expect(line.textContent).toBe("Buying · 3 in progress");
    expect(line.className.split(/\s+/)).not.toContain("truncate");
    expect(line.className.split(/\s+/)).toContain("break-words");
  });
  it("every tile in the grid is one height, and a count tile reserves two lines on phones", () => {
    const { container } = render(<MemoryRouter><YourActivity /><Where /></MemoryRouter>);
    const grid = container.querySelector('[data-activity-tile="jobs:Posted"]')?.parentElement as HTMLElement;
    expect(grid.className.split(/\s+/)).toEqual(expect.arrayContaining(["grid", "grid-cols-2", "auto-rows-fr"]));
    const tiles = [...container.querySelectorAll<HTMLElement>("[data-activity-tile]")];
    expect(tiles.length).toBeGreaterThan(3);
    const countLabels = new Set(Object.values(ACTIVITY_TILES).flat().filter((t) => t.count).map((t) => t.label));
    let reserved = 0;
    for (const tile of tiles) {
      const line = tile.querySelectorAll(":scope > span")[1] as HTMLElement;
      const label = tile.getAttribute("data-activity-tile")!.split(":")[1];
      const wants = countLabels.has(label) && tile.getAttribute("data-preview") !== "true";
      expect(line.className.split(/\s+/).includes("max-sm:min-h-[3em]"), label).toBe(wants);
      if (wants) reserved++;
    }
    expect(reserved).toBeGreaterThan(3);
  });
  it("the line names every closed section, in one sentence", () => {
    expect(openingSoonLine([])).toBeNull();
    expect(openingSoonLine(["Homes"])).toBe("Homes is opening soon");
    expect(openingSoonLine(["Declutter", "Shops", "Homes"])).toBe("Declutter, Shops and Homes are opening soon");
  });
});
