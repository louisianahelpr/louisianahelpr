import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";

/**
 * App sign-ins (owner 2026-11-20: "add an app download feature ... and do your best to say which people it came
 * from"). The native app records who signs in on it (record_app_open, 20261120150247) and the admin home shows
 * "App sign-ins this week": counts by platform, new vs returning, and the members whose FIRST app sign-in was this
 * week, newest first, with name, town, platform and first seen. A not-yet-deployed RPC (PGRST202) says so instead of
 * reading as "nobody"; any other failure is an error with a retry. The web never calls record_app_open.
 * Server side (own row only, cascade, export section, admin only, test accounts left out):
 * src/test/pglite/appInstalls.pglite.mjs.
 *
 * @mutate src/components/admin/dashboard/AppSignInsCard.tsx | supabase.rpc("admin_app_signins_week") | supabase.rpc("admin_app_signins_week_x")
 * @mutate src/components/admin/dashboard/AppSignInsCard.tsx | if (isMissingRpcNamed(res.error, "admin_app_signins_week")) return { unavailable: true }; | if (false) return { unavailable: true };
 * @mutate src/components/admin/dashboard/AppSignInsCard.tsx |         <span>{m.town?.trim() \|\| "No town"}</span> |         <span>{"No town"}</span>
 * @mutate src/components/admin/dashboard/AppSignInsCard.tsx |         <Stat label="Returning on Android" value={w.android_returning} /> |         <Stat label="Returning on Android" value={w.android_new} />
 * @mutate src/components/admin/dashboard/AppSignInsCard.tsx |   const w = (unwrap(res) ?? {}) as Partial<Week>; |   const w = (res.data ?? {}) as Partial<Week>;
 * @mutate src/lib/appSignIns.ts |   if (!isNativePlatform) return null; |   if (false) return null;
 * @mutate src/lib/appSignIns.ts |     if (!userId \|\| !nativeAppPlatform()) return; |     if (!nativeAppPlatform()) return;
 * @mutate src/components/SessionManager.tsx |   useRecordAppOpen(user?.id); |   void 0;
 * @mutate src/pages/admin/Admin.tsx |           <AppSignInsCard /> |           {null}
 */

const h = vi.hoisted(() => ({
  current: { data: null as unknown, error: null as unknown },
  calls: [] as { name: string; args?: unknown }[],
  native: false,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args?: unknown) => {
      h.calls.push({ name, args });
      return h.current;
    },
  },
}));
vi.mock("@/lib/nativeInit", () => ({
  get isNativePlatform() {
    return h.native;
  },
}));
vi.mock("@capacitor/app", () => ({
  App: {
    getInfo: async () => ({ version: "1.0.4", build: "7601" }),
    addListener: async () => ({ remove: async () => {} }),
  },
}));

import { AppSignInsCard } from "@/components/admin/dashboard/AppSignInsCard";
import { recordAppOpen, nativeAppPlatform } from "@/lib/appSignIns";

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppSignInsCard />
    </QueryClientProvider>,
  );
}

const member = (n: number, name: string, town: string | null, platform: "ios" | "android", day: string) => ({
  user_id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
  name,
  town,
  platform,
  first_seen_at: day,
});

describe("App sign-ins this week (admin home card)", () => {
  beforeEach(() => {
    h.current = { data: null, error: null };
    h.calls = [];
    h.native = false;
    (window as { Capacitor?: unknown }).Capacitor = undefined;
  });

  it("reads admin_app_signins_week and shows counts by platform and the new members with town, platform and first seen", async () => {
    h.current = {
      data: {
        ios_new: 2, ios_returning: 5, android_new: 1, android_returning: 3,
        new_members: [
          member(1, "Cal Comeaux", "Abbeville", "android", "2026-11-19T15:00:00Z"),
          member(2, "Ben Broussard", "Delcambre", "ios", "2026-11-18T15:00:00Z"),
          member(3, "Ann Arceneaux", null, "ios", "2026-11-17T15:00:00Z"),
        ],
      },
      error: null,
    };
    renderCard();
    expect(await screen.findByText("Cal Comeaux")).toBeInTheDocument();
    expect(h.calls.map((c) => c.name)).toEqual(["admin_app_signins_week"]);
    const stat = (label: string) => screen.getByText(label).previousElementSibling?.textContent;
    expect(stat("New on iPhone")).toBe("2");
    expect(stat("Returning on iPhone")).toBe("5");
    expect(stat("New on Android")).toBe("1");
    expect(stat("Returning on Android")).toBe("3");
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("p")?.textContent)).toEqual(["Cal Comeaux", "Ben Broussard", "Ann Arceneaux"]);
    const ben = within(items[1]);
    expect(ben.getByText("Delcambre")).toBeInTheDocument();
    expect(ben.getByText("iPhone")).toBeInTheDocument();
    expect(ben.getByText(/^First signed in /)).toBeInTheDocument();
    expect(within(items[2]).getByText("No town")).toBeInTheDocument();
  });

  it("shows ten, then all on Show all", async () => {
    h.current = {
      data: {
        ios_new: 12, ios_returning: 0, android_new: 0, android_returning: 0,
        new_members: Array.from({ length: 12 }, (_, n) => member(n + 1, `Member ${n + 1}`, "Lafayette", "ios", "2026-11-19T15:00:00Z")),
      },
      error: null,
    };
    renderCard();
    expect(await screen.findByText("Member 1")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Show all 12" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
  });

  it("says plainly when nobody is new this week (an empty list is not an error)", async () => {
    h.current = { data: { ios_new: 0, ios_returning: 1, android_new: 0, android_returning: 0, new_members: [] }, error: null };
    renderCard();
    expect(await screen.findByText("No new app sign-ins this week")).toBeInTheDocument();
  });

  it("a not-yet-deployed RPC says so; it never reads as nobody", async () => {
    h.current = { data: null, error: { code: "PGRST202", message: "Could not find the function public.admin_app_signins_week without parameters in the schema cache" } };
    renderCard();
    expect(await screen.findByText(/Not available yet/)).toBeInTheDocument();
    expect(screen.queryByText("No new app sign-ins this week")).not.toBeInTheDocument();
  });

  it("any other failure is an error with a retry, never an empty card", async () => {
    h.current = { data: null, error: { code: "42501", message: "admin_only" } };
    renderCard();
    expect(await screen.findByText("Couldn't load app sign-ins")).toBeInTheDocument();
    expect(screen.getByText("Only admins can see app sign-ins.")).toBeInTheDocument();
    expect(screen.queryByText("No new app sign-ins this week")).not.toBeInTheDocument();
  });
});

describe("record_app_open: the native app only", () => {
  beforeEach(() => {
    h.current = { data: true, error: null };
    h.calls = [];
  });

  it("the web never calls it", async () => {
    h.native = false;
    (window as { Capacitor?: unknown }).Capacitor = { getPlatform: () => "web" };
    expect(nativeAppPlatform()).toBeNull();
    await recordAppOpen();
    expect(h.calls).toEqual([]);
    // isNativePlatform decides, not getPlatform alone (the way nativeInit.ts tells the app from the web).
    (window as { Capacitor?: unknown }).Capacitor = { getPlatform: () => "ios" };
    expect(nativeAppPlatform()).toBeNull();
    await recordAppOpen();
    expect(h.calls).toEqual([]);
  });

  it("the iOS app sends its platform and version", async () => {
    h.native = true;
    (window as { Capacitor?: unknown }).Capacitor = { getPlatform: () => "ios" };
    await recordAppOpen();
    expect(h.calls).toEqual([{ name: "record_app_open", args: { p_platform: "ios", p_app_version: "1.0.4" } }]);
  });

  it("the Android app sends android", async () => {
    h.native = true;
    (window as { Capacitor?: unknown }).Capacitor = { getPlatform: () => "android" };
    await recordAppOpen();
    expect(h.calls[0]?.args).toEqual({ p_platform: "android", p_app_version: "1.0.4" });
  });

  it("SessionManager records it for the signed-in member, and the admin home mounts the card", () => {
    const sm = blankComments(readFileSync(resolve(process.cwd(), "src/components/SessionManager.tsx"), "utf8"));
    expect(sm).toMatch(/\buseRecordAppOpen\(user\?\.id\);/);
    const admin = blankComments(readFileSync(resolve(process.cwd(), "src/pages/admin/Admin.tsx"), "utf8"));
    expect(admin).toMatch(/<AppSignInsCard \/>/);
    const hook = blankComments(readFileSync(resolve(process.cwd(), "src/lib/appSignIns.ts"), "utf8"));
    expect(hook).toMatch(/if \(!userId \|\| !nativeAppPlatform\(\)\) return;/);
  });
});
