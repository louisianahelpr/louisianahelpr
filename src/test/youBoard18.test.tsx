/**
 * You = board 18 (2026-10-20): the page is named "You" (h1 and browser tab,
 * one name), and YOUR ACTIVITY shows both sides of every section the member
 * shows, two tiles each, with a count only when it is real and non-zero. A
 * section not open to this viewer has no tiles; ONE line names every such
 * section (owner 2026-10-21: "Homes is opening soon").
 *
 * @mutate src/components/profile/profileLanding/YourActivity.tsx |             const status = n > 0 ? `${n} ${word}` : t.count && summary.countsKnown?.[t.count] ? "None yet" : ""; |             const status = `${n} ${word}`;
 * Owner 2026-11-17 (signed-in tweaks, item 8): a count that has answered 0 says "None yet"; one still loading says nothing.
 * @mutate src/components/profile/profileLanding/YourActivity.tsx |             const status = n > 0 ? `${n} ${word}` : t.count && summary.countsKnown?.[t.count] ? "None yet" : ""; |             const status = n > 0 ? `${n} ${word}` : t.count ? "None yet" : "";
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts |         working: !applied.loading && !applied.loadError && applied.appliedApps !== undefined, |         working: true,
 * F088 (owner UI audit 11-09): each count carries its status word ("2 live").
 * @mutate src/components/profile/profileLanding/YourActivity.tsx |   posted: "live", |   posted: "",
 * @mutate src/components/profile/profileLanding/YourActivity.tsx |   const open = visible.filter((s) => isOn(s) && isListedHere(s)); |   const open = visible;
 * @mutate src/components/profile/profileLanding/YourActivity.tsx |       {soon && <p |       {true && <p
 * @mutate src/components/profile/profileLanding/YourActivity.tsx | visible.filter((s) => !isOn(s) && isListedHere(s)) | visible.filter((s) => !isOn(s))
 * @mutate src/pages/home/HomeDashboard.tsx |               {visible.filter(isLive).map((s) => { |               {visible.map((s) => {
 * @mutate src/components/profile/profileLanding/headingContract.ts | export const PROFILE_PAGE_TITLE = "You"; | export const PROFILE_PAGE_TITLE = "Profile";
 * @mutate src/components/profile/ProfileLanding.tsx |       <YourActivity /> |       {null}
 *
 * F087 (owner UI audit 11-09) badged a tester's preview tiles "Coming soon"; owner 2026-11-17 (signed-in tweaks, item 1):
 * a section not yet open to everyone has no tiles at all, for a tester too, until it launches.
 *
 * F449 (audit 11-10): at 375 the tile's count line read "Buying · 1 in ..." (truncate); the words wrap instead.
 * @mutate src/components/profile/profileLanding/YourActivity.tsx | text-foreground break-words${ | text-foreground truncate${
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
const ALL_KNOWN = { posted: true, working: true, selling: true, shopOrders: true, buying: true };
const known = vi.hoisted(() => ({ value: { posted: true, working: true, selling: true, shopOrders: true, buying: true } as Record<string, boolean> }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => openAnswer.value }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k !== "rentals" }));
vi.mock("@/pages/home/homeDashboard/useHomeSummary", () => ({
  useHomeSummary: () => ({ counts: { posted: 2, working: 0, selling: 1, shopOrders: 0, buying: 3 }, countsKnown: known.value }),
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
afterEach(() => { cleanup(); toast.mockClear(); openAnswer.value = null; known.value = { ...ALL_KNOWN }; });

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
      "Jobs Posted · 2 live", "Jobs Working · None yet", "Declutter Buying · 3 in progress", "Declutter Selling · 1 live",
    ]);
    // M8/M9 (owner 11-16): Homes, closed to this member, is not named anywhere (it was "Homes is opening soon").
    expect(screen.queryByTestId("you-activity-soon")).toBeNull();
    expect(screen.queryByText(/Homes/)).toBeNull();
  });

  it("owner 11-17: a tester's unlaunched section (on for them, not open to everyone) has no tiles; launched, it has", () => {
    // Shops is on for this viewer (useFeature mock); only Declutter is open to everyone.
    openAnswer.value = new Set(["declutter"]);
    const { container, unmount } = render(<MemoryRouter><YourActivity /><Where /></MemoryRouter>);
    const keys = () => [...container.querySelectorAll("[data-activity-tile]")].map((t) => (t as HTMLElement).dataset.activityTile!);
    expect(keys().length).toBeGreaterThan(3);
    expect(keys().filter((k) => k.startsWith("shops:"))).toEqual([]);
    expect(container.querySelector("[data-preview-pill]")).toBeNull();
    unmount();
    openAnswer.value = new Set(["declutter", "shops"]);
    const again = render(<MemoryRouter><YourActivity /><Where /></MemoryRouter>);
    const shops = [...again.container.querySelectorAll("[data-activity-tile]")].map((t) => (t as HTMLElement).dataset.activityTile!).filter((k) => k.startsWith("shops:"));
    expect(shops).toEqual(["shops:Orders", "shops:My shop"]);
  });

  it("owner 11-17: a 0 count says 'None yet' only once its read has answered; still loading, the tile is its label", () => {
    known.value = { ...ALL_KNOWN, working: false };
    render(<MemoryRouter><YourActivity /><Where /></MemoryRouter>);
    const tiles = screen.getAllByRole("button").map((t) => t.textContent);
    expect(tiles.length).toBeGreaterThan(3);
    expect(tiles).toContain("Jobs Working");
    expect(tiles).not.toContain("Jobs Working · None yet");
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
    // M8/M9 (owner 11-16): only a LISTED closed section is named (Shops and Homes are not listed for members).
    expect(home).toContain("openingSoonLine(visible.filter((s) => !isLive(s) && live.find((tab) => tab.path === s.path)?.listed !== false).map(sectionLabel), { and: t(\"home.and\"), one: t(\"home.soonOne\"), many: t(\"home.soonMany\") })");
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
  it("the line names every closed section, in one sentence", () => {
    expect(openingSoonLine([])).toBeNull();
    expect(openingSoonLine(["Homes"])).toBe("Homes is opening soon");
    expect(openingSoonLine(["Declutter", "Shops", "Homes"])).toBe("Declutter, Shops and Homes are opening soon");
  });
});
