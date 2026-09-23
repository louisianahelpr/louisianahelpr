/**
 * Q232: admin views never read the whole `profiles` table to show a list or a
 * count.
 *
 * AdminUsers did `supabase.from("profiles").select("*")` with no page size and
 * derived every tab count from the array's length, so the console's cost and
 * the truth of its counts both scaled with the user table. The fix pages the
 * list server-side (`.range()`) and counts with `head: true`.
 *
 * The CLASS, inventoried from source: every `.from("profiles")` READ under
 * src/components/admin and src/pages/Admin*.tsx must be bounded — a page
 * (`.range`/`.limit`), a key lookup (`.in`, `.eq("user_id"|"id")`,
 * `.maybeSingle`/`.single`) or a count (`head: true`). The few whole-table
 * reads that remain are named below, exactly; each is its own queue item.
 *
 * @mutate src/components/admin/adminusers/adminUsersQuery.ts | .range(offset, offset + ADMIN_USERS_PAGE_SIZE - 1); | ;
 * @mutate src/components/admin/adminusers/adminUsersQuery.ts | select("id", { count: "exact", head: true }) | select("id", { count: "exact" })
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { applyTabFilter, searchOrFilter, type FilterableQuery } from "@/components/admin/adminusers/adminUsersQuery";

const REPO = resolve(__dirname, "../..");

function adminSources(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "src/components/admin", "src/pages"], {
    cwd: REPO,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .filter((f) => f.startsWith("src/components/admin/") || /^src\/pages\/Admin[^/]*\.tsx$/.test(f));
}

const WRITE = /\.(update|insert|upsert|delete)\(/;
const BOUNDED = /\.range\(|\.limit\(|\.in\(\s*"(user_id|id)"|\.eq\(\s*"(user_id|id)"|\.maybeSingle\(|\.single\(|head:\s*true/;

/** The query chain that starts at `.from("profiles")`: up to the statement end or the next query. */
function chainAt(src: string, at: number): string {
  const rest = src.slice(at + 1);
  const stops = [rest.indexOf(";"), rest.indexOf(".from("), rest.indexOf("\n\n")].filter((i) => i >= 0);
  return src.slice(at, at + 1 + Math.min(...stops, rest.length));
}

export function unboundedProfileReads(files: string[], readSrc: (f: string) => string): string[] {
  const out: string[] = [];
  for (const f of files) {
    const src = blankComments(readSrc(f));
    const re = /\.from\(\s*"profiles"\s*\)/g;
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = re.exec(src))) {
      const chain = chainAt(src, m.index);
      if (WRITE.test(chain) || !/\.select\(/.test(chain)) continue;
      n += 1;
      if (!BOUNDED.test(chain)) out.push(`${f}#${n}`);
    }
  }
  return out.sort();
}

// Whole-table admin reads that remain, each tracked in docs/OPEN.md. EXACT:
// fixing one without removing it here fails the stale-entry test below.
// @two-way src/test/adminProfilesReadsAreBounded.test.ts:stale entry
const KNOWN_UNBOUNDED_ADMIN_PROFILE_READS = [
  // Export is the whole table by definition (CSV download).
  "src/components/admin/AdminExport.tsx#1",
  // The rest are Q306: analytics loads every
  // non-seed profile (#1) and its Users drill-down lists them all (#3); the
  // subscriptions drill-down (#2), AdminSubscriptions' two lists, the health
  // fan-out parish map and the dashboard's new-user sparkline windows read
  // rows where a count or an RPC aggregate would do.
  "src/components/admin/AdminAnalytics.tsx#1",
  "src/components/admin/AdminAnalytics.tsx#2",
  "src/components/admin/AdminAnalytics.tsx#3",
  "src/components/admin/AdminSubscriptions.tsx#1",
  "src/components/admin/AdminSubscriptions.tsx#2",
  "src/components/admin/adminHealth/useHealthData.ts#1",
  "src/pages/Admin.tsx#3",
  "src/pages/Admin.tsx#4",
];

describe("Q232 admin reads of profiles are paged, keyed or counted", () => {
  const files = adminSources();
  const offenders = unboundedProfileReads(files, (f) => readFileSync(join(REPO, f), "utf8"));

  it("inventories the admin sources (floor)", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("no unbounded profiles read outside the named list", () => {
    const fresh = offenders.filter((o) => !KNOWN_UNBOUNDED_ADMIN_PROFILE_READS.includes(o));
    expect(fresh, "admin view reads every profile — page it (.range) or count it (head: true)").toEqual([]);
  });

  it("no stale entry: every listed read still exists unbounded", () => {
    const stale = KNOWN_UNBOUNDED_ADMIN_PROFILE_READS.filter((o) => !offenders.includes(o));
    expect(stale, "stale entry — the read is bounded now, remove it").toEqual([]);
  });

  it("can fail: the pre-Q232 AdminUsers load is flagged, the paged one is not", () => {
    const old = `const { data, error } = await supabase\n  .from("profiles")\n  .select("*")\n  .order("created_at", { ascending: false });`;
    const paged = `const { data } = await supabase.from("profiles").select("*", { count: "exact" }).order("id").range(0, 49);`;
    const counted = `supabase.from("profiles").select("id", { count: "exact", head: true })`;
    const src: Record<string, string> = { "old.ts": old, "paged.ts": paged, "counted.ts": counted };
    expect(unboundedProfileReads(Object.keys(src), (f) => src[f])).toEqual(["old.ts#1"]);
  });
});

// A recorder standing in for the PostgREST builder: asserts which filters each
// tab sends, so a tab can't silently widen to "everyone".
class Rec implements FilterableQuery<Rec> {
  calls: string[] = [];
  eq(c: string, v: unknown) { this.calls.push(`eq ${c} ${String(v)}`); return this; }
  in(c: string, v: readonly unknown[]) { this.calls.push(`in ${c} ${v.join(",")}`); return this; }
  or(f: string) { this.calls.push(`or ${f}`); return this; }
}

describe("Q232 tab filters and search run server-side", () => {
  it("each tab sends its own filter; All sends none", () => {
    expect(applyTabFilter(new Rec(), "all").calls).toEqual([]);
    expect(applyTabFilter(new Rec(), "awaiting_email").calls).toEqual(["eq email_verified false"]);
    expect(applyTabFilter(new Rec(), "banned").calls).toEqual(["in ban_status temp_banned,permanently_banned"]);
    expect(applyTabFilter(new Rec(), "approved").calls).toEqual([
      "eq email_verified true",
      "or ban_status.is.null,ban_status.not.in.(temp_banned,permanently_banned)",
    ]);
  });

  it("search quotes values PostgREST would split on, and matches phone digits across punctuation", () => {
    expect(searchOrFilter("   ")).toBeNull();
    expect(searchOrFilter("jane.doe")).toBe('full_name.ilike."*jane.doe*",email.ilike."*jane.doe*"');
    expect(searchOrFilter("a,b(c)")).toBe('full_name.ilike."*a,b(c)*",email.ilike."*a,b(c)*"');
    expect(searchOrFilter('x"y')).toBe('full_name.ilike."*x\\"y*",email.ilike."*x\\"y*"');
    expect(searchOrFilter("555-1234")).toContain('phone.ilike."*5*5*5*1*2*3*4*"');
    expect(searchOrFilter("%")).toBeNull();
  });
});
