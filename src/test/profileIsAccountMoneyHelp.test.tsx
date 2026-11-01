/**
 * PROFILE = ACCOUNT, MONEY, HELP; SECTION THINGS LIVE IN THEIR SECTION (owner,
 * 2026-10-19, PROMPT-LEAD "Global organization": "anything belonging to a
 * section lives in that section (not in Profile); Profile = account, money,
 * settings, help, grouped, short, Log Out clear and Delete account quiet").
 * Lead decision the same day (option A): the Jobs rows live at /jobs/settings,
 * reached by a "Jobs settings" row at the foot of Jobs > Posted and Working.
 *
 * Layers checked:
 *   1. Profile's groups are exactly Account / Money / Help, and none of their
 *      rows is a Jobs settings row (rendered through the real hook);
 *   2. /jobs/settings holds those rows in two groups, including Licensed &
 *      Insured (Q2200), each opening its existing /profile?tab= page;
 *   3. the route exists (ranked above /jobs/:id), the row is at the foot of
 *      both lists (and on an empty list), and goes to /jobs/settings;
 *   4. Delete account is a quiet text button, Log Out the clear pill.
 *
 * @mutate src/components/profile/profileLanding/useProfileLandingDerived.tsx |       title: "Help", |       title: "Legal",
 * @mutate src/components/profile/profileLanding/jobsSettingsGroups.tsx |       { key: "credentials", label: TAB_TITLES.credentials, |       { key: "credentials-x", label: TAB_TITLES.credentials,
 * @mutate src/pages/jobs/JobsSection.tsx | const JOBS_SETTINGS = { label: "Jobs settings", labelKey: "jobs.settings", path: "/jobs/settings" } as const; | const JOBS_SETTINGS = { label: "Jobs settings", labelKey: "jobs.settings", path: "/jobs" } as const;
 * @mutate src/pages/jobs/JobsSection.tsx | end={<>{browse?.end}<SectionSettingsButton settings={JOBS_SETTINGS} /></>} | end={browse?.end}
 * @mutate src/pages/jobs/JobsSection.tsx | end={<>{browse?.end}<SectionSettingsButton settings={JOBS_SETTINGS} /></>} | end={<><SectionSettingsButton settings={JOBS_SETTINGS} />{browse?.end}</>}
 * @mutate src/components/sections/AppTopBar.tsx |       onClick={() => navigate(settings.path, { replace: false })} |       onClick={() => navigate("/profile")}
 * @mutate src/App.tsx |       <Route path="/jobs/settings" element= |       <Route path="/jobs/settings-old" element=
 * @mutate src/components/profile/profileLanding/YouMenu.tsx |           className="w-full px-0 text-ds-13 font-semibold tracking-normal text-muted-foreground" |           className="w-full px-0 rounded-ds-lg py-3.5 border text-ds-13 font-semibold tracking-normal text-muted-foreground"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: null, isAdmin: true }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
const desktop = { on: false };
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => desktop.on }));
// Jobs' tab bodies: only the header JobsSection hands them is under test. Browse hands its controls to the tabs row's end.
vi.mock("@/pages/home/Dashboard", () => ({ default: ({ embeddedHeader }: { embeddedHeader: (b?: { end?: React.ReactNode }) => React.ReactNode }) => <>{embeddedHeader({ end: <button type="button" aria-label="Show the map" /> })}</> }));
// Posted / Working hand their search icon to the tabs row's end too (owner 2026-10-31: "next to the gear").
vi.mock("@/components/job-card/JobListPage", () => ({ default: ({ embeddedHeader }: { embeddedHeader: (b?: { end?: React.ReactNode }) => React.ReactNode }) => <>{embeddedHeader({ end: <button type="button" aria-label="Search this list" /> })}</> }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null, useSectionsOpen: () => ({ open: null, settled: false }) }));

import { useProfileLandingDerived } from "@/components/profile/profileLanding/useProfileLandingDerived";
import { JOBS_SETTINGS_GROUPS } from "@/components/profile/profileLanding/jobsSettingsGroups";
import JobsSection from "@/pages/jobs/JobsSection";

vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
// The title bars draw NotificationBell, which swaps the panel in: the same stand-in.
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }) }));

afterEach(() => { cleanup(); desktop.on = false; });
const src = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));

const jobsKeys = JOBS_SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.key));

describe("Profile is Account / Money / Help", () => {
  it("exactly those three groups, in that order, and no Jobs row among them", () => {
    const { result } = renderHook(() => useProfileLandingDerived({ profile: null }));
    const groups = result.current.menuGroups;
    expect(groups.map((g) => g.title)).toEqual(["Account", "Money", "Help"]);
    const keys = groups.flatMap((g) => g.items.map((i) => i.key));
    expect(keys.length).toBeGreaterThan(8);
    expect(keys.filter((k) => jobsKeys.includes(k))).toEqual([]);
    // Settings and help that belong to the account stay.
    for (const k of ["security", "notifications", "accessibility", "sections", "earnings", "referral", "gift-card", "support", "report_bug", "legal", "warnings"]) {
      expect(keys, k).toContain(k);
    }
  });
});

describe("Jobs settings", () => {
  it("two groups (When you post / When you work) holding the Jobs rows, Licensed & Insured among them (Q2200)", () => {
    expect(JOBS_SETTINGS_GROUPS.map((g) => g.title)).toEqual(["When you post", "When you work"]);
    expect(jobsKeys.length).toBeGreaterThan(7);
    for (const k of ["saved_helpers", "auto-tip", "str-settings", "pets", "home-history", "schedule", "availability", "credentials", "work-record"]) {
      expect(jobsKeys, k).toContain(k);
    }
    for (const item of JOBS_SETTINGS_GROUPS.flatMap((g) => g.items)) {
      expect(item.href, item.key).toMatch(/^\/profile\?tab=[a-z_]+$/);
    }
    expect(JOBS_SETTINGS_GROUPS.flatMap((g) => g.items).find((i) => i.key === "credentials")?.href).toBe("/profile?tab=credentials");
  });

  it("/jobs/settings is a route, declared before /jobs/:id", () => {
    const app = src("src/App.tsx");
    const settings = app.indexOf('<Route path="/jobs/settings" element=');
    expect(settings).toBeGreaterThan(-1);
    expect(settings).toBeLessThan(app.indexOf('<Route path="/jobs/:id" element='));
  });

  it("Jobs settings is a gear in the Jobs header, and no card is left at the foot of the list (owner 2026-10-21)", () => {
    const jobs = src("src/pages/jobs/JobsSection.tsx");
    expect(jobs).toContain('const JOBS_SETTINGS = { label: "Jobs settings", labelKey: "jobs.settings", path: "/jobs/settings" } as const;');
    // Never in the top bar any more (owner 2026-10-28): AppTopBar takes no settings at all.
    const bar = src("src/components/sections/AppTopBar.tsx");
    const topBar = bar.slice(bar.indexOf("export function AppTopBar("), bar.indexOf("export function SectionSettingsButton("));
    expect(topBar.length).toBeGreaterThan(200);
    expect(topBar).not.toMatch(/\bsettings\b/);
    expect(src("src/components/job-card/JobListPage.tsx")).not.toMatch(/JobsSettingsRow|Jobs settings/);
  });

  // Owner 2026-10-28, desktop /jobs: "move gear down with the other icons"; on Posted / Working it sits in the same
  // place, so it never jumps between tabs. On a phone it already ended the tabs row (owner 2026-10-22).
  it.each([
    ["phone", "/jobs", false], ["phone", "/jobs?tab=posted", false], ["phone", "/jobs?tab=working", false],
    ["desktop", "/jobs", true], ["desktop", "/jobs?tab=posted", true], ["desktop", "/jobs?tab=working", true],
  ] as const)("%s, %s: the gear is the LAST control at the tabs row's right end, never in the top bar, and opens /jobs/settings", (_w, url, onDesktop) => {
    desktop.on = onDesktop;
    function Where() {
      return <output data-testid="where">{useLocation().pathname}</output>;
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="*" element={<><JobsSection /><Where /></>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const gear = screen.getByRole("button", { name: "Jobs settings" });
    const row = screen.getByTestId("section-tabs");
    const controls = Array.from(row.querySelectorAll("button:not([role='tab'])"));
    expect(controls.length).toBeGreaterThan(0);
    expect(controls[controls.length - 1]).toBe(gear);
    if (url === "/jobs") expect(controls.map((b) => b.getAttribute("aria-label"))).toEqual(["Show the map", "Jobs settings"]);
    else expect(controls.map((b) => b.getAttribute("aria-label"))).toEqual(["Search this list", "Jobs settings"]);
    expect(screen.queryByTestId("app-top-bar")?.contains(gear) ?? false).toBe(false);
    expect(screen.queryByTestId("section-add")).toBeNull();
    fireEvent.click(gear);
    expect(screen.getByTestId("where").textContent).toBe("/jobs/settings");
  });
});

describe("Log Out clear, Delete account quiet", () => {
  it("Delete account is a small muted text button with no border or fill; Log Out keeps its bordered pill", () => {
    // Board 18 (2026-10-20): both live in YouMenu under the four rows.
    const s = src("src/components/profile/profileLanding/YouMenu.tsx");
    const at = s.indexOf('data-testid="profile-delete-account"');
    const del = s.slice(at, s.indexOf("Delete account", at));
    expect(del.length).toBeGreaterThan(20);
    expect(del).toMatch(/text-muted-foreground/);
    expect(del).not.toMatch(/border|rounded|py-3\.5|background|bg-/);
    const o = s.indexOf("onClick={onRequestLogout}");
    const out = s.slice(o, s.indexOf("Log out", o));
    expect(out).toMatch(/rounded-full/);
    expect(out).toMatch(/border: "1px solid/);
  });
});
