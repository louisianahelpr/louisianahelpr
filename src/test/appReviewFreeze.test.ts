/**
 * WHILE A BUILD IS IN APPLE REVIEW, NOTHING ON THE SERVER MAY STRAND IT
 * (lead, 2026-10-14; owner standing order "prevent, don't chase").
 *
 * WHAT NEARLY HAPPENED: build 1.0.4 (7119, c16b0f0dc) was submitted on
 * 2026-10-13. PR #2982 (a2-1u) carried
 * 20261013012700_phone_save_rpc_rate_limited.sql, which REVOKEs UPDATE (phone)
 * and INSERT on profiles from authenticated and raises client_compat_floor()
 * to 2. The 7119 client still saves the phone with profiles.update
 * (PhotoPrompt.tsx at c16b0f0dc), and a floor above the build's epoch shows
 * the reviewer "Update Helpr". Either one is an instant rejection, and
 * schemaBreakBumpsClientFloor.test.ts was GREEN on it: that guard asks a
 * narrowing to raise the floor, which is exactly what must not happen now.
 *
 * THE RULE: while release/app-review-freeze.json says `frozen: true`, no
 * migration from `scanFrom` on (minus the ones the build already shipped
 * with, EXEMPT below) may
 *   1. define client_compat_floor() above the live floor,
 *   2. write platform_settings.min_supported_build, or
 *   3. take a table or column privilege away from authenticated or anon
 *      (replayed with helpers/tablePrivilegeReplay.ts, so a revoke that is
 *      re-granted in full is not a narrowing, and a table the same migration
 *      creates has no older reader), or REVOKE EXECUTE from authenticated on
 *      a function that already existed and that the app calls with .rpc()
 *      without granting it back in the same migration.
 * The release session or the lead sets `frozen` to false once Apple decides.
 *
 * Shown red on the original: the phone migration (kept on the held branch
 * ready/phone-save-after-review) put back into supabase/migrations fails
 * test 2 with `profiles: authenticated` and `client_compat_floor() -> 2`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { migrationFiles, parseDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { replayTablePrivileges, type Priv } from "./helpers/tablePrivilegeReplay";

// @mutate release/app-review-freeze.json | "liveClientCompatFloor": 1, | "liveClientCompatFloor": 0,
// @mutate supabase/migrations/20261013010621_under_18_cannot_apply_or_post.sql | GRANT EXECUTE ON FUNCTION public.member_under_18(uuid) TO service_role; | GRANT EXECUTE ON FUNCTION public.member_under_18(uuid) TO service_role;\nREVOKE UPDATE (phone) ON public.profiles FROM anon, authenticated;
// @mutate src/test/appReviewFreeze.test.ts |     if (createsTable(m.code, t)) continue; |     if (createsTable(m.code, t) \|\| t === "profiles") continue;

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");

interface Freeze {
  frozen: boolean;
  version: string;
  build: number;
  buildSha: string;
  since: string;
  liveClientCompatFloor: number;
  liveMinSupportedBuild: number;
  scanFrom: string;
}
const FREEZE = JSON.parse(readFileSync(join(ROOT, "release/app-review-freeze.json"), "utf8")) as Freeze;

type Mig = { name: string; code: string };
const ALL: Mig[] = migrationFiles(MIG_DIR).map((name) => ({
  name,
  code: blankSqlComments(readFileSync(join(MIG_DIR, name), "utf8")),
}));

/**
 * Migrations from scanFrom on that the frozen build (c16b0f0dc) already
 * shipped with and that one of the rules below would flag. They are live and
 * the build was made against them, so they cannot strand it. Measured
 * 2026-10-14 by running these detectors over `git ls-tree c16b0f0dc
 * supabase/migrations` from scanFrom on.
 */
// @two-way src/test/appReviewFreeze.test.ts:stale EXEMPT entry
const EXEMPT: Record<string, string> = {
  "20261003182009_messages_insert_columns_client_scoped.sql": "in build 7119 (c16b0f0dc); narrowed before the client floor existed, live since 2026-10-04",
  "20261004001242_messages_status_notices_and_sender_writes.sql": "in build 7119 (c16b0f0dc); narrowed before the client floor existed, live since 2026-10-04",
  "20261004184135_applications_insert_rpc_only.sql": "in build 7119 (c16b0f0dc); narrowed before the client floor existed, live since 2026-10-04",
  "20261004185317_job_views_server_only.sql": "in build 7119 (c16b0f0dc); narrowed before the client floor existed, live since 2026-10-04",
  "20261004185940_job_revisions_party_columns.sql": "in build 7119 (c16b0f0dc); narrowed before the client floor existed, live since 2026-10-04",
  "20261004190334_application_party_columns.sql": "in build 7119 (c16b0f0dc); narrowed before the client floor existed, live since 2026-10-04",
  "20261004191007_application_flag_reason_withheld.sql": "in build 7119 (c16b0f0dc); narrowed before the client floor existed, live since 2026-10-04",
};

/** The floor value a migration's last client_compat_floor() definition returns, or null. */
function floorSetIn(code: string): number | null {
  const defs = parseDefs(code).filter((d) => d.name === "client_compat_floor");
  if (defs.length === 0) return null;
  const m = /\$(\w*)\$\s*select\s+(\d+)\s*;?\s*\$\1\$/i.exec(defs[defs.length - 1].stmt);
  return m ? Number(m[2]) : NaN;
}

/** Does the migration write platform_settings.min_supported_build? */
function setsMinSupportedBuild(code: string): boolean {
  return (
    /\bupdate\s+(?:public\.)?platform_settings\b[^;]*\bset\b[^;]*\bmin_supported_build\s*=/i.test(code) ||
    /\binsert\s+into\s+(?:public\.)?platform_settings\b[^;]*\bmin_supported_build\b/i.test(code) ||
    /\bmin_supported_build\b[^;,]*\bset\s+default\b/i.test(code)
  );
}

const NON_TABLE = /^(function|procedure|routine|schema|sequence|type|domain|database|language|large\s+object|foreign|all\s+(functions|procedures|routines|sequences))\b/i;
const ROLES = ["authenticated", "anon"] as const;

/** Tables a migration REVOKEs something on from authenticated, anon or PUBLIC; "*" for ALL TABLES. */
function revokedTables(code: string): string[] {
  const out = new Set<string>();
  const re = /\brevoke\s+(?:grant\s+option\s+for\s+)?[^;]*?\s+on\s+([^;]*?)\s+from\s+([\w\s,"]+?)(?=\s*(?:;|$|cascade|restrict|granted\s+by))/gi;
  for (const m of code.matchAll(re)) {
    const roles = m[2].split(",").map((r) => r.trim().replace(/"/g, "").toLowerCase());
    if (!roles.some((r) => r === "authenticated" || r === "anon" || r === "public")) continue;
    const obj = m[1].trim();
    if (NON_TABLE.test(obj)) continue;
    if (/^all\s+tables\s+in\s+schema\b/i.test(obj)) {
      out.add("*");
      continue;
    }
    for (const n of obj.split(",")) out.add(n.trim().replace(/^table\s+/i, "").replace(/^public\./i, "").replace(/"/g, "").toLowerCase());
  }
  return [...out];
}

const createsTable = (code: string, t: string) =>
  new RegExp(String.raw`\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?${t}"?\s*\(`, "i").test(code);

/** "table: role" for every privilege migration `idx` takes away from a client role. */
function narrowedTables(idx: number, files: Mig[]): string[] {
  const m = files[idx];
  const out: string[] = [];
  for (const t of revokedTables(m.code)) {
    if (t === "*") {
      out.push("ALL TABLES");
      continue;
    }
    if (createsTable(m.code, t)) continue;
    const word = new RegExp(String.raw`\b${t}\b|all\s+tables\s+in\s+schema`, "i");
    const prior = files.slice(0, idx).filter((f) => word.test(f.code)).map((f) => ({ name: f.name, sql: f.code }));
    for (const role of ROLES) {
      const before = replayTablePrivileges(prior, t, role);
      const after = replayTablePrivileges([...prior, { name: m.name, sql: m.code }], t, role);
      const lost = (["SELECT", "INSERT", "UPDATE", "DELETE"] as Priv[]).some(
        (p) =>
          (before.table.has(p) && !after.table.has(p)) ||
          [...before.cols.get(p)!].some((c) => !after.table.has(p) && !after.cols.get(p)!.has(c)),
      );
      const held = new Set((["SELECT", "INSERT", "UPDATE", "DELETE"] as Priv[]).filter((p) => before.table.has(p) || before.cols.get(p)!.size > 0));
      if (lost || revokedWithoutGrantBack(m.code, t, role, held)) out.push(`${t}: ${role}`);
    }
  }
  return out;
}

/**
 * Does the migration REVOKE a table or column privilege on `t` from `role`
 * that it never grants back to `role` later in the same file? Syntactic, so it
 * does not depend on the replay knowing every earlier grant: the replay misses
 * grants made in dynamic SQL (it holds UPDATE on only one profiles column for
 * authenticated, while prod grants UPDATE (phone, date_of_birth, ...), so a
 * bare `REVOKE UPDATE (phone) ON public.profiles` read as no change). A named
 * privilege counts whenever it is not granted back; `REVOKE ALL` counts only
 * for the kinds the replay saw the role hold (a view re-granted SELECT after
 * REVOKE ALL, as open_jobs_browse is on every rebuild, loses nothing).
 */
function revokedWithoutGrantBack(code: string, t: string, role: string, held: Set<string>): boolean {
  const tbl = String.raw`(?:table\s+)?(?:public\.)?"?${t}"?`;
  const revoke = new RegExp(String.raw`\brevoke\s+(?:grant\s+option\s+for\s+)?([^;]*?)\s+on\s+${tbl}\s+from\s+([^;]*)`, "gi");
  for (const r of code.matchAll(revoke)) {
    const roles = r[2].split(",").map((x) => x.trim().replace(/"/g, "").replace(/\s+(cascade|restrict)$/i, "").toLowerCase());
    if (!roles.includes(role)) continue;
    const privs = r[1].replace(/\([^)]*\)/g, "").split(",").map((x) => x.trim().toUpperCase().replace(/\s+PRIVILEGES$/, ""));
    const rest = code.slice((r.index ?? 0) + r[0].length);
    const grants = [...rest.matchAll(new RegExp(String.raw`\bgrant\s+([^;]*?)\s+on\s+${tbl}\s+to\s+([^;]*)`, "gi"))]
      .filter((g) => g[2].split(",").map((x) => x.trim().replace(/"/g, "").toLowerCase()).includes(role))
      .flatMap((g) => g[1].replace(/\([^)]*\)/g, "").split(",").map((x) => x.trim().toUpperCase().replace(/\s+PRIVILEGES$/, "")));
    for (const p of privs) {
      if (!p) continue;
      if (grants.includes("ALL")) continue;
      if (p === "ALL") {
        if ([...held].some((q) => !grants.includes(q))) return true;
      } else if (!grants.includes(p)) return true;
    }
  }
  return false;
}

/** Every function name the app calls with .rpc("name"), from src (tests excluded). */
function clientRpcNames(): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) {
        if (e !== "test" && e !== "__tests__") walk(p);
      } else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) {
        for (const m of blankComments(readFileSync(p, "utf8")).matchAll(/\.rpc\(\s*["'`]([a-z0-9_]+)["'`]/g)) names.add(m[1]);
      }
    }
  };
  walk(join(ROOT, "src"));
  return names;
}
const RPC = clientRpcNames();

/** Functions the app calls that migration `idx` REVOKEs from authenticated (or PUBLIC) and never grants back. */
function revokedClientFunctions(idx: number, files: Mig[], rpc: Set<string>): string[] {
  const code = files[idx].code;
  const out = new Set<string>();
  const re = /\brevoke\s+[^;]*?\s+on\s+function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*(?:\([^)]*\))?\s+from\s+([\w\s,"]+?)(?=\s*(?:;|$|cascade|restrict))/gi;
  for (const m of code.matchAll(re)) {
    const fn = m[1].toLowerCase();
    const roles = m[2].split(",").map((r) => r.trim().replace(/"/g, "").toLowerCase());
    if (!roles.includes("authenticated") && !roles.includes("public")) continue;
    if (!rpc.has(fn)) continue;
    const regrant = new RegExp(String.raw`\bgrant\s+[^;]*?\bon\s+function\s+(?:public\.)?"?${fn}"?\b[^;]*\bto\s+[^;]*\bauthenticated\b`, "i");
    if (regrant.test(code.slice((m.index ?? 0) + m[0].length))) continue;
    const existed = new RegExp(String.raw`\bfunction\s+(?:public\.)?"?${fn}"?\s*\(`, "i");
    if (!files.slice(0, idx).some((f) => existed.test(f.code))) continue;
    out.add(`${fn}(): authenticated`);
  }
  return [...out];
}

/** What migration `idx` does that would strand the frozen build, in words; empty when nothing. */
function strands(idx: number, files: Mig[] = ALL, rpc: Set<string> = RPC): string[] {
  const m = files[idx];
  const hits: string[] = [];
  const floor = floorSetIn(m.code);
  if (floor !== null && !(floor <= FREEZE.liveClientCompatFloor)) hits.push(`client_compat_floor() -> ${floor}`);
  if (setsMinSupportedBuild(m.code)) hits.push("writes platform_settings.min_supported_build");
  hits.push(...narrowedTables(idx, files), ...revokedClientFunctions(idx, files, rpc));
  return hits;
}

const scanned = ALL.map((m, i) => ({ m, i })).filter(({ m }) => m.name.slice(0, 14) >= FREEZE.scanFrom);

describe("while a build is in Apple review, no migration strands it (release/app-review-freeze.json)", () => {
  it("the freeze file is whole", () => {
    expect(typeof FREEZE.frozen).toBe("boolean");
    expect(FREEZE.build).toBeGreaterThan(7000);
    expect(FREEZE.buildSha).toMatch(/^[0-9a-f]{40}$/);
    expect(FREEZE.scanFrom).toMatch(/^\d{14}$/);
    expect(Number.isInteger(FREEZE.liveClientCompatFloor)).toBe(true);
    // Reads a real migration history and a real client (measured 2026-10-14:
    // 155 migrations from 20261001 on, 114 distinct .rpc() names in src).
    expect(scanned.length).toBeGreaterThan(100);
    expect(RPC.size).toBeGreaterThan(80);
  });

  it("while frozen, no migration from scanFrom on raises the floor, sets min_supported_build, or narrows a privilege", () => {
    if (!FREEZE.frozen) return;
    const bad = scanned
      .filter(({ m }) => !(m.name in EXEMPT))
      .map(({ m, i }) => ({ name: m.name, hits: strands(i) }))
      .filter((r) => r.hits.length > 0)
      .map((r) => `${r.name}: ${r.hits.join("; ")}`);
    expect(bad, `build ${FREEZE.build} is in Apple review: hold these until it is approved (release/app-review-freeze.json)`).toEqual([]);
  });

  it("EXEMPT is exact: every entry is a scanned migration that still trips a rule", () => {
    for (const name of Object.keys(EXEMPT)) {
      const s = scanned.find(({ m }) => m.name === name);
      expect(s, `stale EXEMPT entry ${name}`).toBeDefined();
      expect(strands(s!.i), `stale EXEMPT entry ${name}`).not.toEqual([]);
    }
  });

  it("the detectors see the real cases in history", () => {
    // The floor's own migration defines it at 1.
    const floorIdx = ALL.findIndex((m) => m.name === "20261005191110_client_compat_floor.sql");
    expect(floorSetIn(ALL[floorIdx].code)).toBe(1);
    // The original stranding bug (schemaBreakBumpsClientFloor's): applications narrowed for authenticated.
    const appIdx = ALL.findIndex((m) => m.name === "20261004191007_application_flag_reason_withheld.sql");
    expect(narrowedTables(appIdx, ALL)).toContain("applications: authenticated");
  });

  it("the detectors flag #2982's phone migration and pass a revoke that is granted back", () => {
    const files: Mig[] = [
      { name: "a.sql", code: "create table public.profiles (id int, phone text); grant select, insert, update on public.profiles to anon, authenticated; create function public.save_thing() returns void language sql as $$ select 1 $$;" },
      {
        name: "b.sql",
        code:
          "create table if not exists public.phone_save_attempts (id int); revoke all on public.phone_save_attempts from public, anon, authenticated;" +
          " revoke insert on public.profiles from anon, authenticated; revoke update (phone) on public.profiles from anon, authenticated;" +
          " create or replace function public.client_compat_floor() returns integer language sql immutable as $$ select 2 $$;",
      },
      { name: "c.sql", code: "revoke all on function public.save_thing() from public, anon, authenticated; grant execute on function public.save_thing() to authenticated;" },
      { name: "d.sql", code: "revoke all on function public.save_thing() from public, anon, authenticated;" },
      { name: "e.sql", code: "update public.platform_settings set min_supported_build = 7119;" },
    ];
    const rpc = new Set(["save_thing"]);
    expect(strands(1, files, rpc)).toEqual(["client_compat_floor() -> 2", "profiles: authenticated", "profiles: anon"]);
    expect(strands(2, files, rpc)).toEqual([]);
    expect(strands(3, files, rpc)).toEqual(["save_thing(): authenticated"]);
    expect(strands(4, files, rpc)).toEqual(["writes platform_settings.min_supported_build"]);
  });
});
