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
 * @mutate src/pages/jobs/JobsSection.tsx |  settings={{ label: "Jobs settings", path: "/jobs/settings" }} | 
 * @mutate src/components/sections/AppTopBar.tsx |             onClick={() => navigate(settings.path)} |             onClick={() => navigate("/profile")}
 * @mutate src/App.tsx |       <Route path="/jobs/settings" element= |       <Route path="/jobs/settings-old" element=
 * @mutate src/components/profile/profileLanding/YouMenu.tsx |           className="w-full min-h-11 inline-flex items-center justify-center text-ds-13 font-semibold text-muted-foreground | className="w-full rounded-ds-lg py-3.5 border inline-flex items-center justify-center text-ds-13 font-semibold text-muted-foreground
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: null, isAdmin: true }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));

import { useProfileLandingDerived } from "@/components/profile/profileLanding/useProfileLandingDerived";
import { JOBS_SETTINGS_GROUPS } from "@/components/profile/profileLanding/jobsSettingsGroups";
import { AppTopBar } from "@/components/sections/AppTopBar";

vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }) }));

afterEach(cleanup);
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

  it("Jobs settings is a gear in the Jobs header, right of the +, and no card is left at the foot of the list (owner 2026-10-21)", () => {
    expect(src("src/pages/jobs/JobsSection.tsx")).toContain('settings={{ label: "Jobs settings", path: "/jobs/settings" }}');
    expect(src("src/components/job-card/JobListPage.tsx")).not.toMatch(/JobsSettingsRow|Jobs settings/);
  });

  it("the gear sits right of the +, is a 44px control, and opens /jobs/settings", () => {
    function Where() {
      return <output data-testid="where">{useLocation().pathname}</output>;
    }
    render(
      <MemoryRouter initialEntries={["/jobs?tab=posted"]}>
        <Routes>
          <Route path="*" element={<><AppTopBar title="Jobs" add={{ label: "Post a job", path: "/post-job" }} settings={{ label: "Jobs settings", path: "/jobs/settings" }} /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    );
    const add = screen.getByTestId("section-add");
    const gear = screen.getByRole("button", { name: "Jobs settings" });
    expect(add.compareDocumentPosition(gear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gear.className).toBe(add.className);
    expect(gear.className).toMatch(/\bh-11\b/);
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
