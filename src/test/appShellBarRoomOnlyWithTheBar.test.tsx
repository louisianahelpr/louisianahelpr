/**
 * Owner request 11-05 (/u/<handle> on desktop, "the profile title is pushed down"). Measured on prod at desktop width,
 * signed in: .app-shell-frame top 70px, the "Profile" h1 at 101px over a blank band, no rail and no top bar; the item
 * page next to it had its h1 at 41px with the rail. AppShell kept DesktopTopNav's 70px whenever the screen was
 * desktop, but the bar draws only on a rail route (isDesktopRailRoute) for a signed-in member. So: the room is kept
 * only when the bar is on screen, and /u/ is a rail route (a member keeps the rail and bar there).
 *
 * Inventory floor: every AppShell page path the guard checks is read from the same rail-route list.
 *
 * @mutate src/components/AppShell.tsx | isWebDesktop && maybeSignedIn && isDesktopRailRoute(pathname) ? DESKTOP_BAR_H : 0 | isWebDesktop ? DESKTOP_BAR_H : 0
 * @mutate src/lib/desktopNavRoutes.ts |   "/u/", |   "/u-not-a-route/",
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

let desktop = true;
let session = true;
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => desktop }));
vi.mock("@/hooks/useStoredSessionHint", () => ({ useStoredSessionHint: () => session }));

const { default: AppShell } = await import("@/components/AppShell");
const { isDesktopRailRoute } = await import("@/lib/desktopNavRoutes");
const { DESKTOP_BAR_H } = await import("@/lib/desktopBar");

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
