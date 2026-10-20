/**
 * You = board 18 (2026-10-20): the page is named "You" (h1 and browser tab,
 * one name), and YOUR ACTIVITY shows both sides of every section the member
 * shows, two tiles each, with a count only when it is real and non-zero; a
 * section not open to this viewer reads "Opening soon" and never routes in.
 *
 * @mutate src/components/profile/profileLanding/YourActivity.tsx |                   {on && n > 0 ? ` · ${n}` : ""} |                   {` · ${n}`}
 * @mutate src/components/profile/profileLanding/YourActivity.tsx |                 onClick={() => (on ? navigate(t.to) : sayComingSoon(s.label))} |                 onClick={() => navigate(t.to)}
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

  it("eight tiles, both sides of each section; real non-zero counts only", () => {
    render(<MemoryRouter><YourActivity /><Where /></MemoryRouter>);
    const tiles = screen.getAllByRole("button");
    expect(tiles.length).toBe(8);
    expect(Object.values(ACTIVITY_TILES).flat().length).toBe(8);
    expect(tiles.map((t) => t.textContent)).toEqual([
      "JobsPosted · 2", "JobsWorking", "DeclutterBuying", "DeclutterSelling · 1",
      "ShopsOrders", "ShopsMy shop", "HomesRentingOpening soon", "HomesOwningOpening soon",
    ]);
  });

  it("an open tile routes to its tab; a closed section says coming soon and stays put", () => {
    render(<MemoryRouter initialEntries={["/profile"]}><YourActivity /><Where /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Jobs Posted, 2" }));
    expect(path).toBe("/jobs?tab=posted");
    fireEvent.click(screen.getByRole("button", { name: "Homes Owning, opening soon" }));
    expect(path).toBe("/jobs?tab=posted");
    expect(toast).toHaveBeenCalledWith("Homes is coming soon", expect.anything());
  });
});
