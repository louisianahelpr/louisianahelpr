/**
 * Q2221: on the desktop website a section's top bar drew its own logo, bell
 * and avatar under the app's desktop header, which already has the logo and
 * the bell (and the rail has Profile): Home at 1440 showed two logos and two
 * bells (dashboards build run 4 shot 21-home-1440-light.png). On web-desktop
 * the bar keeps the section title and the section's soft "+ Post a job" (owner
 * 2026-10-28, topBarAddMatchesBell), and on Home draws nothing; on a phone it is
 * unchanged (title or logo, bell, avatar).
 *
 * @mutate src/components/sections/AppTopBar.tsx |   if (isWebDesktop && !title) return null; |
 * @mutate src/components/sections/AppTopBar.tsx |       {user && !isWebDesktop && (\n      <span data-testid="top-bar-bell"> |       {user && true && (\n      <span data-testid="top-bar-bell">
 * @mutate src/components/sections/AppTopBar.tsx |         {user && !isWebDesktop && showProfile && ( |         {user && showProfile && (
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const desktop = { on: false };
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => desktop.on }));
vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u-1" }, profile: { avatar_url: null, full_name: "Test Person" } }) }));

import { AppTopBar } from "@/components/sections/AppTopBar";
import { registerDesktopTitleSlot } from "@/components/header/PageTitleBar";

afterEach(() => { cleanup(); desktop.on = false; });
const labels = () => screen.queryAllByRole("button").map((b) => b.getAttribute("aria-label"));
const draw = (el: JSX.Element) => render(<MemoryRouter>{el}</MemoryRouter>);

describe("the section top bar never repeats the desktop header (Q2221)", () => {
  it("phone: a section shows Help, the bell and the avatar; Home shows the logo, Help, bell and avatar", () => {
    draw(<AppTopBar title="Jobs" />);
    expect(labels()).toEqual(["Help", "Notifications", "Profile"]);
    cleanup();
    draw(<AppTopBar />);
    expect(screen.getByTestId("app-top-bar")).toBeTruthy();
    expect(labels()).toEqual(["Help", "Notifications", "Profile"]);
  });

  it("desktop: a section keeps its title and its soft '+ Post a job' (no second bell, no avatar)", () => {
    desktop.on = true;
    // DesktopTopNav's title slot: on the desktop website the bar's row is drawn there.
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    registerDesktopTitleSlot(slot);
    try {
      draw(<AppTopBar title="Jobs" explore section="jobs" />);
      expect(screen.getByRole("heading", { name: "Jobs" })).toBeTruthy();
      expect(labels()).toEqual(["Post a job"]);
    } finally {
      cleanup();
      registerDesktopTitleSlot(null);
      slot.remove();
    }
  });

  it("desktop with no header slot (a route without the desktop bar): the title only, still no second bell or avatar", () => {
    desktop.on = true;
    draw(<AppTopBar title="Messages" />);
    expect(screen.getByRole("heading", { name: "Messages" })).toBeTruthy();
    expect(labels()).toEqual([]);
  });

  it("desktop Home: no bar at all (no second logo, no second bell)", () => {
    desktop.on = true;
    draw(<AppTopBar />);
    expect(screen.queryByTestId("app-top-bar")).toBeNull();
  });
});
