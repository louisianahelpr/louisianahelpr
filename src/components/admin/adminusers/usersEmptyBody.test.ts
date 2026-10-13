/**
 * The admin Users list's empty-state line (seen 2026-10-12 proving Q913: a
 * search for "zzz" on the All tab read "Nothing is total right now. Try another
 * tab above.", the tab's COUNT label dropped into a sentence, and no word that
 * a search was on). AdminUsers.tsx renders exactly usersEmptyBody's answer.
 *
 * @mutate src/components/admin/adminusers/useAdminUsersFilter.ts |   if (q) return `No user matches "${q}". Try a different name or email.`; |   if (q && false) return `No user matches "${q}". Try a different name or email.`;
 * @mutate src/components/admin/adminusers/useAdminUsersFilter.ts |   if (tab === "all") return "No users yet."; |   if (tab === "none") return "No users yet.";
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { usersEmptyBody } from "./useAdminUsersFilter";

const TABS = ["all", "approved", "banned", "awaiting_email"] as const;

describe("admin Users empty state names what is empty", () => {
  it("a search that matches nobody says so, on every tab", () => {
    expect(TABS.length).toBeGreaterThan(3);
    for (const tab of TABS) {
      const body = usersEmptyBody({ hiddenTestMatches: 0, query: "  zzz ", tab, tabLabel: "total" });
      expect(body).toBe('No user matches "zzz". Try a different name or email.');
      expect(body).not.toMatch(/total/);
    }
  });

  it("an empty All tab never reads 'Nothing is total'", () => {
    expect(usersEmptyBody({ hiddenTestMatches: 0, query: "", tab: "all", tabLabel: "total" })).toBe("No users yet.");
  });

  it("an empty named tab still names itself; hidden test matches still win", () => {
    expect(usersEmptyBody({ hiddenTestMatches: 0, query: "", tab: "banned", tabLabel: "banned" })).toBe("Nothing is banned right now. Try another tab above.");
    expect(usersEmptyBody({ hiddenTestMatches: 2, query: "seed", tab: "all", tabLabel: "total" })).toMatch(/^2 test accounts match/);
  });

  it("AdminUsers renders the helper's answer, not its own sentence", () => {
    const src = readFileSync(resolve(__dirname, "../AdminUsers.tsx"), "utf8");
    expect(src).toMatch(/body=\{usersEmptyBody\(\{ hiddenTestMatches, query: trimmedQuery, tab, tabLabel: tabCountLabel\[tab\] \}\)\}/);
    expect(src).not.toMatch(/Try another tab above/);
  });
});
