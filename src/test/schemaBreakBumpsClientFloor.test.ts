/**
 * A migration that narrows what `authenticated` may do on a table must raise
 * client_compat_floor() in the same migration, and the client's
 * CLIENT_COMPAT_EPOCH must equal the newest floor.
 *
 * WHAT WAS BROKEN (owner-reported live 2026-10-05, launch blocker):
 * 20261004191007 revoked table-level SELECT on applications from authenticated
 * and re-granted every column but flag_reason. Every bundle built before it
 * kept selecting the withheld column: the 2026-10-01 TestFlight bundle
 * (release 693db745) logged 19 "permission denied for table applications"
 * rows on 2026-10-05 and showed "Couldn't load applicants" / "We couldn't load
 * this" on My Jobs. Nothing told the old bundle it was old.
 *
 * THE CLASS: any narrowing of authenticated table/column privileges strands
 * every bundle already out there. The floor is how the server says so: a
 * bundle below it reloads (web, src/lib/staleClient.ts) or shows "Update
 * Helpr" (native, ForceUpdateGate). This guard derives "narrowed" from the
 * migrations themselves by replaying privileges before and after each one
 * (helpers/tablePrivilegeReplay.ts), so a REVOKE that is immediately
 * re-granted in full is not a narrowing, and a table-level SELECT replaced by
 * a column list is.
 *
 * Shown red on the original bug: the inventory test below requires that
 * 20261004191007 is detected as narrowing applications; if it had landed after
 * the floor existed, the per-migration rule would have failed it.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { migrationFiles, parseDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { replayTablePrivileges, type Priv } from "./helpers/tablePrivilegeReplay";

// @mutate src/lib/clientCompat.ts | export const CLIENT_COMPAT_EPOCH = 1; | export const CLIENT_COMPAT_EPOCH = 2;
// @mutate supabase/migrations/20261005191110_client_compat_floor.sql | AS $$ SELECT 1 $$; | AS $$ SELECT 0 $$;
// @mutate src/test/schemaBreakBumpsClientFloor.test.ts | client_compat_floor.sql";\n | payout_holds_server_side.sql";\n

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FLOOR_FN = "client_compat_floor";
/** Migrations before this one predate the floor; they are the inventory, not the rule. */
const FLOOR_INTRODUCED = "20261005191110_client_compat_floor.sql";
/** The original bug. */
const ORIGINAL = "20261004191007_application_flag_reason_withheld.sql";

type File = { name: string; sql: string; code: string };
const ALL: File[] = migrationFiles(MIG_DIR).map((name) => {
  const sql = readFileSync(join(MIG_DIR, name), "utf8");
  return { name, sql, code: blankSqlComments(sql) };
});

/** The floor value a migration sets (its last definition of the function), or null. */
function floorSetIn(sql: string): number | null {
  const defs = parseDefs(sql).filter((d) => d.name === FLOOR_FN);
  if (defs.length === 0) return null;
  const m = /\$(\w*)\$\s*select\s+(\d+)\s*;?\s*\$\1\$/i.exec(defs[defs.length - 1].stmt);
  return m ? Number(m[2]) : NaN;
}

const NON_TABLE = /^(function|procedure|routine|schema|sequence|type|domain|database|language|large\s+object|foreign|all\s+(functions|procedures|routines|sequences))\b/i;

/** Tables a migration REVOKEs something on from authenticated (or PUBLIC); "*" for ALL TABLES. */
function revokedTables(code: string): string[] {
  const out = new Set<string>();
  const re = /\brevoke\s+(?:grant\s+option\s+for\s+)?[^;]*?\s+on\s+([^;]*?)\s+from\s+([\w\s,"]+?)(?=\s*(?:;|$|cascade|restrict|granted\s+by))/gi;
  for (const m of code.matchAll(re)) {
    const roles = m[2].split(",").map((r) => r.trim().replace(/"/g, "").toLowerCase());
    if (!roles.includes("authenticated") && !roles.includes("public")) continue;
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

/** Does migration `idx` take away a privilege `authenticated` held on any table? Returns those tables. */
function narrowedBy(idx: number, files: File[] = ALL): string[] {
  const m = files[idx];
  const out: string[] = [];
  for (const t of revokedTables(m.code)) {
    if (t === "*") {
      out.push("*");
      continue;
    }
    // A table this migration creates has no older reader to strand.
    if (createsTable(m.code, t)) continue;
    const word = new RegExp(String.raw`\b${t}\b|all\s+tables\s+in\s+schema`, "i");
    const prior = files.slice(0, idx).filter((f) => word.test(f.code)).map((f) => ({ name: f.name, sql: f.code }));
    const before = replayTablePrivileges(prior, t, "authenticated");
    const after = replayTablePrivileges([...prior, { name: m.name, sql: m.code }], t, "authenticated");
    const lost = (["SELECT", "INSERT", "UPDATE", "DELETE"] as Priv[]).some(
      (p) =>
        (before.table.has(p) && !after.table.has(p)) ||
        [...before.cols.get(p)!].some((c) => !after.table.has(p) && !after.cols.get(p)!.has(c)),
    );
    if (lost) out.push(t);
  }
  return out;
}

/** CLIENT_COMPAT_EPOCH as the client source declares it. */
function clientEpoch(): number {
  const src = blankComments(readFileSync(join(ROOT, "src/lib/clientCompat.ts"), "utf8"));
  const m = /export\s+const\s+CLIENT_COMPAT_EPOCH\s*=\s*(\d+)\s*;/.exec(src);
  return m ? Number(m[1]) : NaN;
}

describe("a migration that narrows authenticated privileges raises client_compat_floor()", () => {
  const introIdx = ALL.findIndex((f) => f.name === FLOOR_INTRODUCED);

  it("the floor function exists, and the client's epoch equals the newest floor (two-way)", () => {
    expect(introIdx).toBeGreaterThan(-1);
    let newest: number | null = null;
    for (const f of ALL) {
      const v = floorSetIn(f.sql);
      if (v !== null) newest = v;
    }
    expect(newest).not.toBeNull();
    expect(Number.isInteger(newest)).toBe(true);
    expect(newest!).toBeGreaterThan(0);
    expect(clientEpoch()).toBe(newest);
  });

  it("the detector sees the original bug: 20261004191007 narrowed applications for authenticated", () => {
    const idx = ALL.findIndex((f) => f.name === ORIGINAL);
    expect(idx).toBeGreaterThan(-1);
    expect(narrowedBy(idx)).toContain("applications");
  });

  it("the detector does not call a full re-grant a narrowing (revoke then grant the same back)", () => {
    const files: File[] = [
      { name: "a.sql", sql: "", code: "create table public.t (id int);" },
      { name: "b.sql", sql: "", code: "revoke select on public.t from public, anon, authenticated; grant select on public.t to authenticated;" },
      { name: "c.sql", sql: "", code: "revoke select on public.t from authenticated; grant select (id) on public.t to authenticated;" },
      { name: "d.sql", sql: "", code: "revoke execute on function public.f() from authenticated;" },
    ];
    expect(narrowedBy(1, files)).toEqual([]);
    expect(narrowedBy(2, files)).toEqual(["t"]);
    expect(narrowedBy(3, files)).toEqual([]);
  });

  it("history inventory: the detector finds narrowing migrations before the floor existed (floor of the scan)", () => {
    const narrowing = ALL.slice(0, introIdx).filter((_, i) => narrowedBy(i).length > 0).map((f) => f.name);
    // Measured 2026-10-05; a parser that silently stops matching drops below.
    expect(narrowing.length).toBeGreaterThan(5);
    expect(narrowing).toContain(ORIGINAL);
  });

  it("every narrowing migration since the floor exists raises the floor in the same migration", () => {
    let floor = 0;
    const offenders: string[] = [];
    ALL.forEach((f, i) => {
      const set = floorSetIn(f.sql);
      if (i > introIdx) {
        const narrowed = narrowedBy(i);
        if (narrowed.length > 0 && !(set !== null && set > floor)) {
          offenders.push(`${f.name} narrows ${narrowed.join(", ")} for authenticated without raising ${FLOOR_FN}() above ${floor}`);
        }
      }
      if (set !== null) floor = set;
    });
    expect(offenders).toEqual([]);
  });
});
