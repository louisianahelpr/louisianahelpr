import { afterEach, describe, expect, it, vi } from "vitest";

// B90 (2026-11-01): pages whose first screen waited one extra network round for a chunk only a rendered parent asked
// for. Lab (HTTP/2, Slow 4G, 4x CPU, 375, median of 5): /admin ready 3.66 -> 3.10 s, Money 4.33 -> 4.17 s,
// Notifications 4.32 -> 4.09 s, /posts 3.88 -> 3.80 s.
// @mutate src/boot/routePreload.ts | signedIn: [() => import("@/boot/adminRoute"), protectedRoute], | signedIn: [protectedRoute],
// @mutate src/boot/adminRoute.ts | () => import("@/pages/admin/Admin")] | ]
// @mutate src/boot/routePreload.ts | import("@/pages/posts/PostsPage"), () => import("@/pages/jobs/JobsSection"), protectedRoute], | import("@/pages/posts/PostsPage"), protectedRoute],
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
vi.mock("@/pages/posts/PostsPage", fake("PostsPage"));
vi.mock("@/pages/jobs/JobsSection", fake("JobsSection"));
vi.mock("@/pages/profile/Profile", fake("Profile"));
vi.mock("@/components/profile/EarningsTab", fake("EarningsTab"));
vi.mock("@/components/PaymentTab", fake("PaymentTab"));
vi.mock("@/components/NotificationPreferences", fake("NotificationPreferences"));
vi.mock("@/components/notificationPreferences/SmsAlertsCard", fake("SmsAlertsCard"));

afterEach(() => {
  localStorage.clear();
  loaded.length = 0;
  vi.resetModules();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a signed-in page's own chunks start beside the app, not a round later", () => {
  it("/admin starts the gate AND Admin's page together", async () => {
    localStorage.setItem("sb-test-auth-token", "{}");
    const { preloadEntryRoute } = await import("./routePreload");
    preloadEntryRoute("/admin");
    await vi.waitFor(() => expect(loaded).toEqual(expect.arrayContaining(["AdminRoute", "Admin", "ProtectedRoute"])));
  });

  it("a signed-out visitor on /admin does not fetch Admin's page", async () => {
    const { preloadEntryRoute } = await import("./routePreload");
    preloadEntryRoute("/admin");
    await settle();
    await settle();
    expect(loaded).not.toContain("Admin");
    expect(loaded).not.toContain("AdminRoute");
  });

  it("/posts starts Jobs' page (where it redirects) beside the redirect", async () => {
    localStorage.setItem("sb-test-auth-token", "{}");
    const { preloadEntryRoute } = await import("./routePreload");
    preloadEntryRoute("/posts");
    await vi.waitFor(() => expect(loaded).toEqual(expect.arrayContaining(["PostsPage", "JobsSection"])));
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
