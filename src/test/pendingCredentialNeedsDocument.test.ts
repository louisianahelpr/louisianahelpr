// @mutate supabase/migrations/20260923101130_pending_credential_requires_document.sql | AND nullif(btrim(c.document_url), '') IS NOT NULL | AND true
// @mutate supabase/migrations/20260923101130_pending_credential_requires_document.sql | AND (q.q_license_url IS NOT NULL OR q.q_insurance_url IS NOT NULL) | AND true
// @mutate supabase/migrations/20260923101130_pending_credential_requires_document.sql | WHEN q.license_status = 'pending' THEN 'none' | WHEN q.license_status = 'pending' THEN 'pending'
// @mutate supabase/migrations/20260923101130_pending_credential_requires_document.sql | OR nullif(btrim(document_url), '') IS NOT NULL | OR true
// @mutate supabase/migrations/20260923101130_pending_credential_requires_document.sql | OR status NOT IN ('unverified', 'submitted') | OR status NOT IN ('unverified')
// @mutate supabase/migrations/20260923101130_pending_credential_requires_document.sql | FROM PUBLIC, anon; | FROM PUBLIC;
// @mutate src/components/admin/AdminCredentialQueue.tsx | {r.license_status === "pending" && r.license_url && ( | {r.license_status === "pending" && r.license_url && r.is_licensed && (
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Q102 (docs/OPEN.md): the admin credential queue must never list a row with
 * no Approve or Reject.
 *
 * AdminCredentialQueue.tsx renders a credential's box (the only place its
 * actions live) exactly when `<kind>_status === "pending" && <kind>_url`.
 * So, reading the NEWEST definitions across all migrations (any dollar-quote
 * tag, SQL comments stripped):
 *   - get_pending_credentials() reads helper_credentials only WITH a
 *     non-blank document, reports a credential 'pending' only when it has a
 *     document, and lists a person only when one credential is actionable;
 *     EXECUTE revoked FROM PUBLIC, anon; search_path pinned.
 *   - helper_credentials carries the VALIDATED CHECK
 *     helper_credentials_pending_review_needs_document: a trade_license /
 *     insurance row in unverified/submitted needs a non-blank document_url
 *     (never dropped later, never NOT VALID).
 *   - the display gate is still the one the RPC was shaped for.
 * Behaviour: src/test/pglite/pendingCredentialNeedsDocument.pglite.mjs
 * (ALL PASS; NEW_MIGRATION=skip -> 8 FAILED).
 */

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const sqlOf = new Map(files.map((f) => [f, readFileSync(join(MIG, f), "utf8").replace(/--[^\n]*/g, "")]));
const ws = (s: string) => s.replace(/\s+/g, " ").trim();

type Def = { file: string; header: string; body: string };
function newestFunction(name: string): Def | null {
  let found: Def | null = null;
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`, "gi");
  for (const file of files) {
    const sql = sqlOf.get(file)!;
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index!);
      const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
      if (!tag) continue;
      const open = tag.index! + tag[0].length;
      const close = rest.indexOf(tag[1], open);
      found = { file, header: ws(rest.slice(0, tag.index!)), body: ws(rest.slice(open, close)) };
    }
  }
  return found;
}

/** Text after the balanced "(" that starts at or after `from`. */
function balanced(s: string, from: number): string {
  const start = s.indexOf("(", from);
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return s.slice(start + 1, i);
  }
  return "";
}

const CON = "helper_credentials_pending_review_needs_document";
type ConState = { file: string; check: string; notValid: boolean } | null;
function newestConstraint(): ConState {
  let state: ConState = null;
  const re = new RegExp(`(ADD\\s+CONSTRAINT|DROP\\s+CONSTRAINT(?:\\s+IF\\s+EXISTS)?)\\s+${CON}\\b`, "gi");
  for (const file of files) {
    const sql = sqlOf.get(file)!;
    for (const m of sql.matchAll(re)) {
      if (/^DROP/i.test(m[1])) {
        state = null;
        continue;
      }
      const after = sql.slice(m.index! + m[0].length);
      const checkAt = after.search(/\bCHECK\s*\(/i);
      const check = ws(balanced(after, checkAt));
      const tail = after.slice(checkAt + check.length).split(";")[0];
      state = { file, check, notValid: /NOT\s+VALID/i.test(tail) };
    }
  }
  return state;
}

describe("admin credential queue never lists an actionless row (Q102)", () => {
  it("reads a real migration history", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  const fn = newestFunction("get_pending_credentials");

  it("get_pending_credentials reads helper_credentials only with a document", () => {
    expect(fn, "no definition found").not.toBeNull();
    expect(fn!.body).toContain("AND nullif(btrim(c.document_url), '') IS NOT NULL");
  });

  it("reports a credential 'pending' only when it has a document", () => {
    expect(fn!.body).toContain("CASE WHEN q.q_license_url IS NOT NULL THEN 'pending' WHEN q.license_status = 'pending' THEN 'none'");
    expect(fn!.body).toContain("CASE WHEN q.q_insurance_url IS NOT NULL THEN 'pending' WHEN q.insurance_status = 'pending' THEN 'none'");
  });

  it("lists a person only when one credential is actionable, and only for admins", () => {
    expect(fn!.body).toMatch(/WHERE has_role\(auth\.uid\(\), 'admin'\) AND \(q\.q_license_url IS NOT NULL OR q\.q_insurance_url IS NOT NULL\)/);
  });

  it("is SECURITY DEFINER with search_path pinned, EXECUTE revoked from PUBLIC and anon", () => {
    expect(fn!.header).toMatch(/SECURITY DEFINER/i);
    expect(fn!.header).toMatch(/SET search_path TO 'public'/i);
    const later = files.filter((f) => f >= fn!.file).map((f) => ws(sqlOf.get(f)!)).join(" ");
    expect(later).toMatch(/REVOKE ALL ON FUNCTION public\.get_pending_credentials\(\) FROM PUBLIC, anon;/);
  });

  it("helper_credentials has the validated CHECK: pending trade_license/insurance needs a document", () => {
    const c = newestConstraint();
    expect(c, `${CON} missing or dropped`).not.toBeNull();
    expect(c!.notValid, "added NOT VALID").toBe(false);
    expect(c!.check).toBe(
      "credential_type NOT IN ('trade_license', 'insurance') OR status NOT IN ('unverified', 'submitted') OR nullif(btrim(document_url), '') IS NOT NULL",
    );
  });

  it("the admin display gate is still the one the RPC was shaped for", () => {
    const tsx = readFileSync(join(ROOT, "src", "components", "admin", "AdminCredentialQueue.tsx"), "utf8");
    const gates = [...tsx.matchAll(/\{r\.(\w+)_status === "pending" && ([^(]*?)\(/g)].map((m) => `${m[1]}:${m[2].trim()}`);
    expect(gates).toEqual(["license:r.license_url &&", "insurance:r.insurance_url &&"]);
  });
});
