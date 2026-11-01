/**
 * THE WAY INTO /admin (owner, 2026-10-21: "I can't find the admin panel").
 * An admin reaches the console from the You list on the phone (an "Admin" row
 * directly above "Talk to a real person", board 18) and from the desktop rail's
 * Admin group. Both are drawn ONLY for a confirmed admin, read from ONE signal:
 * useCurrentUser's `isAdmin` (the `user_roles` read inside its query). Never
 * while that read is still loading, never when it failed, never for a member.
 *
 * Driven through the REAL useCurrentUser: only the Supabase client underneath
 * is stubbed, so a surface that grew its own role read, or read "not yet
 * known" as admin, goes red here. Hiding the row is not the protection: /admin
 * is behind AdminRoute (confirmed admin only) and the server's admin checks.
 *
 * @mutate src/components/profile/profileLanding/YouMenu.tsx |   const { user, isAdmin } = useCurrentUser(); |   const { user, adminStatus } = useCurrentUser(); const isAdmin = adminStatus !== "not_admin";
 * @mutate src/components/profile/profileLanding/YouMenu.tsx |         showAdmin={isAdmin} |         showAdmin={false}
 * @mutate src/components/profile/profileLanding/YouMenu.tsx |   return [...YOU_ROWS.slice(0, at), ADMIN_ROW, ...YOU_ROWS.slice(at)]; |   return [...YOU_ROWS, ADMIN_ROW];
 * @mutate src/components/profile/profileLanding/YouMenu.tsx | (key === ADMIN_ROW.key ? navigate("/admin") : onSelectTab(key)) | onSelectTab(key)
 * @mutate src/components/DesktopSidebarNav.tsx |   const { user, isAdmin } = useCurrentUser(); |   const { user, adminStatus } = useCurrentUser(); const isAdmin = adminStatus !== "not_admin";
 * @mutate src/components/DesktopSidebarNav.tsx |         {isAdmin && <AdminNavGroup />} |         {true && <AdminNavGroup />}
 * @mutate src/hooks/useCurrentUser.ts |     isAdmin: adminStatus === "admin", |     isAdmin: adminStatus !== "not_admin",
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { blankComments } from "./helpers/blankNonCode";

type Answer = { data: unknown; error: unknown };
const db = vi.hoisted(() => ({
  role: (): Promise<Answer> => Promise.resolve({ data: null, error: null }),
  roleReads: 0,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: (): Promise<Answer> => {
          if (table === "profiles") return Promise.resolve({ data: { user_id: "u1", full_name: "Owner" }, error: null });
          if (table === "user_roles") { db.roleReads++; return db.role(); }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return b;
    },
  },
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/pages/home/homeDashboard/homeMoney", () => ({ useHomeMoney: () => ({ coming: null, held: null }) }));
// The rail's other reads, as in desktopLeftSidebar.test.tsx.
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => true }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, gate: (_k: string, fn: () => void) => fn, gatedProps: () => ({}) }) }));
vi.mock("@/lib/needsYouStore", () => ({ useNeedsYouCounts: () => ({ total: 0, jobs: 0, shops: 0 }) }));
vi.mock("@/components/mobileNav/useNavUnreadCount", () => ({ useNavUnreadCount: () => ({ unreadCount: 0 }) }));
vi.mock("@/components/admin/adminBadgeStore", () => ({ useAdminBadges: () => ({}) }));
vi.mock("@/lib/routePrefetch", () => ({ prefetchRoute: () => {} }));
vi.mock("@/components/mobileNav/useDockSheets", async () => { const m = await import("@/components/mobileNav/dockSheets"); return { useDockSheetsLoader: () => m }; }); // sheets at once: their lazy load is dockSheetsLoadOnTap.test.tsx
vi.mock("@/components/create/CreateSheet", () => ({ CreateSheet: () => null }));

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { YouMenu, YOU_ROWS, ADMIN_ROW } from "@/components/profile/profileLanding/YouMenu";
import DesktopSidebarNav from "@/components/DesktopSidebarNav";

let path = "";
function Where() { const l = useLocation(); path = l.pathname + l.search; return null; }
/** What the shared hook says, so each case is shown to have reached its state (not merely not-yet-rendered). */
function Probe() {
  const { adminStatus, isLoading } = useCurrentUser();
  return <i data-testid="probe" data-status={adminStatus} data-loading={String(isLoading)} />;
}

const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrap = (ui: ReactNode) => (
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={["/home"]}>{ui}<Probe /><Where /></MemoryRouter></QueryClientProvider>
  );
  return render(wrap(<><DesktopSidebarNav /><YouMenu onSelectTab={() => {}} onRequestLogout={() => {}} onRequestDelete={() => {}} /></>));
};
const probe = () => screen.getByTestId("probe");
const youRowKeys = () => [...document.querySelectorAll("[data-you-row]")].map((b) => b.getAttribute("data-you-row"));
const railAdmin = () => document.querySelector('nav[aria-label="Primary"] [aria-controls="side-panel-admin-sections"]');

beforeEach(() => { db.roleReads = 0; path = ""; });
afterEach(cleanup);

describe("the Admin entry is for confirmed admins only, from the shared role signal", () => {
  it("an admin: the You row sits directly above Talk to a real person and opens /admin; the rail has Admin", async () => {
    db.role = () => Promise.resolve({ data: { role: "admin" }, error: null });
    mount();
    await waitFor(() => expect(probe().dataset.status).toBe("admin"));
    const keys = youRowKeys();
    expect(keys).toEqual(["earnings", "notifications", "settings", ADMIN_ROW.key, "support"]);
    expect(keys.indexOf("support") - keys.indexOf("admin")).toBe(1);
    const rail = railAdmin() as HTMLButtonElement;
    expect(rail?.textContent).toBe("Admin");
    // Open by default for an admin (owner 2026-10-27): no click needed.
    expect(rail.getAttribute("aria-expanded")).toBe("true");
    const sections = [...document.querySelectorAll("#side-panel-admin-sections button")] as HTMLButtonElement[];
    expect(sections.length).toBeGreaterThan(5);
    fireEvent.click(sections.find((x) => x.textContent === "Dashboard")!);
    expect(path).toBe("/admin?view=home");

    const row = document.querySelector('[data-you-row="admin"]') as HTMLButtonElement;
    expect(row.textContent).toBe("Admin");
    fireEvent.click(row);
    expect(path).toBe("/admin");
  });

  it("a member: no Admin row, no rail Admin", async () => {
    db.role = () => Promise.resolve({ data: null, error: null });
    mount();
    await waitFor(() => expect(probe().dataset.status).toBe("not_admin"));
    expect(youRowKeys()).toEqual(YOU_ROWS.map((r) => r.key));
    expect(railAdmin()).toBeNull();
    expect(screen.queryByText("Admin")).toBeNull();
  });

  it("while the role is still loading: neither shows", async () => {
    db.role = () => new Promise<Answer>(() => {});
    mount();
    await waitFor(() => expect(db.roleReads).toBe(1));
    expect(probe().dataset.loading).toBe("true");
    expect(probe().dataset.status).toBe("unknown");
    expect(youRowKeys()).toEqual(YOU_ROWS.map((r) => r.key));
    expect(railAdmin()).toBeNull();
  });

  it("when the role read failed: neither shows (unknown is not admin)", async () => {
    db.role = () => Promise.resolve({ data: null, error: { message: "permission denied", code: "42501" } });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mount();
      await waitFor(() => expect(probe().dataset.loading).toBe("false"), { timeout: 4000 });
      expect(probe().dataset.status).toBe("unknown");
      expect(db.roleReads).toBeGreaterThan(1);
      expect(youRowKeys()).toEqual(YOU_ROWS.map((r) => r.key));
      expect(railAdmin()).toBeNull();
    } finally {
      quiet.mockRestore();
    }
  });

  it("both surfaces read useCurrentUser's isAdmin, and neither reads roles itself", () => {
    const files = ["src/components/profile/profileLanding/YouMenu.tsx", "src/components/DesktopSidebarNav.tsx"];
    for (const f of files) {
      const src = blankComments(readFileSync(resolve(__dirname, "../..", f), "utf8"));
      expect(src, f).toMatch(/const \{[^}]*\bisAdmin\b[^}]*\} = useCurrentUser\(\)/);
      expect(src, f).not.toMatch(/user_roles|supabase|adminStatus|has_role|is_admin/);
    }
    expect(files.length).toBeGreaterThan(1);
  });

  it("the skeleton draws no admin row (it cannot know the role)", () => {
    const skel = blankComments(readFileSync(resolve(__dirname, "../components/profile/ProfilePageSkeleton.tsx"), "utf8"));
    expect(skel).toContain("<YouMenuList captions={YOU_STATIC_CAPTIONS} />");
    expect(skel).not.toMatch(/showAdmin/);
  });
});
