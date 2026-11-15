/**
 * THE DESKTOP TITLE SLOT IS THERE BEFORE THE BAR'S CHUNK (Q169; prod-audit 43691657529 page-settle @1440).
 *
 * DesktopTopNav is its own lazy chunk, and its Suspense fallback was null. A signed-in page whose chunk arrived first
 * found no title slot, drew its PHONE title row (about 81px tall), then dropped it to the 8px desktop gap when the bar
 * mounted, so the body jumped up 81px: every Profile tab measured CLS 0.034-0.044 that way ("div.space-y-section
 * 151→70 ↑div.-mb-[var(--section-gap)] h8"), /post-job 0.038.
 *
 * Now the fallback is DesktopTopBarPending: the same fixed bar with the slot, for the same member and routes. Here the
 * bar's chunk never arrives, and a Profile-style page header must still go straight into the bar (no phone row in
 * the body) from its first paint.
 *
 * @mutate src/App.tsx | <Suspense fallback={<DesktopTopBarPending />}><DesktopTopNav /></Suspense> | <Suspense fallback={null}><DesktopTopNav /></Suspense>
 * @mutate src/components/header/DesktopTopBarFrame.tsx |         <div ref={registerDesktopTitleSlot} data-desktop-title-slot="" | <div data-desktop-title-slot=""
 * @mutate src/components/header/DesktopTopBarFrame.tsx |   if (!user \|\| !isDesktopRailRoute(pathname)) return null; |   if (!user) return null;
 * @mutate src/components/header/DesktopTopBarFrame.tsx |   if (!user \|\| !isDesktopRailRoute(pathname)) return null; |   if (!isDesktopRailRoute(pathname)) return null;
 */
import { Suspense, lazy } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopTopBarPending } from "@/components/header/DesktopTopBarFrame";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { blankComments } from "@/test/helpers/blankNonCode";

const auth = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => true }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: auth.user, profile: null, isLoading: false }) }));

// The bar's chunk, held forever: what a page sees when its own chunk wins the race.
const NeverBar = lazy(() => new Promise<{ default: () => null }>(() => undefined));

function page(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Suspense fallback={<DesktopTopBarPending />}><NeverBar /></Suspense>
      <main data-testid="body">
        <div className="space-y-section">
          <ProfileTabHeader title="Account and security" onBack={() => undefined} />
          <p>first content</p>
        </div>
      </main>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  auth.user = { id: "u1" };
});

describe("the desktop title slot exists before DesktopTopNav's chunk", () => {
  it("App.tsx gives DesktopTopNav the pending bar as its fallback", () => {
    const app = blankComments(readFileSync("src/App.tsx", "utf8"));
    expect(app).toMatch(/<Suspense fallback=\{<DesktopTopBarPending \/>\}><DesktopTopNav \/><\/Suspense>/);
  });

  it("a signed-in page's title goes into the bar at once: no phone title row in the body", () => {
    page("/profile?tab=security");
    const slot = document.querySelector("[data-desktop-title-slot]");
    expect(slot).not.toBeNull();
    const h1 = screen.getByRole("heading", { level: 1, name: "Account and security" });
    expect(slot!.contains(h1)).toBe(true);
    expect(screen.getByTestId("body").querySelector("h1")).toBeNull();
    // The body keeps only the desktop gap under the bar.
    expect(screen.getByTestId("body").querySelector("[data-page-title-gap]")).not.toBeNull();
  });

  it("draws no bar where DesktopTopNav draws none: a route without the rail, or no member", () => {
    page("/login");
    expect(document.querySelector("[data-desktop-title-slot]")).toBeNull();
    cleanup();
    auth.user = null;
    page("/profile");
    expect(document.querySelector("[data-desktop-title-slot]")).toBeNull();
  });
});
