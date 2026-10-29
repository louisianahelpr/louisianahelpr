/**
 * A3-C13 (app audit 2026-10-29): with Jobs the only OPEN section, Settings ›
 * Your sections let a member switch Jobs off with no warning (the rule counted
 * all four sections, open or not), and + Create then listed only three
 * "Coming soon" rows with no reason.
 *
 * Now: the last open section cannot be hidden (Settings and Customize say
 * "Keep at least one open section on"), and a member who already hid every
 * open section is told so in + Create, with a button to show it again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toasts = vi.hoisted(() => [] as string[]);
vi.mock("sonner", () => ({
  toast: Object.assign((m: string) => { toasts.push(m); }, { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-sections" }, profile: null, isAdmin: false, refresh: vi.fn() }),
}));
// Only Jobs is open: every section switch is off for this member.
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false, useFeatureStatus: () => ({ on: false, settled: true }) }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/hooks/useDarkMode", () => ({ useDarkMode: () => ({ theme: "system" }) }));
vi.mock("@/hooks/useAgeGate", () => ({
  useAgeGate: () => ({ underAge: false, explain: () => {}, gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }),
}));
vi.mock("@/lib/shops/api", () => ({ fetchMyShopId: async () => null }));

import { hidesLastOpenSection, KEEP_ONE_OPEN_TOAST } from "@/components/sections/useSectionPrefs";
import { SettingsTab } from "@/components/profile/SettingsTab";
import { CreateSheet } from "@/components/create/CreateSheet";

const PREFS_KEY = "helpr_section_prefs:u-sections";

beforeEach(() => {
  toasts.length = 0;
  localStorage.clear();
});
afterEach(cleanup);

describe("the last open section stays on (A3-C13)", () => {
  it("the rule counts OPEN sections, not all four", () => {
    expect(hidesLastOpenSection([], "jobs", ["jobs"])).toBe(true);
    expect(hidesLastOpenSection([], "jobs", ["jobs", "declutter"])).toBe(false);
    expect(hidesLastOpenSection(["declutter"], "jobs", ["jobs", "declutter"])).toBe(true);
    // A closed section can always be hidden.
    expect(hidesLastOpenSection([], "homes", ["jobs"])).toBe(false);
    // Never all four, whatever is open.
    expect(hidesLastOpenSection(["jobs", "declutter", "shops"], "homes", [])).toBe(true);
  });

  it("Settings refuses to switch off Jobs while it is the only open section, and says why", () => {
    render(
      <MemoryRouter>
        <SettingsTab profile={null} seniorMode={false} onSelectTab={vi.fn()} onRequestLogout={vi.fn()} onBack={() => {}} />
      </MemoryRouter>,
    );
    const sections = screen.getByRole("region", { name: "Your sections" });
    const jobs = within(sections).getByRole("switch", { name: "Show Jobs" });
    expect(jobs.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(jobs);
    expect(toasts).toContain(KEEP_ONE_OPEN_TOAST);
    expect(within(sections).getByRole("switch", { name: "Show Jobs" }).getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem(PREFS_KEY) ?? "").not.toContain('"jobs"],');
  });

  it("+ Create says why it is empty when Jobs was already hidden, and can show it again", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ order: ["jobs", "declutter", "shops", "homes"], hidden: ["jobs"] }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CreateSheet open onOpenChange={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const note = screen.getByTestId("create-all-hidden");
    expect(note.textContent).toMatch(/You hid Jobs in Settings/);
    fireEvent.click(within(note).getByRole("button", { name: "Show Jobs" }));
    expect(screen.queryByTestId("create-all-hidden")).toBeNull();
    expect(document.querySelector('[data-create-row="jobs"]')).not.toBeNull();
  });
});

// @mutate src/components/sections/useSectionPrefs.ts |   return openKeys.length > 0 && openKeys.every((k) => next.has(k)); |   return false;
// @mutate src/components/create/CreateSheet.tsx |   const hiddenOpen = visible.some(isOn) ? [] : | const hiddenOpen = true ? [] :
