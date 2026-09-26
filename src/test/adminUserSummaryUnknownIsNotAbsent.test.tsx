// @vitest-environment jsdom
/**
 * #1582 (press-every-control run 36069319716): /admin?view=people failed 5
 * presses, 4 of them the same rows in the run before (35976390920). The row
 * text the sweep inventoried was "AW Audit W. Active TEST Good East Baton
 * Rouge Never logged in"; the previous run, reading the settled screen, saw
 * "AW Audit W. Active 5.0 (1) East Baton Rouge 8 days ago". Every row said
 * "Good" standing and "Never logged in" (in red) until useAdminUserSummaries'
 * un-awaited reads landed, because an empty map was read as "none", and it
 * said so for good whenever the login_history read failed (that error was
 * only logged). The sweep identifies a control by its text, so the row it
 * inventoried did not exist once the real text arrived.
 *
 * Fix: a summary map is `null` until known (typed, so every reader decides),
 * the row makes no absence claim from an unknown map, and the list is
 * aria-busy until every loader has settled.
 *
 * CLASS, from the hook's own inventory: every `load…Summary` loader is inside
 * the settled gate, so a new summary cannot render before the list stops
 * saying it is busy.
 *
 * @mutate src/components/admin/adminusers/AdminUserRow.tsx | const neverLoggedIn = lastLoginSummary !== null && !lastLogin; | const neverLoggedIn = !lastLogin;
 * @mutate src/components/admin/adminusers/AdminUserRow.tsx | {strikesSummary !== null && (strikes > 0 \|\| neverLoggedIn) && chip( | {(strikes > 0 \|\| !lastLogin) && chip(
 * @mutate src/components/admin/useAdminUserSummaries.ts |     setLastLoginSummary(loginRes.error ? null : logins); |     setLastLoginSummary(logins);
 * @mutate src/components/admin/useAdminUserSummaries.ts |       loadOpenReportsSummary(userIds),\n | \n
 * @mutate src/components/admin/AdminUsers.tsx |         <div aria-busy={!summariesSettled}> |         <div>
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { AdminUserRow } from "@/components/admin/adminusers/AdminUserRow";
import type { Profile } from "@/components/admin/adminUserHelpers";

const ROOT = resolve(__dirname, "..", "..");
const read = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

const profile = {
  id: "p1", user_id: "u1", full_name: "Audit Walker", email: "a@example.com",
  email_verified: true, parish: "East Baton Rouge", created_at: "2026-09-01T00:00:00Z",
} as unknown as Profile;

const row = (maps: { strikes: Record<string, number> | null; logins: Record<string, string> | null }) =>
  render(
    <MemoryRouter>
      <AdminUserRow
        p={profile}
        tab={"all" as never}
        notesSummary={{}}
        strikesSummary={maps.strikes}
        ratingSummary={{}}
        jobsCompletedSummary={{}}
        paySummary={{}}
        openReportsSummary={{}}
        lastLoginSummary={maps.logins}
        onOpen={() => {}}
      />
    </MemoryRouter>,
  ).container.textContent ?? "";

describe("an admin user row makes no claim from a summary that has not loaded (#1582)", () => {
  it("unknown maps: no 'Never logged in', no 'Good' standing", () => {
    const text = row({ strikes: null, logins: null });
    expect(text).toContain("Audit");
    expect(text).not.toContain("Never logged in");
    expect(text).not.toContain("Good");
  });

  it("loaded and empty: the claims are true and shown", () => {
    const text = row({ strikes: {}, logins: {} });
    expect(text).toContain("Never logged in");
    expect(text).toContain("Good");
  });

  it("loaded with a login: no 'Never logged in'", () => {
    const text = row({ strikes: {}, logins: { u1: new Date(Date.now() - 3600_000).toISOString() } });
    expect(text).not.toContain("Never logged in");
  });

  it("a failed login_history read leaves the map unknown, not empty", () => {
    expect(read("src/components/admin/useAdminUserSummaries.ts")).toMatch(/setLastLoginSummary\(loginRes\.error \? null : logins\)/);
  });

  it("every load…Summary loader in the hook is inside the settled gate", () => {
    const hook = read("src/components/admin/useAdminUserSummaries.ts");
    const loaders = [...hook.matchAll(/const (load\w+Summary) = async/g)].map((m) => m[1]);
    // Inventory floor, measured 2026-09-25: notes, strikes, activity, pay, rating, jobsCompleted, openReports.
    expect(loaders.length).toBeGreaterThanOrEqual(7);
    const gate = hook.match(/Promise\.allSettled\(\[([\s\S]*?)\]\)\.then\(\(\) => setSummariesSettled\(true\)\)/)?.[1] ?? "";
    expect(loaders.filter((l) => !new RegExp(`\\b${l}\\(`).test(gate))).toEqual([]);
  });

  it("the People list is aria-busy until the summaries settle", () => {
    expect(read("src/components/admin/AdminUsers.tsx")).toMatch(/<div aria-busy=\{!summariesSettled\}>\s*<VirtualList/);
  });
});
