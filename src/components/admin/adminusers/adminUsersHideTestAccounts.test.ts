import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { trackedFiles } from "../../../test/helpers/trackedFiles";
import { blankComments } from "../../../test/helpers/blankNonCode";
import { filterAndSortProfiles, getTabCounts, isTestAccount } from "./useAdminUsersFilter";
import type { Profile } from "../adminUserHelpers";

// Owner, 2026-10-09: "hide all test accounts from users in my admin panel so i
// can see the actual number of real users". The CLASS: any number the admin
// reads as "users" that silently includes test accounts (`profiles.is_seed`).
// Three layers carry such a number:
//   1. the Users list itself, its header count and its tab badges (client-side
//      over one paged read; no count RPC behind it) — behaviour checked below;
//   2. every `profiles` COUNT read on an admin screen (`{ count: ... }`), e.g.
//      the dashboard's Total Users tile — each must say what it does with
//      is_seed;
//   3. AdminAnalytics' shared `profilesQuery` builder.
// @mutate src/components/admin/adminusers/useAdminUsersFilter.ts | if (!includeTest && isTestAccount(p)) return false; | if (false) return false;
// @mutate src/components/admin/adminusers/useAdminUsersFilter.ts | const profiles = includeTest ? allProfiles : allProfiles.filter((p) => !isTestAccount(p)); | const profiles = allProfiles;
// @mutate src/components/admin/AdminUsers.tsx | includeTest: showTest, | includeTest: true,
// @mutate src/components/admin/AdminUsers.tsx | getTabCounts(profiles, isUnseen, showTest); | getTabCounts(profiles, isUnseen, true);
// @mutate src/pages/admin/Admin.tsx | supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_seed", false), | supabase.from("profiles").select("id", { count: "exact", head: true }),

const REPO = join(__dirname, "../../../..");

const profile = (over: Partial<Profile>): Profile =>
  ({
    id: over.user_id ?? "x",
    user_id: "x",
    full_name: "Person",
    email: "p@example.com",
    email_verified: true,
    ban_status: null,
    is_seed: false,
    created_at: "2026-10-09T00:00:00Z",
    ...over,
  }) as Profile;

const real1 = profile({ user_id: "r1", full_name: "Real One" });
const real2 = profile({ user_id: "r2", full_name: "Real Two" });
const test1 = profile({ user_id: "t1", full_name: "App Review", email: "apple-reviewer@louisianahelpr.com", is_seed: true });
const all = [real1, test1, real2];

const deps = { tab: "all" as const, searchQuery: "", sortDir: "alpha" as const, strikesSummary: null, lastLoginSummary: null, paySummary: {} };

describe("admin Users list hides test accounts by default (owner, 2026-10-09)", () => {
  it("isTestAccount reads is_seed, the column the TEST chip reads", () => {
    expect(isTestAccount(test1)).toBe(true);
    expect(isTestAccount(real1)).toBe(false);
    const row = readFileSync(join(REPO, "src/components/admin/adminusers/AdminUserRow.tsx"), "utf8");
    expect(blankComments(row)).toMatch(/p\.is_seed && <TestTag \/>/);
  });

  it("the list leaves test accounts out unless asked, and shows them when asked", () => {
    expect(filterAndSortProfiles({ ...deps, profiles: all, includeTest: false }).map((p) => p.user_id)).toEqual(["r1", "r2"]);
    expect(filterAndSortProfiles({ ...deps, profiles: all, includeTest: true }).map((p) => p.user_id).sort()).toEqual(["r1", "r2", "t1"]);
    // A search that only matches a test account finds nothing while hidden.
    expect(filterAndSortProfiles({ ...deps, profiles: all, searchQuery: "apple-reviewer", includeTest: false })).toEqual([]);
  });

  it("the tab badges count real users only unless asked", () => {
    const unseen = () => true;
    expect(getTabCounts(all, unseen, false).allCount).toBe(2);
    expect(getTabCounts(all, unseen, false).approvedCount).toBe(2);
    expect(getTabCounts(all, unseen, true).allCount).toBe(3);
  });

  it("AdminUsers wires the toggle into BOTH the list and the badges, off by default", () => {
    const src = blankComments(readFileSync(join(REPO, "src/components/admin/AdminUsers.tsx"), "utf8"));
    expect(src).toContain('const showTest = searchParams.get("test") === "show";');
    expect(src).toContain("includeTest: showTest,");
    expect(src).toContain("getTabCounts(profiles, isUnseen, showTest);");
    expect(src).toMatch(/Show test accounts/);
  });
});

/** Every `.from("profiles")` chain in `text` that asks for a count, as the chain's text. */
function profileCountChains(text: string): string[] {
  const out: string[] = [];
  const re = /\.from\(\s*["'`]profiles["'`]\s*\)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const rest = text.slice(m.index, m.index + 600);
    const end = rest.search(/;|,\s*\n|\n\s*\n/);
    const chain = end === -1 ? rest : rest.slice(0, end);
    if (/\bcount\s*:/.test(chain)) out.push(chain);
  }
  return out;
}

describe("every admin count of profiles says what it does with test accounts", () => {
  const files = [...trackedFiles("src/components/admin"), ...trackedFiles("src/pages/admin")].filter(
    (f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f),
  );
  const chains: { file: string; chain: string }[] = [];
  for (const f of files) {
    const text = blankComments(readFileSync(join(REPO, f), "utf8"));
    for (const chain of profileCountChains(text)) chains.push({ file: f, chain });
  }

  it("finds the counts it guards (inventory floor)", () => {
    // Admin.tsx loadStats: Total Users, subscribers, test subscribers.
    expect(chains.length).toBeGreaterThan(2);
  });

  it("each one filters on is_seed", () => {
    const bad = chains.filter((c) => !/\.eq\(\s*["']is_seed["']/.test(c.chain)).map((c) => `${c.file}: ${c.chain.replace(/\s+/g, " ")}`);
    expect(bad).toEqual([]);
  });

  it("AdminAnalytics' shared profiles builder excludes test accounts", () => {
    const src = blankComments(readFileSync(join(REPO, "src/components/admin/AdminAnalytics.tsx"), "utf8"));
    expect(src).toMatch(/const profilesQuery = \(columns: string\) => supabase\.from\("profiles"\)\.select\(columns\)\.eq\("is_seed", false\);/);
    // ...and it is the only way that screen reads profiles.
    expect(src.match(/\.from\(\s*["']profiles["']\s*\)/g)?.length).toBe(1);
  });
});
