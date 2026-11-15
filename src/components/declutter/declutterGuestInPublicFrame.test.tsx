/**
 * Q2784: on the web a guest's Declutter pages wear the public frame (useGuestPublicFrame), whose header already
 * carries the H logo, Log in and Join free at every width. So inside it Declutter's own guest pieces step aside: the
 * desktop guest top bar is not drawn (two fixed bars would stack), and the item and Browse join panels drop their H
 * (and the item panel its Log in pill), which would repeat the header's. Inside AppShell (the native app) they stay:
 * src/components/declutter/declutterGuestTopBar.test.tsx.
 *
 * @mutate src/components/declutter/DeclutterGuest.tsx |   const isWebDesktop = useIsWebDesktop() && !publicFrame; |   const isWebDesktop = useIsWebDesktop();
 * @mutate src/components/declutter/DeclutterGuest.tsx |   const loginShown = barShown \|\| publicFrame; |   const loginShown = barShown;
 * @mutate src/components/declutter/DeclutterGuest.tsx |   if (publicFrame) return null;\n | \n
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const state = { desktop: true };
vi.mock("@/hooks/useGuestPublicFrame", () => ({ useGuestPublicFrame: () => true }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => state.desktop }));
vi.mock("@/components/landing/useSectionsOpen", () => ({
  useSectionsOpen: () => ({ open: new Set(["declutter"]), settled: true }),
}));

const { DeclutterGuestGate, DeclutterGuestJoin, DeclutterGuestBrowseJoin } = await import("./DeclutterGuest");

const at = (path: string, el: JSX.Element) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={el} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  state.desktop = true;
});

describe("Declutter's guest pieces step aside inside the public frame (Q2784)", () => {
  it("desktop: no guest top bar over the public header; the page is drawn", () => {
    at("/declutter", <DeclutterGuestGate skeleton={<p>loading</p>}><p>THE PAGE</p></DeclutterGuestGate>);
    expect(screen.getByText("THE PAGE")).toBeTruthy();
    expect(document.querySelectorAll("header[data-guest-top-bar]").length).toBe(0);
  });

  it("phone item page: the real buttons stay; no second Log in pill, no second H", () => {
    state.desktop = false;
    at("/declutter/item/i1", <DeclutterGuestJoin free={false} />);
    expect(screen.getByRole("link", { name: "Buy now" })).toBeTruthy();
    expect(document.querySelector("[data-guest-login]")).toBeNull();
    expect(document.querySelector("[data-guest-brand]")).toBeNull();
  });

  it("phone Browse: the sign-up line stays, without a second H", () => {
    state.desktop = false;
    at("/declutter", <DeclutterGuestBrowseJoin />);
    expect(document.querySelector('[data-guest-join="browse"]')).not.toBeNull();
    expect(document.querySelector("[data-guest-brand]")).toBeNull();
  });
});
