/**
 * AUD31-67 (Guests on Declutter, Medium). At 1440 a guest on Declutter Browse or an item page saw an empty 70px band
 * above "Declutter": AppShell gives the desktop website's top bar its height (DESKTOP_BAR_H) on every desktop page, but
 * that bar (DesktopTopNav) is drawn only for a signed-in member, so a guest got the gap and no header. A guest now gets
 * a slim bar in that band: the H logo (home), Log in and Sign up, both coming back to this page. Phone widths are
 * unchanged (AppShell reserves nothing there and the join panel carries the brand).
 *
 * @mutate src/components/declutter/DeclutterGuest.tsx |   if (open?.has("declutter")) return <><DeclutterGuestTopBar />{children}</>; |   if (open?.has("declutter")) return <>{children}</>;
 * @mutate src/components/declutter/DeclutterGuest.tsx |   if (!isWebDesktop) return null; |   if (isWebDesktop) return null;
 * @mutate src/components/declutter/DeclutterGuest.tsx |       style={{ paddingTop: DESKTOP_BAR_PAD_TOP, top: bannerOffset \|\| 0, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }} |       style={{ paddingTop: 0, top: bannerOffset \|\| 0, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
 * @mutate src/components/declutter/DeclutterGuest.tsx |             <Link to={`/signup?redirect=${here(location)}`}>Sign up</Link>\n          </Button>\n        </div>\n      </div>\n    </header> |             <Link to="/signup">Sign up</Link>\n          </Button>\n        </div>\n      </div>\n    </header>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DESKTOP_BAR_H, DESKTOP_BAR_PAD_TOP } from "@/lib/desktopBar";

const state = { desktop: true, open: true };
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => state.desktop }));
vi.mock("@/components/landing/useSectionsOpen", () => ({
  useSectionsOpen: () => ({ open: new Set(state.open ? ["declutter"] : []), settled: true }),
}));

import { DeclutterGuestGate } from "./DeclutterGuest";

function renderGate(path = "/declutter/item/i1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<p>LOGIN WALL</p>} />
        <Route
          path="*"
          element={
            <DeclutterGuestGate skeleton={<p>loading</p>}>
              <p>THE PAGE</p>
            </DeclutterGuestGate>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  state.desktop = true;
  state.open = true;
});

describe("a guest on Declutter at desktop width gets a header in the band AppShell keeps for the top bar (AUD31-67)", () => {
  it("draws the bar: the logo home, Log in and Sign up, each coming back to this page", () => {
    renderGate();
    expect(screen.getByText("THE PAGE")).toBeTruthy();
    const bar = document.querySelector("header[data-guest-top-bar]") as HTMLElement | null;
    expect(bar).not.toBeNull();
    const links = within(bar!).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/",
      "/login?redirect=%2Fdeclutter%2Fitem%2Fi1",
      "/signup?redirect=%2Fdeclutter%2Fitem%2Fi1",
    ]);
    expect(within(bar!).getByRole("link", { name: "Log in" })).toBeTruthy();
    expect(within(bar!).getByRole("link", { name: "Sign up" })).toBeTruthy();
  });

  it("fills exactly the band AppShell reserves (its top pad plus a 56px row = DESKTOP_BAR_H)", () => {
    renderGate();
    const bar = document.querySelector("header[data-guest-top-bar]") as HTMLElement;
    expect(bar.className).toMatch(/\bfixed\b/);
    expect(bar.style.paddingTop).toBe(`${DESKTOP_BAR_PAD_TOP}px`);
    const row = bar.firstElementChild as HTMLElement;
    expect(row.className).toMatch(/\bh-14\b/);
    expect(DESKTOP_BAR_PAD_TOP + 56).toBe(DESKTOP_BAR_H);
  });

  it("draws nothing at phone width, where AppShell keeps no band", () => {
    state.desktop = false;
    renderGate();
    expect(screen.getByText("THE PAGE")).toBeTruthy();
    expect(document.querySelector("header[data-guest-top-bar]")).toBeNull();
  });

  it("draws nothing while Declutter is not open to everyone (the login wall)", () => {
    state.open = false;
    renderGate();
    expect(screen.getByText("LOGIN WALL")).toBeTruthy();
    expect(document.querySelector("header[data-guest-top-bar]")).toBeNull();
    expect(screen.queryByText("THE PAGE")).toBeNull();
  });
});
