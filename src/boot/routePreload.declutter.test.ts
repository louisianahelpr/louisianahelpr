import { afterEach, describe, expect, it, vi } from "vitest";

// @mutate src/boot/routePreload.ts | signedIn: [declutterRoute, protectedRoute], | signedIn: [protectedRoute],
// @mutate src/boot/declutterRoute.ts | import("@/pages/declutter/DeclutterPage").catch(() => { | Promise.resolve().catch(() => {
// @mutate src/boot/routePreload.ts | guest: [declutterRoute, supabaseClient], | guest: [login, supabaseClient],
// @mutate src/boot/routePreload.ts | guest: [declutterRoute, supabaseClient], | guest: [declutterRoute, supabaseClient, protectedRoute],
// @mutate src/boot/routePreload.ts | guest: [declutterRoute, supabaseClient], | guest: [declutterRoute],
// @mutate src/boot/declutterRoute.ts | import("@/components/declutter/DeclutterGuestRoute").catch(() => { | Promise.resolve().catch(() => {
// @mutate src/boot/declutterRoute.ts | if (hasSessionToken()) import("@/components/declutter/DeclutterHomeView") | if (true) import("@/components/declutter/DeclutterHomeView")
// @mutate src/boot/declutterRoute.ts | if (hasSessionToken()) import("@/components/declutter/DeclutterHomeView") | if (false) import("@/components/declutter/DeclutterHomeView")

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
  vi.doMock("@/components/declutter/DeclutterHomeView", page("DeclutterHomeView"));
  vi.doMock("@/pages/auth/Login", page("Login"));
  vi.doMock("@/components/ProtectedRoute", page("ProtectedRoute"));
  vi.doMock("@/integrations/supabase/client", page("SupabaseClient"));
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

  // Q2705 (2026-11-14): a guest's first round is the page and the Supabase client its first cards wait on, NOT
  // ProtectedRoute's closure: those ~15 files shared the throttled link with the HTML-drawn first photos (the LCP), and
  // DeclutterGuestRoute's own preload list brings them a round later. Measured (cwv-lab, guest, 375, Slow 4G + 4x,
  // 3 runs each): LCP 3048 -> 2932 ms, first cards 5245 -> 5231 ms. Dropping the client too drew the cards 350 ms later.
  it("a guest starts the Supabase client but not ProtectedRoute's closure on the first round", async () => {
    mockPages();
    const { preloadEntryRoute } = await import("./routePreload");
    preloadEntryRoute("/declutter");
    await vi.waitFor(() => expect(loaded).toEqual(expect.arrayContaining([...PAGE, "SupabaseClient"])));
    await settle();
    expect(loaded).not.toContain("ProtectedRoute");
  });

  it("a member still starts ProtectedRoute beside the page", async () => {
    localStorage.setItem("sb-test-auth-token", "{}");
    mockPages();
    const { preloadEntryRoute } = await import("./routePreload");
    preloadEntryRoute("/declutter");
    await vi.waitFor(() => expect(loaded).toEqual(expect.arrayContaining([...PAGE, "ProtectedRoute"])));
  });

  // Q2705 (2026-11-14): DeclutterHomeView (a member's tabs and their sheets, the What next cards, My listings) loads
  // apart from the page (DeclutterHomeEntry), so a guest's first round no longer carries it; a member starts it here,
  // beside the page, and waits no extra round. Static side: src/boot/declutterGuestSkipsMemberCode.test.ts.
  it("a member starts the member home beside the page; a guest never fetches it", async () => {
    localStorage.setItem("sb-test-auth-token", "{}");
    mockPages();
    const member = await import("./routePreload");
    member.preloadEntryRoute("/declutter");
    await vi.waitFor(() => expect(loaded).toEqual(expect.arrayContaining([...PAGE, "DeclutterHomeView"])));

    localStorage.clear();
    loaded.length = 0;
    vi.resetModules();
    mockPages();
    const guest = await import("./routePreload");
    guest.preloadEntryRoute("/declutter");
    await vi.waitFor(() => expect(loaded).toEqual(expect.arrayContaining(PAGE)));
    await settle();
    expect(loaded).not.toContain("DeclutterHomeView");
  });
});
