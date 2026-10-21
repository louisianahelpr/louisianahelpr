/**
 * You = board 18 (2026-10-20): the page is named "You" (h1 and browser tab,
 * one name), and YOUR ACTIVITY shows both sides of every section the member
 * shows, two tiles each, with a count only when it is real and non-zero. A
 * section not open to this viewer has no tiles; ONE line names every such
 * section (owner 2026-10-21: "Homes is opening soon").
 *
 * @mutate src/components/profile/profileLanding/YourActivity.tsx |                   {n > 0 ? ` · ${n}` : ""} |                   {` · ${n}`}
 * @mutate src/components/profile/profileLanding/YourActivity.tsx |   const open = visible.filter(isOn); |   const open = visible;
 * @mutate src/components/profile/profileLanding/YourActivity.tsx |       {soon && <p | {false && <p
 * @mutate src/pages/home/HomeDashboard.tsx |               {visible.filter(isLive).map((s) => { |               {visible.map((s) => {
 * @mutate src/components/profile/profileLanding/headingContract.ts | export const PROFILE_PAGE_TITLE = "You"; | export const PROFILE_PAGE_TITLE = "Profile";
 * @mutate src/components/profile/ProfileLanding.tsx |       <YourActivity /> |       {null}
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
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k !== "rentals" }));
vi.mock("@/pages/home/homeDashboard/useHomeSummary", () => ({
  useHomeSummary: () => ({ counts: { posted: 2, working: 0, selling: 1, shopOrders: 0 } }),
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
afterEach(() => { cleanup(); toast.mockClear(); });

describe("You matches board 18", () => {
  it("is named You: the h1 constant, rendered by ProfileLanding, and the browser tab", () => {
    expect(PROFILE_PAGE_TITLE).toBe("You");
    const landing = blankComments(readFileSync(resolve(__dirname, "../components/profile/ProfileLanding.tsx"), "utf8"));
    expect(landing).toContain("<YourActivity />");
    const page = blankComments(readFileSync(resolve(__dirname, "../pages/profile/Profile.tsx"), "utf8"));
    expect(page).toContain('"You — Helpr"');
    expect(page).not.toContain("My Profile — Helpr");
  });

  it("both sides of each OPEN section; real non-zero counts only; one line for the rest", () => {
    render(<MemoryRouter><YourActivity /><Where /></MemoryRouter>);
    const tiles = screen.getAllByRole("button");
    expect(Object.values(ACTIVITY_TILES).flat().length).toBe(8);
    expect(tiles.map((t) => t.textContent)).toEqual([
      "JobsPosted · 2", "JobsWorking", "DeclutterBuying", "DeclutterSelling · 1", "ShopsOrders", "ShopsMy shop",
    ]);
    expect(screen.getByTestId("you-activity-soon").textContent).toBe("Homes is opening soon");
  });

  it("an open tile routes to its tab; a closed section has no tile to tap", () => {
    render(<MemoryRouter initialEntries={["/profile"]}><YourActivity /><Where /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Jobs Posted, 2" }));
    expect(path).toBe("/jobs?tab=posted");
    expect(screen.queryByRole("button", { name: /Homes/ })).toBeNull();
  });

  it("Home's Your sections: a box per OPEN section, and the same one line for the rest", () => {
    const home = blankComments(readFileSync(resolve(__dirname, "../pages/home/HomeDashboard.tsx"), "utf8"));
    expect(home).toContain("{visible.filter(isLive).map((s) => {");
    expect(home).toContain("openingSoonLine(visible.filter((s) => !isLive(s)).map((s) => s.label))");
    expect(home).not.toMatch(/>Opening soon</);
  });

  it("the line names every closed section, in one sentence", () => {
    expect(openingSoonLine([])).toBeNull();
    expect(openingSoonLine(["Homes"])).toBe("Homes is opening soon");
    expect(openingSoonLine(["Declutter", "Shops", "Homes"])).toBe("Declutter, Shops and Homes are opening soon");
  });
});
