/**
 * Q1285 — every free-text column a client may write on applications is
 * judged for contact details before the other party sees it.
 *
 * THE CLASS (derived, not listed): the columns authenticated holds column
 * UPDATE on, from the newest `GRANT UPDATE (...) ON public.applications`
 * in the migrations (live 2026-10-05: attachment_urls, decline_reason,
 * message, status). Each free-text one must have a BEFORE UPDATE OF <col>
 * trigger running scan_application_contact_info; status (an enum value) and
 * attachment_urls (storage paths, validated elsewhere) are the only exempt.
 * decline_reason had none until 20261005070359: a poster's decline reason
 * reached the Helpr's notice unchecked.
 *
 * Also pins the 'decline' branch of the NEWEST scan_application_contact_info:
 * a flagged reason is dropped (NULL) and the branch returns before the
 * applicant-side flags. Behaviour: src/test/pglite/declineReasonContactWithheld.pglite.mjs
 * (3 FAILED on prod's state, ALL PASS applied 3x).
 */
// Registered mutations - each turns this guard RED on its own:
// @mutate supabase/migrations/20261005070359_decline_reason_contact_details_withheld.sql |   BEFORE UPDATE OF decline_reason ON public.applications |   BEFORE UPDATE OF status ON public.applications
// @mutate supabase/migrations/20261005070359_decline_reason_contact_details_withheld.sql |       NEW.decline_reason := NULL; |       NULL;
// @mutate supabase/migrations/20261004190334_application_party_columns.sql | GRANT UPDATE (status, decline_reason, message, attachment_urls) ON public.applications TO authenticated; | GRANT UPDATE (status, decline_reason, message, attachment_urls, offer_note) ON public.applications TO authenticated;
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase/migrations");
const all = migrationFiles(MIG).map((f) => blankSqlComments(readFileSync(join(MIG, f), "utf8")));
// @two-way src/test/declineReasonContactWithheld.test.ts:stale EXEMPT column
const EXEMPT = new Set(["status", "attachment_urls"]);

/** Columns of the newest `GRANT UPDATE (cols) ON public.applications TO authenticated`. */
function clientUpdatableColumns(): string[] {
  let cols: string[] = [];
  for (const sql of all) {
    for (const m of sql.matchAll(/GRANT\s+UPDATE\s*\(([^)]*)\)\s+ON\s+(?:TABLE\s+)?public\.applications\s+TO\s+[^;]*\bauthenticated\b/gi)) {
      cols = m[1].split(",").map((c) => c.trim().replace(/"/g, ""));
    }
  }
  return cols;
}

/** Column -> the arg its newest `BEFORE UPDATE OF <col> ... scan_application_contact_info('<arg>')` trigger passes. */
function scanTriggers(): Map<string, string> {
  const byName = new Map<string, { cols: string[]; arg: string } | null>();
  for (const sql of all) {
    for (const m of sql.matchAll(/DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ON\s+public\.applications/gi)) byName.set(m[1], null);
    for (const m of sql.matchAll(/CREATE\s+TRIGGER\s+(\w+)\s+BEFORE\s+UPDATE\s+OF\s+([\w\s,]+?)\s+ON\s+public\.applications\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+public\.scan_application_contact_info\('(\w+)'\)/gi)) {
      byName.set(m[1], { cols: m[2].split(",").map((c) => c.trim()), arg: m[3] });
    }
  }
  const out = new Map<string, string>();
  for (const t of byName.values()) if (t) for (const c of t.cols) out.set(c, t.arg);
  return out;
}

describe("Q1285: applications' client-writable free text is scanned", () => {
  const cols = clientUpdatableColumns();
  const triggers = scanTriggers();

  it("the inventory is real", () => {
    expect(cols.length).toBeGreaterThan(2);
    expect(triggers.size).toBeGreaterThan(1);
  });

  it("every client-writable free-text column has its own scan trigger", () => {
    const unscanned = cols.filter((c) => !EXEMPT.has(c) && !triggers.has(c)).sort();
    expect(unscanned, "a client can write this column and the other party reads it unchecked").toEqual([]);
    expect(triggers.get("decline_reason")).toBe("decline");
    expect(triggers.get("message")).toBe("note");
  });

  it("the newest scan function drops a flagged decline reason and returns before the applicant-side flags", () => {
    const body = blankSqlComments(effectiveDefs(MIG).get("scan_application_contact_info")?.stmt ?? "").replace(/\s+/g, " ");
    const branch = body.search(/IF v_dir = 'decline' THEN IF public\.contact_leak_reason\(NEW\.decline_reason\) IS NOT NULL THEN NEW\.decline_reason := NULL; END IF; RETURN NEW; END IF;/);
    expect(branch, "the decline branch is missing").toBeGreaterThan(-1);
    expect(body.indexOf("NEW.flagged_hidden")).toBeGreaterThan(branch);
  });
});

describe("declineReasonContactWithheld EXEMPT list", () => {
  it("has no stale entry: every exempt column is still client-updatable on applications", () => {
    const cols = new Set(clientUpdatableColumns());
    const stale = [...EXEMPT].filter((c) => !cols.has(c));
    expect(stale, `stale EXEMPT column ${stale.join(", ")}: remove it`).toEqual([]);
  });
});
