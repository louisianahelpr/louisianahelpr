import { afterEach, describe, expect, it, vi } from "vitest";

// @mutate src/boot/routePreload.ts | signedIn: [declutterRoute, protectedRoute], | signedIn: [protectedRoute],
// @mutate src/boot/declutterRoute.ts | import("@/pages/declutter/DeclutterPage").catch(() => { | Promise.resolve().catch(() => {
// @mutate src/boot/routePreload.ts | guest: [declutterRoute, protectedRoute], | guest: [login, protectedRoute],
// @mutate src/boot/declutterRoute.ts | import("@/components/declutter/DeclutterGuestRoute").catch(() => { | Promise.resolve().catch(() => {

const loaded: string[] = [];
// vi.doMock in each test (after resetModules), so each test's imports run the factories again and record what loaded.
function mockPages() {
  const page = (name: string) => () => {
    loaded.push(name);
    return { default: () => null };
  };
  vi.doMock("@/pages/declutter/DeclutterPage", page("DeclutterPage"));
  vi.doMock("@/components/declutter/DeclutterGuestRoute", page("DeclutterGuestRoute"));
  vi.doMock("@/components/declutter/DeclutterBrowseView", page("DeclutterBrowseView"));
  vi.doMock("@/pages/auth/Login", page("Login"));
  vi.doMock("@/components/ProtectedRoute", page("ProtectedRoute"));
}

afterEach(() => {
  localStorage.clear();
  loaded.length = 0;
  vi.resetModules();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const PAGE = ["DeclutterPage", "DeclutterGuestRoute", "DeclutterBrowseView"];

describe("/declutter's page starts on the first network round", () => {
  it("a signed-in member starts the Declutter page, its gate and Browse beside the app", async () => {
    localStorage.setItem("sb-test-auth-token", "{}");
    mockPages();
    const { preloadEntryRoute } = await import("./routePreload");
    preloadEntryRoute("/declutter");
    await vi.waitFor(() => expect(loaded).toEqual(expect.arrayContaining(PAGE)));
    expect(loaded).not.toContain("Login");
  });

  // Q2705 (11-07): a guest sees the same page (DeclutterGuestRoute, BUY-16). Its page chunks started only once App.tsx
  // had rendered the route (4.0 s live, Slow 4G + 4x, 375) and Browse's a round later (6.5 s), while the entry fetched
  // Login, a page the guest never saw.
  it("a signed-out visitor starts the same chunks as a member (the guest page), and not Login", async () => {
    mockPages();
    const { preloadEntryRoute } = await import("./routePreload");
    preloadEntryRoute("/declutter");
    await vi.waitFor(() => expect(loaded).toEqual(expect.arrayContaining(PAGE)));
    await settle();
    expect(loaded).not.toContain("Login");
  });
});
