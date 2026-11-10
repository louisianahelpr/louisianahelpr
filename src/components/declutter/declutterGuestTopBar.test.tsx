/**
 * AUD31-67 (Guests on Declutter, Medium). At 1440 a guest on Declutter Browse or an item page saw an empty 70px band
 * above "Declutter": AppShell gives the desktop website's top bar its height (DESKTOP_BAR_H) on every desktop page, but
 * that bar (DesktopTopNav) is drawn only for a signed-in member, so a guest got the gap and no header. A guest now gets
 * a slim bar in that band: the H logo (home), Log in and Sign up, both coming back to this page. Phone widths are
 * unchanged (AppShell reserves nothing there and the join panel carries the brand).
 *
 * @mutate src/components/declutter/DeclutterGuest.tsx |   if (failed \|\| open?.has("declutter")) return <><DeclutterGuestTopBar />{children}</>; |   if (failed \|\| open?.has("declutter")) return <>{children}</>;
 * @mutate src/components/declutter/DeclutterGuest.tsx |   if (!isWebDesktop) return null; |   if (isWebDesktop) return null;
 * @mutate src/components/declutter/DeclutterGuest.tsx |       style={{ paddingTop: DESKTOP_BAR_PAD_TOP, top: bannerOffset \|\| 0, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }} |       style={{ paddingTop: 0, top: bannerOffset \|\| 0, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
 * @mutate src/components/declutter/DeclutterGuest.tsx |             <Link to={`/signup?redirect=${here(location)}`}>Sign up</Link>\n          </Button>\n        </div>\n      </div>\n    </header> |             <Link to="/signup">Sign up</Link>\n          </Button>\n        </div>\n      </div>\n    </header>
 *
 * Lead 10-31 (follow-up): at 1440 a guest then saw the logo and Sign up / Log in twice (the bar and the item's join
 * panel). At desktop width the item panel keeps only its item-specific message; phone widths are unchanged.
 * @mutate src/components/declutter/DeclutterGuest.tsx |   // only on a phone.\n  const barShown = useIsWebDesktop(); |   // only on a phone.\n  const barShown = false;
 * @mutate src/components/declutter/DeclutterGuest.tsx |               <Link to={`/login?redirect=${here(location)}`}>Log in</Link>\n            </Button> |               <Link to={`/login?redirect=${here(location)}`}>Log in</Link>\n            </Button><Link to="/signup">Sign up</Link>
 * @mutate src/components/declutter/DeclutterGuest.tsx |         {!barShown && (\n          <div className="flex shrink-0 items-center gap-2" data-guest-login=""> |         {barShown && (\n          <div className="flex shrink-0 items-center gap-2" data-guest-login="">
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

import { DeclutterGuestGate, DeclutterGuestJoin } from "./DeclutterGuest";

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

describe("the item's join panel does not repeat the bar at desktop width (lead 10-31)", () => {
  const panel = () => {
    render(<MemoryRouter initialEntries={["/declutter/item/i1"]}><DeclutterGuestJoin free={false} /></MemoryRouter>);
    return document.querySelector("[data-guest-join]") as HTMLElement;
  };

  // Owner pick 1 (11-08): the panel's own links are the item's real Make offer / Buy now (to sign up and back). What the
  // bar already carries (the logo, Log in, Sign up) is not repeated at desktop width.
  // @mutate src/components/declutter/DeclutterGuest.tsx |         {!barShown && (\n          <div className="flex shrink-0 items-center gap-2" data-guest-login=""> |         {true && (\n          <div className="flex shrink-0 items-center gap-2" data-guest-login="">
  it("desktop: the item's Make offer / Buy now stay; no logo, no Sign up, no Log in in the panel", () => {
    const join = panel();
    expect(join).toHaveTextContent("Signing up is free. We'll bring you back to this item.");
    expect(within(join).getAllByRole("link").map((a) => a.textContent)).toEqual(["Make offer", "Buy now"]);
    expect(within(join).queryByRole("link", { name: /Log in|Sign up/ })).toBeNull();
    expect(join.querySelector("[data-guest-brand]")).toBeNull();
  });

  // F048 / F059 (owner UI audit 11-09): a free item's one button says what it does for a guest ("Sign up to ask for
  // it"), and the line says SIGNING UP is free (under a $3 price "Free to join" / "It's free" read as a free item).
  // @mutate src/components/declutter/DeclutterGuest.tsx | {free ? "Sign up to ask for it" : "Buy now"} | {free ? "Ask for it" : "Buy now"}
  // @mutate src/components/declutter/DeclutterGuest.tsx |           Signing up is free. We'll bring you back to this item. |           Free to join. You come back here after.
  it("F048: a free item gets one real 'Sign up to ask for it' button and the owner's sign-up line, at both widths", () => {
    for (const desktop of [true, false]) {
      state.desktop = desktop;
      const { unmount } = render(<MemoryRouter initialEntries={["/declutter/item/i1"]}><DeclutterGuestJoin free /></MemoryRouter>);
      const join = document.querySelector("[data-guest-join]") as HTMLElement;
      const buy = join.querySelector("[data-guest-buy]") as HTMLAnchorElement;
      expect(buy.textContent, String(desktop)).toBe("Sign up to ask for it");
      expect(buy.getAttribute("href")).toBe("/signup?redirect=%2Fdeclutter%2Fitem%2Fi1");
      expect(join.querySelector("[data-guest-offer]")).toBeNull();
      expect(join).toHaveTextContent("Signing up is free. We'll bring you back to this item.");
      expect(join.textContent).not.toMatch(/Free to join|It's free/);
      unmount();
    }
  });

  // Audit 1110 F318: the phone's Log in was an inline underlined word (36x14px measured). It is a 44px outline pill
  // now (Button size sm = h-11), the same control as the Browse card's Log in.
  // @mutate src/components/declutter/DeclutterGuest.tsx |             <Button asChild size="sm" variant="outline" className="rounded-full">\n              <Link to={`/login?redirect=${here(location)}`}>Log in</Link> |             <Button asChild size="sm" variant="link" className="rounded-full">\n              <Link to={`/login?redirect=${here(location)}`}>Log in</Link>
  it("F318 phone: Log in is a 44px outline pill, not an inline underlined word", () => {
    state.desktop = false;
    const join = panel();
    const login = within(join).getByRole("link", { name: "Log in" });
    expect(login.className).toMatch(/\bh-11\b/);
    expect(login.className).toMatch(/\bborder-\[1\.5px\]/);
    expect(login.className).not.toMatch(/underline/);
  });

  it("phone: the logo, the item's two buttons and Log in, each coming back to the item", () => {
    state.desktop = false;
    const join = panel();
    expect(within(join).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/signup?redirect=%2Fdeclutter%2Fitem%2Fi1",
      "/signup?redirect=%2Fdeclutter%2Fitem%2Fi1",
      "/login?redirect=%2Fdeclutter%2Fitem%2Fi1",
      "/",
    ]);
  });
});
