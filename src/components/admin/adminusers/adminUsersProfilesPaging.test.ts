import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { describe, expect, it } from "vitest";

// PostgREST caps a response at 1000 rows (db-max-rows, measured 2026-09-01 in
// supabase/functions/money-reconciliation/index.ts) and says nothing when it truncates, so
// `.from("profiles").select("*")` with no bound silently stops at the
// thousandth user: admin counts, charts and user lists all under-report. This
// guard finds every such read in src/ and fails CI on a new one. A read is
// bounded when its chain pages (`.range(`), caps (`.limit(`), fetches one row
// (`.single(`/`.maybeSingle(`/an id or user_id `.eq`), or only counts
// (`head: true`).
//
// KNOWN_UNBOUNDED_PROFILES_SELECT is EXACT and two-way: a new offender fails,
// and so does a listed file that no longer offends (lower the list in the same
// commit as the fix).
// @two-way src/components/admin/adminusers/adminUsersProfilesPaging.test.ts:const stale = KNOWN_UNBOUNDED_PROFILES_SELECT.filter(
export const KNOWN_UNBOUNDED_PROFILES_SELECT: readonly string[] = [
  "AdminUsers.tsx", // Q232
];

const SRC = join(__dirname, "../../..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "__tests__" || name === "fixtures") continue;
      out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const BOUNDED = /\.range\(|\.limit\(|\.single\(|\.maybeSingle\(|head:\s*true|\.eq\(\s*["'](?:id|user_id)["']/;

/** Every unbounded `.from("profiles")…select("*")` chain in `text`, as line numbers. */
export function unboundedProfilesSelects(text: string): number[] {
  const hits: number[] = [];
  const re = /\.from\(\s*["'`]profiles["'`]\s*\)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // The chain runs to the end of its statement; 800 chars covers any real
    // multi-line builder without swallowing the next query.
    const rest = text.slice(m.index, m.index + 800);
    const end = rest.search(/;|\n\s*\n/);
    const chain = end === -1 ? rest : rest.slice(0, end);
    if (/\.(update|insert|upsert|delete)\(/.test(chain)) continue;
    if (!/\.select\(\s*["'`]\*["'`]/.test(chain)) continue;
    if (BOUNDED.test(chain)) continue;
    hits.push(text.slice(0, m.index).split("\n").length);
  }
  return hits;
}

describe("profiles reads are bounded (PostgREST 1000-row cap)", () => {
  const offenders = new Map<string, string[]>();
  for (const f of sourceFiles(SRC)) {
    const lines = unboundedProfilesSelects(readFileSync(f, "utf8"));
    if (lines.length) offenders.set(basename(f), lines.map((l) => `${relative(SRC, f)}:${l}`));
  }

  it("no new unbounded profiles select(\"*\")", () => {
    const unexpected = [...offenders.keys()].filter((f) => !KNOWN_UNBOUNDED_PROFILES_SELECT.includes(f));
    expect(unexpected.flatMap((f) => offenders.get(f)!)).toEqual([]);
  });

  it("KNOWN_UNBOUNDED_PROFILES_SELECT has no stale entry", () => {
    const stale = KNOWN_UNBOUNDED_PROFILES_SELECT.filter((f) => !offenders.has(f));
    expect(stale.map((f) => `stale baseline entry ${f} — remove it (lower the baseline)`)).toEqual([]);
  });

  it("the detector fires on the original AdminAnalytics reads and not on the paged ones", () => {
    expect(unboundedProfilesSelects(`supabase.from("profiles").select("*").eq("is_seed", false),`)).toEqual([1]);
    expect(
      unboundedProfilesSelects(
        `await supabase.from("profiles").select("*").eq("is_seed", false).order("created_at", { ascending: false });`,
      ),
    ).toEqual([1]);
    expect(unboundedProfilesSelects(`supabase\n  .from("profiles")\n  .select("*")\n  .order("created_at");`)).toEqual([2]);
    expect(unboundedProfilesSelects(`supabase.from("profiles").select("*").range(0, 999);`)).toEqual([]);
    expect(unboundedProfilesSelects(`supabase.from("profiles").select("*").eq("user_id", id).maybeSingle();`)).toEqual([]);
    expect(unboundedProfilesSelects(`supabase.from("profiles").select("*", { count: "exact", head: true });`)).toEqual([]);
    expect(unboundedProfilesSelects(`supabase.from("profiles").update(u).eq("user_id", id).select("*");`)).toEqual([]);
  });
});
