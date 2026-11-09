/**
 * F086 (owner UI audit 11-09, desktop 1440, every signed-in page): the top bar's photo went straight to You with no
 * menu, and the admin account's photo is the Helpr logo, so it looked like a home button. The audit's fix, the menu
 * option: the photo opens a small menu (Profile, Settings, Log out); Log out asks first (the same confirm as
 * You > Log out). A member with no photo sees their initials (UserAvatar), pinned here too.
 *
 * @mutate src/components/DesktopTopNav.tsx |               <DropdownMenuItem onSelect={() => setLogoutOpen(true)}> |               <DropdownMenuItem onSelect={() => navigate("/")}>
 * @mutate src/components/DesktopTopNav.tsx |               <DropdownMenuItem onSelect={() => navigate("/profile?tab=settings")}> |               <DropdownMenuItem onSelect={() => navigate("/profile")}>
 * @mutate src/components/DesktopTopNav.tsx |             <DropdownMenuTrigger asChild> |             <DropdownMenuTrigger asChild onClick={() => navigate("/profile")}>
 */
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => true }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: { avatar_url: null, full_name: "Test Person" }, isAdmin: false }) }));
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/components/declutter/DeliveryOnlinePill", () => ({ DeliveryOnlinePill: () => null }));
vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null }));
// Log out itself is SignOutConfirmDialog's (its own test); here only that the menu opens it.
vi.mock("@/components/auth/SignOutConfirmDialog", () => ({
  SignOutConfirmDialog: ({ open, title }: { open: boolean; title: string }) => (open ? <div role="alertdialog">{title}</div> : null),
}));

import DesktopTopNav from "@/components/DesktopTopNav";

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
}
const mount = () => render(<MemoryRouter initialEntries={["/home"]}><DesktopTopNav /><Where /></MemoryRouter>);
const openMenu = async () => {
  const photo = screen.getByTestId("desktop-top-profile");
  await act(async () => { fireEvent.keyDown(photo, { key: "Enter" }); });
};

afterEach(cleanup);

describe("F086: the desktop top bar's photo opens Profile / Settings / Log out", () => {
  it("pressing the photo opens the menu and does not leave the page", async () => {
    mount();
    expect(screen.getByTestId("where").textContent).toBe("/home");
    await openMenu();
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent?.trim())).toEqual(["Profile", "Settings", "Log out"]);
    expect(screen.getByTestId("where").textContent).toBe("/home");
  });

  it("each row goes where it says; Log out asks first", async () => {
    mount();
    await openMenu();
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: "Settings" })); });
    expect(screen.getByTestId("where").textContent).toBe("/profile?tab=settings");
    await openMenu();
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: "Profile" })); });
    expect(screen.getByTestId("where").textContent).toBe("/profile");
    await openMenu();
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: "Log out" })); });
    expect(screen.getByRole("alertdialog").textContent).toBe("Log out?");
    expect(screen.getByTestId("where").textContent).toBe("/profile");
  });

  it("no photo: the initials show, and they are in the button's name", () => {
    mount();
    const photo = screen.getByTestId("desktop-top-profile");
    expect(photo.textContent).toContain("TP");
    expect(photo.getAttribute("aria-label")).toMatch(/Profile/);
  });
});
