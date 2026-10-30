import { afterEach, describe, expect, it, vi } from "vitest";

// @mutate src/boot/routePreload.ts | signedIn: [() => import("@/pages/declutter/DeclutterPage"), protectedRoute], | signedIn: [protectedRoute],
// @mutate src/boot/routePreload.ts | guest: [() => import("@/pages/auth/Login"), protectedRoute], | guest: [protectedRoute],

const loaded: string[] = [];
vi.mock("@/pages/declutter/DeclutterPage", () => {
  loaded.push("DeclutterPage");
  return { default: () => null };
});
vi.mock("@/pages/auth/Login", () => {
  loaded.push("Login");
  return { default: () => null };
});
vi.mock("@/components/ProtectedRoute", () => {
  loaded.push("ProtectedRoute");
  return { default: () => null };
});

afterEach(() => {
  localStorage.clear();
  loaded.length = 0;
  vi.resetModules();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("/declutter's page starts on the first network round", () => {
  it("a signed-in member starts the Declutter page beside the app", async () => {
    localStorage.setItem("sb-test-auth-token", "{}");
    const { preloadEntryRoute } = await import("./routePreload");
    preloadEntryRoute("/declutter");
    await vi.waitFor(() => expect(loaded).toContain("DeclutterPage"));
    expect(loaded).not.toContain("Login");
  });

  it("a signed-out visitor starts Login, the page ProtectedRoute sends them to, and not the Declutter page", async () => {
    const { preloadEntryRoute } = await import("./routePreload");
    preloadEntryRoute("/declutter");
    await vi.waitFor(() => expect(loaded).toContain("Login"));
    await settle();
    expect(loaded).not.toContain("DeclutterPage");
  });
});
