import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs script, no type declarations
import * as contract from "../../scripts/audit/write-contract.mjs";

/**
 * WRITE CONTRACT guard. Every `.insert/.update/.upsert/.delete/.rpc` in src/
 * is checked against the committed prod schema snapshot
 * (scripts/audit/write-contract.snapshot.json, refreshed nightly by
 * .github/workflows/write-contract-refresh.yml). A write prod would reject —
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
