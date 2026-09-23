// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql | IF coalesce(NEW.license_url, '') !~ '[^[:space:]]' THEN | IF NEW.license_url = '' THEN
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql | IF coalesce(NEW.insurance_url, '') !~ '[^[:space:]]' THEN | IF nullif(btrim(NEW.insurance_url), '') IS NULL THEN
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql |       NEW.license_url := NULL; |       NULL;
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql |       NEW.insurance_url := NULL; |       NULL;
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql |     IF NEW.license_url IS NOT DISTINCT FROM OLD.license_url THEN |     IF false THEN
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql |     ELSIF NEW.insurance_url IS NOT NULL THEN |     ELSIF NEW.insurance_url IS NOT NULL AND NEW.insurance_url <> '' THEN
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql | SET search_path TO 'public'\nAS $function$ | SET search_path TO 'public', 'pg_temp'\nAS $function$
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql | auto_pending_credentials() FROM PUBLIC, anon, authenticated; | auto_pending_credentials() FROM PUBLIC;
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

/**
 * Q120 (docs/OPEN.md): a blank or whitespace-only license_url / insurance_url
 * is ABSENT, never a document awaiting review.
 *
 * auto_pending_credentials() (BEFORE UPDATE on public.profiles) used
 * `NEW.license_url IS NOT NULL AND NEW.license_url <> ''`, so ' ' set
 * license_status 'pending' and is_licensed true with nothing to review.
 *
 * Reading the NEWEST definition across all migrations (any dollar-quote tag,
 * SQL comments stripped), for BOTH columns:
 *   - the URL is normalised to NULL when it has no non-whitespace character
 *     (`!~ '[^[:space:]]'`, which also catches tabs/newlines that btrim()
 *     keeps);
 *   - a write that normalises back to the old value is a no-op (so ' ' over a
 *     helper_credentials-verified badge leaves it alone);
 *   - presence is then decided on the normalised value alone, and the old
 *     untrimmed `<> ''` test is gone;
 *   - SECURITY DEFINER, search_path exactly 'public', and EXECUTE revoked
 *     from PUBLIC, anon, authenticated at or after that definition.
 * Behaviour: src/test/pglite/blankCredentialUrlIsAbsent.pglite.mjs
 * (ALL PASS; NEW_MIGRATION=skip -> 5 FAILED on the live trigger).
 * The newest definition is now Q127's (20260923110759), so the mutations
 * target that file; src/test/credentialUrlIsOwnDocument.test.ts guards the
 * allowlist on top.
 */

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
// SQL comments BLANKED (string-, nesting- and dollar-quote-aware), never deleted:
// src/test/guardsDoNotDeleteSource.test.ts forbids the regex stripper.
const sqlOf = new Map(files.map((f) => [f, blankSqlComments(readFileSync(join(MIG, f), "utf8"))]));
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

describe("a blank credential URL is absent (Q120)", () => {
  it("reads a real migration history", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  const fn = newestFunction("auto_pending_credentials");

  it("finds the newest auto_pending_credentials definition", () => {
    expect(fn, "no definition found").not.toBeNull();
    // Floor: the fix is not older than Q120's migration.
    expect(fn!.file >= "20260923104534").toBe(true);
  });

  for (const kind of ["license", "insurance"] as const) {
    const col = `NEW.${kind}_url`;
    it(`${kind}: a whitespace-only URL is normalised to NULL`, () => {
      expect(fn!.body).toContain(`IF coalesce(${col}, '') !~ '[^[:space:]]' THEN ${col} := NULL; END IF;`);
    });

    it(`${kind}: a write that normalises back to the old value changes nothing`, () => {
      expect(fn!.body).toContain(`IF ${col} IS NOT DISTINCT FROM OLD.${kind}_url THEN NULL; ELSIF ${col} IS NOT NULL THEN`);
    });

    it(`${kind}: the untrimmed "<> ''" presence test is gone`, () => {
      expect(fn!.body).not.toMatch(new RegExp(`${col.replace(".", "\\.")}\\s*<>\\s*''`));
    });
  }

  it("is SECURITY DEFINER with search_path pinned to public", () => {
    expect(fn!.header).toMatch(/SECURITY DEFINER/i);
    expect(fn!.header).toMatch(/SET search_path TO 'public'(?!\s*,)/i);
  });

  it("EXECUTE stays revoked from PUBLIC, anon and authenticated", () => {
    const later = files.filter((f) => f >= fn!.file).map((f) => ws(sqlOf.get(f)!)).join(" ");
    expect(later).toMatch(/REVOKE ALL ON FUNCTION public\.auto_pending_credentials\(\) FROM PUBLIC, anon, authenticated;/);
    expect(later).not.toMatch(/GRANT [A-Z, ]*EXECUTE[A-Z, ]* ON FUNCTION public\.auto_pending_credentials\(\) TO/i);
  });
});
