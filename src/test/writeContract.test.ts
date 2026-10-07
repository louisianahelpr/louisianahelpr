import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Two halves, two mutations. The first is a real bad write in src/ — the
// defect class this guard exists for. The second disables the engine's
// unknown-column check, which is what the "each check can fail" block below
// pins.
// @mutate src/pages/home/useSaveJob.ts | .upsert({ user_id: userId, job_id: jobId } | .upsert({ user_id: userId, jobb_id: jobId }
// @mutate scripts/audit/write-contract.sql | cg.privilege_type in ('INSERT', 'UPDATE', 'SELECT') | cg.privilege_type in ('INSERT', 'UPDATE')
// @mutate scripts/audit/write-contract.mjs | if (!col) { reject("unknown_column" | if (!col) { if (false) reject("unknown_column"
// @mutate scripts/audit/write-contract.mjs | if (by) warn("rpc_pending" | if (false) warn("rpc_pending"
// @mutate scripts/audit/write-contract.mjs | if (files.filter((f) => f.slice(0, 14) <= meta.latest).length !== meta.count) return none; | if (false) return none;
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs script, no type declarations
import * as contract from "../../scripts/audit/write-contract.mjs";

/**
 * WRITE CONTRACT guard. Every `.insert/.update/.upsert/.delete/.rpc` in src/
 * is checked against the COMMITTED prod schema snapshot
 * (scripts/audit/write-contract.snapshot.json, refreshed WEEKLY — Sat 09:17
 * UTC — by .github/workflows/write-contract-refresh.yml). Nothing here queries
 * prod: between refreshes this is a source-text pin against a frozen copy of
 * the schema, so a column added or dropped in prod is invisible to it until
 * that job runs. A write prod would reject —
 * unknown column, missing NOT NULL, disallowed enum/check value, no grant, no
 * RLS policy for the role, no EXECUTE on an RPC — fails here, unless it is a
 * KNOWN defect in write-contract.baseline.json with a docs/OPEN.md line.
 *
 * The second half proves each check can fail, by breaking the snapshot.
 */

type Snapshot = {
  tables: Record<string, any>;
  functions: Record<string, any[]>;
};

const snapshot: Snapshot = contract.loadSnapshot();
const report = contract.runContract({ snapshot });
const clone = (): Snapshot => JSON.parse(JSON.stringify(snapshot));
const codesFor = (snap: Snapshot) => new Set(contract.runContract({ snapshot: snap }).rejects.map((r: any) => r.code));

describe("write contract against the prod schema snapshot", () => {
  it("inventories the client's writes", () => {
    // Floor, not an exact count: a regression in the extractor that finds
    // nothing would otherwise pass every check vacuously.
    expect(report.writes.length).toBeGreaterThan(150);
    for (const kind of ["insert", "update", "upsert", "delete", "rpc"]) {
      expect(report.writes.some((w: any) => w.kind === kind)).toBe(true);
    }
    expect(report.unresolved).toEqual([]);
  });

  it("has no write prod would reject, beyond the baselined known defects", () => {
    const accepted = new Set(contract.loadBaseline());
    const fresh = report.rejects
      .filter((r: any) => !accepted.has(r.key))
      .map((r: any) => `${r.file}:${r.line} ${r.kind} ${r.target}: ${r.message}`);
    expect(fresh).toEqual([]);
  });

  it("baseline has no stale entries (a fixed defect must leave the baseline)", () => {
    const live = new Set(report.rejects.map((r: any) => r.key));
    expect(contract.loadBaseline().filter((k: string) => !live.has(k))).toEqual([]);
  });

  describe("each check can fail", () => {
    it("unknown column", () => {
      const s = clone();
      delete s.tables.saved_jobs.columns.job_id;
      expect(codesFor(s).has("unknown_column")).toBe(true);
    });

    it("missing NOT NULL without default", () => {
      const s = clone();
      // prod gave saved_jobs a BEFORE INSERT trigger (snapshot 2026-09-23), which
      // downgrades this to a warning; clear it so the reject path is what is proven.
      s.tables.saved_jobs.triggers = [];
      s.tables.saved_jobs.columns.ghost_required = { type: "text", notNull: true, hasDefault: false, generated: false, enum: null };
      expect(codesFor(s).has("missing_not_null")).toBe(true);
    });

    it("no RLS policy for the operation", () => {
      const s = clone();
      s.tables.saved_jobs.policies = s.tables.saved_jobs.policies.filter((p: any) => p.cmd !== "INSERT");
      expect(codesFor(s).has("no_policy")).toBe(true);
    });

    it("no table grant", () => {
      const s = clone();
      s.tables.saved_jobs.grants.authenticated = ["SELECT"];
      expect(codesFor(s).has("no_grant")).toBe(true);
    });

    it("column-level grant excludes a sent column", () => {
      const s = clone();
      const g = s.tables.profiles.columnGrants.authenticated.UPDATE as string[];
      s.tables.profiles.columnGrants.authenticated.UPDATE = g.filter((c) => c !== "bio");
      expect(codesFor(s).has("no_column_grant")).toBe(true);
    });

    it("rpc without EXECUTE, and a missing rpc", () => {
      const s = clone();
      for (const o of s.functions.get_parish_for_zip) o.anon = false;
      expect(codesFor(s).has("rpc_no_execute")).toBe(true);
      delete s.functions.get_parish_for_zip;
      expect(codesFor(s).has("rpc_missing")).toBe(true);
    });

    it("check constraint IN-list", () => {
      expect(contract.parseCheck("CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text])))")).toEqual({
        column: "status",
        values: ["draft", "scheduled"],
      });
      const s = clone();
      const hit = report.writes.find(
        (w: any) => w.kind !== "rpc" && w.payload?.keys?.status?.some((v: unknown) => typeof v === "string"),
      );
      expect(hit).toBeTruthy();
      s.tables[hit.target].checks.push("CHECK ((status = ANY (ARRAY['__never__'::text])))");
      expect(codesFor(s).has("check_value")).toBe(true);
    });
  });
});
describe("pending vs missing: a migration prod had not applied is told apart from a missing object (Q1072)", () => {
  const migrationsDir = join(__dirname, "../../supabase/migrations");
  const files = (readdirSync(migrationsDir) as string[]).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
  // The newest migration that creates a public function the client calls.
  const called = new Set(report.writes.filter((w: any) => w.kind === "rpc").map((w: any) => w.target as string));
  let pick: { file: string; fn: string } | null = null;
  for (const f of [...files].reverse()) {
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    for (const m of sql.matchAll(/create\s+or\s+replace\s+function\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)) {
      if (called.has(m[1].toLowerCase())) { pick = { file: f, fn: m[1].toLowerCase() }; break; }
    }
    if (pick) break;
  }
  /** Prod as it was just before `pick.file` ran: that migration and every later one pending. */
  const before = (): Snapshot & { appliedMigrations?: any } => {
    const s: any = clone();
    const applied = files.filter((f) => f < pick!.file);
    s.appliedMigrations = { latest: applied[applied.length - 1].slice(0, 14), count: applied.length };
    delete s.functions[pick!.fn];
    return s;
  };
  const codes = (s: any) => {
    const r = contract.runContract({ snapshot: s });
    return { rejects: new Set(r.rejects.map((x: any) => `${x.code}:${x.target}`)), warns: new Set(r.warnings.map((x: any) => `${x.code}:${x.target}`)) };
  };

  it("the committed snapshot carries appliedMigrations, consistent with supabase/migrations", () => {
    const snap = JSON.parse(readFileSync(join(__dirname, "../../scripts/audit/write-contract.snapshot.json"), "utf8"));
    expect(typeof snap.appliedMigrations?.latest).toBe("string");
    expect(snap.appliedMigrations.count).toBeGreaterThan(900); // 1010 on 2026-10-06
    expect(files.filter((f) => f.slice(0, 14) <= snap.appliedMigrations.latest).length).toBe(snap.appliedMigrations.count);
    expect(contract.pendingDefinitions(snap).exact).toBe(true);
  });

  it("an RPC created by a migration above `latest` is a pending warning, not a reject", () => {
    expect(pick).not.toBeNull();
    const c = codes(before());
    expect(c.warns.has(`rpc_pending:${pick!.fn}`)).toBe(true);
    expect(c.rejects.has(`rpc_missing:${pick!.fn}`)).toBe(false);
  });

  it("the same missing RPC is still a reject when no pending migration creates it", () => {
    const s: any = clone();
    delete s.functions[pick!.fn];
    // Fully applied (every migration file in the tree): nothing is pending,
    // so the gap is a real missing RPC. Set explicitly: the committed
    // snapshot can be older than the newest migrations on main.
    s.appliedMigrations = { latest: files[files.length - 1].slice(0, 14), count: files.length };
    expect(codes(s).rejects.has(`rpc_missing:${pick!.fn}`)).toBe(true);
  });

  it("fails closed: no metadata, or a count that does not add up, never downgrades a missing RPC", () => {
    const noMeta: any = before();
    delete noMeta.appliedMigrations;
    expect(codes(noMeta).rejects.has(`rpc_missing:${pick!.fn}`)).toBe(true);
    const wrongCount: any = before();
    wrongCount.appliedMigrations.count -= 1;
    expect(codes(wrongCount).rejects.has(`rpc_missing:${pick!.fn}`)).toBe(true);
  });

  it("a table created by a pending migration is a pending warning, and a commented-out CREATE is not a definition", () => {
    const tableWrite = report.writes.find((w: any) => w.kind !== "rpc");
    const dir = mkdtempSync(join(tmpdir(), "wc-pending-"));
    writeFileSync(join(dir, "20990101000000_a.sql"), `create table if not exists public.${tableWrite.target} (id uuid);\n-- create or replace function public.ghost_fn(\n`);
    const s: any = clone();
    s.appliedMigrations = { latest: "20990100000000", count: 0 };
    delete s.tables[tableWrite.target];
    const p = contract.pendingDefinitions(s, dir);
    expect(p.tables.get(tableWrite.target)).toBe("20990101000000_a.sql");
    expect(p.functions.has("ghost_fn")).toBe(false);
    const problems = contract.checkWrite(tableWrite, s, p).map((x: any) => x.code);
    expect(problems).toEqual(["table_pending"]);
  });
});

describe("the snapshot records column-level SELECT grants (Q124)", () => {
  it("the refresh query collects SELECT column grants, and jobs has them", () => {
    const sql = readFileSync(join(__dirname, "../../scripts/audit/write-contract.sql"), "utf8");
    // jobs grants SELECT per column (privacy hardening). Without SELECT here,
    // every jobs write that reads back or filters its row was reported as
    // rejected although prod accepts it (22 false REJECTs on 2026-09-23).
    expect(sql).toMatch(/cg\.privilege_type in \('INSERT', 'UPDATE', 'SELECT'\)/);
    const snap = JSON.parse(readFileSync(join(__dirname, "../../scripts/audit/write-contract.snapshot.json"), "utf8"));
    expect((snap.tables.jobs.columnGrants?.authenticated?.SELECT ?? []).length).toBeGreaterThan(50); // 109 on 2026-09-23
  });
});

