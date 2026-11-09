/**
 * Owner request 11-05 (/u/<handle> on desktop, "the profile title is pushed down"). Measured on prod at desktop width,
 * signed in: .app-shell-frame top 70px, the "Profile" h1 at 101px over a blank band, no rail and no top bar; the item
 * page next to it had its h1 at 41px with the rail. AppShell kept DesktopTopNav's 70px whenever the screen was
 * desktop, but the bar draws only on a rail route (isDesktopRailRoute) for a signed-in member. So: the room is kept
 * only when the bar is on screen, and /u/ is a rail route (a member keeps the rail and bar there).
 *
 * Inventory floor: every AppShell page path the guard checks is read from the same rail-route list.
 *
 * @mutate src/components/AppShell.tsx | isWebDesktop && ((maybeSignedIn && isDesktopRailRoute(pathname)) \|\| guestBarOn) ? DESKTOP_BAR_H : 0 | isWebDesktop ? DESKTOP_BAR_H : 0
 * @mutate src/lib/desktopNavRoutes.ts |   "/u/", |   "/u-not-a-route/",
 *
 * F047 (owner UI audit 11-09, High): a guest on Declutter at desktop width has its own top bar (DeclutterGuestTopBar),
 * and the page's header ("Declutter", the item's Go back) sat UNDER it: Go back hid behind the logo. The guest bar is a
 * bar on screen too, so AppShell keeps its room while it is drawn, and none once it is gone.
 * @mutate src/components/AppShell.tsx | ((maybeSignedIn && isDesktopRailRoute(pathname)) \|\| guestBarOn) | (maybeSignedIn && isDesktopRailRoute(pathname))
 * @mutate src/components/declutter/DeclutterGuest.tsx |   useMarkGuestTopBarOn(isWebDesktop); |   useMarkGuestTopBarOn(false);
 * @mutate src/lib/guestTopBar.ts |   return useSyncExternalStore(subscribe, () => mounted > 0, () => false); |   return useSyncExternalStore(subscribe, () => false, () => false);
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

let desktop = true;
let session = true;
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => desktop }));
vi.mock("@/hooks/useStoredSessionHint", () => ({ useStoredSessionHint: () => session }));
vi.mock("@/components/landing/useSectionsOpen", () => ({
  useSectionsOpen: () => ({ open: new Set(["declutter"]), settled: true, failed: false }),
}));

const { default: AppShell } = await import("@/components/AppShell");
const { isDesktopRailRoute } = await import("@/lib/desktopNavRoutes");
const { DESKTOP_BAR_H } = await import("@/lib/desktopBar");
const { DeclutterGuestGate } = await import("@/components/declutter/DeclutterGuest");
const { MemoryRouter } = await import("react-router-dom");

const frameTop = (path: string) => {
  window.history.replaceState(null, "", path);
  const { container, unmount } = render(<AppShell><p>page</p></AppShell>);
  const top = (container.querySelector(".app-shell-frame") as HTMLElement).style.top;
  unmount();
  return top;
};

afterEach(() => {
  desktop = true;
  session = true;
  window.history.replaceState(null, "", "/");
});

describe("AppShell keeps the desktop top bar's room only while the bar is on screen", () => {
  it("the shareable profile is a rail route, so a member gets the bar and its room", () => {
    expect(isDesktopRailRoute("/u/lexi-l")).toBe(true);
    expect(frameTop("/u/lexi-l")).toBe(`${DESKTOP_BAR_H}px`);
    expect(frameTop("/home")).toBe(`${DESKTOP_BAR_H}px`);
  });

  it("a guest (no stored session) gets no bar, so no blank band", () => {
    session = false;
    expect(frameTop("/u/lexi-l")).toBe("0px");
    expect(frameTop("/home")).toBe("0px");
  });

  it("a route the bar never draws on keeps no room, and a phone never does", () => {
    expect(isDesktopRailRoute("/login")).toBe(false);
    expect(frameTop("/login")).toBe("0px");
    desktop = false;
    expect(frameTop("/u/lexi-l")).toBe("0px");
  });
});

describe("F047: a guest's Declutter top bar keeps its room too", () => {
  const guestDeclutter = (path: string) => {
    session = false;
    window.history.replaceState(null, "", path);
    return render(
      <MemoryRouter initialEntries={[path]}>
        <DeclutterGuestGate skeleton={<p>loading</p>}>
          <AppShell><p>page</p></AppShell>
        </DeclutterGuestGate>
      </MemoryRouter>,
    );
  };

  it("desktop: the guest bar is drawn and the page starts below it, on Browse and on an item", () => {
    const paths = ["/declutter", "/declutter/item/i1"];
    expect(paths.length).toBeGreaterThan(1);
    for (const path of paths) {
      const { container, unmount } = guestDeclutter(path);
      expect(document.querySelector("header[data-guest-top-bar]"), path).not.toBeNull();
      expect((container.querySelector(".app-shell-frame") as HTMLElement).style.top, path).toBe(`${DESKTOP_BAR_H}px`);
      unmount();
    }
    // Gone with the bar: a guest page with no bar keeps no room.
    expect(frameTop("/u/lexi-l")).toBe("0px");
  });

  it("phone: no guest bar, so no room", () => {
    desktop = false;
    const { container, unmount } = guestDeclutter("/declutter/item/i1");
    expect(document.querySelector("header[data-guest-top-bar]")).toBeNull();
    expect((container.querySelector(".app-shell-frame") as HTMLElement).style.top).toBe("0px");
    unmount();
  });
});
