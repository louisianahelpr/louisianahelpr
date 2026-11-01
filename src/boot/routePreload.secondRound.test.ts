import { afterEach, describe, expect, it, vi } from "vitest";

// B90 (2026-11-01): pages whose first screen waited one extra network round for a chunk only a rendered parent asked
// for. Lab (HTTP/2, Slow 4G, 4x CPU, 375, median of 5): /admin ready 3.66 -> 3.11 s, Money 4.33 -> 3.87 s (with the
// profile-first-screen chunk, profileFirstScreen.test.ts), Notifications 4.32 -> 4.12 s.
// @mutate src/boot/routePreload.ts | signedIn: [() => import("@/boot/profileRoute"), protectedRoute],\n  },\n  // A signed-out | signedIn: [protectedRoute],\n  },\n  // A signed-out
// @mutate src/boot/profileRoute.ts | return [() => import("@/components/AdminRoute"), () => import("@/pages/admin/Admin")]; | return [() => import("@/components/AdminRoute")];
// @mutate src/boot/profileRoute.ts | return [() => import("@/components/profile/EarningsTab"), () => import("@/components/PaymentTab")]; | return [() => import("@/components/profile/EarningsTab")];
// @mutate src/boot/profileRoute.ts | if (tab === "notifications") { | if (tab === "notifications-off") {

const { loaded, fake } = vi.hoisted(() => {
  const loaded: string[] = [];
  const fake = (name: string) => () => {
    loaded.push(name);
    return { default: () => null };
  };
  return { loaded, fake };
});
vi.mock("@/components/ProtectedRoute", fake("ProtectedRoute"));
vi.mock("@/components/AdminRoute", fake("AdminRoute"));
vi.mock("@/pages/admin/Admin", fake("Admin"));
vi.mock("@/pages/profile/Profile", fake("Profile"));
vi.mock("@/components/profile/EarningsTab", fake("EarningsTab"));
vi.mock("@/components/PaymentTab", fake("PaymentTab"));
vi.mock("@/components/NotificationPreferences", fake("NotificationPreferences"));
vi.mock("@/components/notificationPreferences/SmsAlertsCard", fake("SmsAlertsCard"));

afterEach(() => {
  window.history.pushState({}, "", "/");
  localStorage.clear();
  loaded.length = 0;
  vi.resetModules();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a signed-in page's own chunks start beside the app, not a round later", () => {
  it("/admin starts the gate AND Admin's page together", async () => {
    localStorage.setItem("sb-test-auth-token", "{}");
    window.history.pushState({}, "", "/admin");
    const { preloadEntryRoute } = await import("./routePreload");
    preloadEntryRoute("/admin");
    await vi.waitFor(() => expect(loaded).toEqual(expect.arrayContaining(["AdminRoute", "Admin", "ProtectedRoute"])));
    expect(loaded).not.toContain("Profile");
  });

  it("the shared boot chunk starts Profile, not Admin, on /profile", async () => {
    const { accountPageChunksFor } = await import("./profileRoute");
    await Promise.all(accountPageChunksFor("/profile", "").map((load) => load()));
    expect(loaded).toContain("Profile");
    expect(loaded).not.toContain("Admin");
  });

  it("a signed-out visitor on /admin does not fetch Admin's page", async () => {
    const { preloadEntryRoute } = await import("./routePreload");
    preloadEntryRoute("/admin");
    await settle();
    await settle();
    expect(loaded).not.toContain("Admin");
    expect(loaded).not.toContain("AdminRoute");
  });

  it("Money's tab and its bank-connect card start with Profile", async () => {
    const { profileTabChunksFor } = await import("./profileRoute");
    await Promise.all(profileTabChunksFor("?tab=earnings").map((load) => load()));
    expect(loaded).toEqual(expect.arrayContaining(["EarningsTab", "PaymentTab"]));
  });

  it("Notifications' panels start with Profile", async () => {
    const { profileTabChunksFor } = await import("./profileRoute");
    await Promise.all(profileTabChunksFor("?tab=notifications").map((load) => load()));
    expect(loaded).toEqual(expect.arrayContaining(["NotificationPreferences", "SmsAlertsCard"]));
  });

  it("the route table still lists the pages it starts early (inventory floor)", async () => {
    const { ENTRY_ROUTE_CHUNKS } = await import("./routePreload");
    expect(Object.keys(ENTRY_ROUTE_CHUNKS).length).toBeGreaterThan(10);
  });

  it("other tabs start nothing extra", async () => {
    const { profileTabChunksFor } = await import("./profileRoute");
    expect(profileTabChunksFor("?tab=security")).toHaveLength(0);
    expect(profileTabChunksFor("")).toHaveLength(0);
  });
});
