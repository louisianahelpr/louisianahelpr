// @mutate supabase/migrations/20260925154842_jobs_dispute_evidence_append_only.sql |     IF NOT COALESCE(public.dispute_evidence_url_ok(v_added, v_uid, NEW.id), false) THEN | IF false THEN
// @mutate supabase/migrations/20260925154842_jobs_dispute_evidence_append_only.sql |   CREATE TRIGGER trg_jobs_dispute_evidence_append_only\n    BEFORE INSERT OR UPDATE ON public.jobs | CREATE TRIGGER trg_jobs_dispute_evidence_append_only\n    BEFORE INSERT ON public.jobs
// @mutate supabase/migrations/20260925154842_jobs_dispute_evidence_append_only.sql |             @> array_remove(COALESCE(OLD.dispute_evidence_urls, '{}'::text[]), NULL)) THEN |             IS NULL) THEN
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { walkSource, readSource } from "./helpers/walkSource";

/**
 * CLASS CHECK (Q398): every STORED dispute-evidence column is validated where
 * it is written, not only where it is read.
 *
 * Evidence is a list of strings a party supplies; an admin decides a money
 * split from what it points at. 20260925141905 made the one folder
 * `<uid>/disputes/<job>/` immutable to the parties, and
 * public.dispute_evidence_url_ok pins every value to exactly that folder for
 * the caller and the job. `disputes.evidence_urls` has been held to it by
 * trg_dispute_evidence_append_only since 20260915034822 — but the legacy
 * mirror `jobs.dispute_evidence_urls`, which the admin card falls back to,
 * was client-writable with no check at all: a party could list an object
 * outside the immutable folder (an upper-case `DISPUTES/`, a before/after
 * proof photo) and change it after the admin looked, or delete what was
 * already filed.
 *
 * INVENTORY, from the app itself: every column of a TABLE (not a view) in the
 * generated types whose name ends in `evidence_urls`. Each must have a live
 * trigger (CREATE/DROP TRIGGER replayed in migration order, comments blanked)
 * firing on UPDATE of its table, whose effective function body (newest
 * definition, later rewrites applied) reads the column's OLD and NEW values,
 * holds NEW to contain OLD (`@>`, append-only) and calls
 * dispute_evidence_url_ok. A new evidence column with no such
 * trigger fails here.
 *
 * Red on the tree without 20260925154842: jobs.dispute_evidence_urls has no
 * validating trigger. Behaviour: src/test/pglite/jobsDisputeEvidenceAppendOnly.pglite.mjs
 * (live jobs trigger chain, applied 3x; NEW_MIGRATION=skip is red).
 */

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const TYPES = join(ROOT, "src", "integrations", "supabase", "types.ts");

/** table -> evidence columns, from the Tables section of the generated types only. */
function evidenceColumns(): Array<{ table: string; column: string }> {
  const src = readFileSync(TYPES, "utf8");
  const start = src.indexOf("Tables: {");
  const stop = src.indexOf("Views: {", start);
  const tables = src.slice(start, stop);
  const out: Array<{ table: string; column: string }> = [];
  for (const m of tables.matchAll(/\n {6}([a-z0-9_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g)) {
    for (const c of ("\n" + m[2]).matchAll(/\n {10}([a-z0-9_]+)\??:/g)) {
      if (/evidence_urls$/.test(c[1])) out.push({ table: m[1], column: c[1] });
    }
  }
  return out;
}

type Trigger = { table: string; events: string; fn: string; file: string };

/** Live triggers on public tables after replaying every migration in order. */
function liveTriggers(): Map<string, Trigger> {
  const live = new Map<string, Trigger>();
  const stmt =
    /\b(?:create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+"?(\w+)"?\s+((?:before|after|instead\s+of)\s+[\s\S]*?)\s+on\s+(?:public\.)?"?(\w+)"?[\s\S]*?execute\s+(?:function|procedure)\s+(?:public\.)?"?(\w+)"?\s*\(|drop\s+trigger\s+(?:if\s+exists\s+)?"?(\w+)"?\s+on\s+(?:public\.)?"?(\w+)"?)/gi;
  for (const file of migrationFiles(MIG)) {
    const sql = blankSqlComments(readFileSync(join(MIG, file), "utf8"));
    for (const m of sql.matchAll(stmt)) {
      if (m[1]) live.set(`${m[3].toLowerCase()}.${m[1].toLowerCase()}`, { table: m[3].toLowerCase(), events: m[2].toLowerCase(), fn: m[4].toLowerCase(), file });
      else live.delete(`${m[6].toLowerCase()}.${m[5].toLowerCase()}`);
    }
  }
  return live;
}

describe("every stored dispute-evidence column is validated on write (Q398)", () => {
  const cols = evidenceColumns();
  const triggers = liveTriggers();
  const defs = effectiveDefs(MIG);

  it("the inventory is real", () => {
    // disputes.evidence_urls and jobs.dispute_evidence_urls, at least.
    expect(cols.length).toBeGreaterThan(1);
    expect(triggers.size).toBeGreaterThan(50);
    expect(defs.size).toBeGreaterThan(200);
  });

  it("the admin evidence readers only read inventoried columns", () => {
    // Both renderers pass stored evidence through partitionEvidenceUrls; every
    // `*evidence_urls` field they hand it must be a column checked below.
    const names = new Set(cols.map((c) => c.column));
    const read = new Set<string>();
    for (const file of walkSource([join(ROOT, "src")])) {
      if (/\.test\.|__tests__/.test(file)) continue;
      const code = blankComments(readSource(file) ?? "");
      for (const m of code.matchAll(/partitionEvidenceUrls\(([\s\S]*?)\);/g)) {
        for (const f of m[1].matchAll(/\.(\w*evidence_urls)\b/g)) read.add(f[1]);
      }
    }
    expect(read.size).toBeGreaterThan(1);
    expect([...read].filter((n) => !names.has(n))).toEqual([]);
  });

  it.each(evidenceColumns().map((c) => [`${c.table}.${c.column}`, c] as const))(
    "%s has a live UPDATE trigger that validates every added element",
    (_label, { table, column }) => {
      const onTable = [...triggers.values()].filter((t) => t.table === table && /\bupdate\b/.test(t.events));
      const validating = onTable.filter((t) => {
        const body = blankSqlComments(defs.get(t.fn)?.stmt ?? "");
        return (
          new RegExp(`\\bNEW\\.${column}\\b`, "i").test(body) &&
          new RegExp(`\\bOLD\\.${column}\\b`, "i").test(body) &&
          // append-only: NEW must contain OLD
          /@>/.test(body) &&
          /\bdispute_evidence_url_ok\s*\(/i.test(body)
        );
      });
      expect(
        validating.map((t) => t.fn),
        `${table}.${column} is stored evidence with no write-side validation: add a BEFORE UPDATE trigger ` +
          `(append-only, each new element through dispute_evidence_url_ok) like trg_jobs_dispute_evidence_append_only`,
      ).not.toEqual([]);
    },
  );
});
