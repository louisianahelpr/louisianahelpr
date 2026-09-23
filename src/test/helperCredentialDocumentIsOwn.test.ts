// @mutate supabase/migrations/20260923113829_helper_credential_document_is_own.sql |     IF is_member THEN\n      RAISE EXCEPTION 'A submitted |     IF false THEN\n      RAISE EXCEPTION 'A submitted
// @mutate supabase/migrations/20260923113829_helper_credential_document_is_own.sql | IF is_member AND NEW.credential_type IN ('identity', 'background_check') THEN | IF false THEN
// @mutate supabase/migrations/20260923113829_helper_credential_document_is_own.sql | IF p_path !~ ('^' \|\| p_user_id::text \|\| '/credentials/' | IF p_path !~ ('/credentials/'
// @mutate supabase/migrations/20260923113829_helper_credential_document_is_own.sql | WHERE o.bucket_id = 'user-documents' AND o.name = p_path | WHERE o.bucket_id = 'user-documents' AND o.name <> p_path
// @mutate supabase/migrations/20260923113829_helper_credential_document_is_own.sql | \|[Hh][Ee][Ii][Cc])$') THEN | \|[Hh][Ee][Ii][Cc]\|[Ss][Vv][Gg])$') THEN
// @mutate supabase/migrations/20260923113829_helper_credential_document_is_own.sql |     IF NEW.document_url IS NOT NULL THEN\n      RAISE EXCEPTION '% credentials carry no document' |     IF false THEN\n      RAISE EXCEPTION '% credentials carry no document'
// @mutate supabase/migrations/20260923113829_helper_credential_document_is_own.sql | REVOKE UPDATE (document_url, credential_type) ON | REVOKE UPDATE (credential_type) ON
// @mutate supabase/migrations/20260923113829_helper_credential_document_is_own.sql |     USING ((SELECT auth.uid()) = user_id)\n    WITH CHECK ((SELECT auth.uid()) = user_id); |     USING ((SELECT auth.uid()) = user_id);
// @mutate supabase/migrations/20260923113829_helper_credential_document_is_own.sql |     BEFORE INSERT OR UPDATE ON public.helper_credentials |     BEFORE INSERT ON public.helper_credentials
// @mutate supabase/migrations/20260923113829_helper_credential_document_is_own.sql |      WHERE c.user_id = auth.uid() |      WHERE true
// @mutate supabase/migrations/20260923113829_helper_credential_document_is_own.sql |         credential_type <> 'bond'\n |         credential_type <> 'bond' OR true\n
// @mutate supabase/migrations/20260923113829_helper_credential_document_is_own.sql | helper_credential_document_ok(uuid, text, text) FROM PUBLIC, anon, authenticated; | helper_credential_document_ok(uuid, text, text) FROM PUBLIC, anon;
// @mutate scripts/audit/prod-seed.mjs | document_url: await ensureSeedLicenseDocument(helperId) | document_url: PIXEL
// @mutate e2e/prod-audit/harness.ts | license_state: "LA", document_url: docPath, | license_state: "LA", document_url: SEED_PIXEL,
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import { objectLiterals } from "./helpers/schemaConstraints";

/**
 * Q130 (docs/OPEN.md): helper_credentials.document_url is the member's OWN
 * uploaded user-documents object, and a submitted credential's document /
 * type cannot be swapped by its owner. The sister of Q127 (profiles).
 *
 * Before (prod, 2026-09-23): the only document test was a CHECK using
 * nullif(btrim(..)), which U+200B passes; members held column UPDATE on
 * document_url and credential_type; the UPDATE policy had no WITH CHECK; a
 * 'submitted' row's document could be swapped with status unchanged; bond /
 * identity / background_check could be 'submitted' with no document.
 *
 * Reading the NEWEST definitions across all migrations (any dollar-quote tag,
 * SQL comments stripped), this pins:
 *   - helper_credential_document_ok: own folder + kind = credential_type +
 *     closed extension set + existing object; not client-executable;
 *   - enforce_helper_credential_document: member INSERT of identity /
 *     background_check refused; unchanged document/type on UPDATE is never
 *     re-checked; a member changing either is refused; vendor types carry no
 *     document; every other non-NULL document must pass the helper;
 *   - the trigger is attached BEFORE INSERT OR UPDATE and never dropped later;
 *   - UPDATE on document_url / credential_type revoked from members, never
 *     re-granted; the UPDATE policy has a WITH CHECK;
 *   - a pending bond needs a document;
 *   - is_submitted_credential_object freezes the objects the caller's
 *     helper_credentials rows name;
 *   - every helper_credentials row literal under e2e/ and scripts/ that sets a
 *     document writes the path shape (not a data:/https URL).
 * Behaviour (live trigger chain + policies + grants, applied 3x):
 * src/test/pglite/helperCredentialDocumentIsOwn.pglite.mjs — ALL PASS (44);
 * NEW_MIGRATION=skip -> 25 FAILED.
 */

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
const sqlOf = new Map(files.map((f) => [f, stripComments(readFileSync(join(MIG, f), "utf8"))]));
const ws = (s: string) => s.replace(/\s+/g, " ").trim();
const FIX = "20260923113829";

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
const allFrom = (from: string) => files.filter((f) => f >= from).map((f) => ws(sqlOf.get(f)!)).join(" ");
const everything = files.map((f) => ws(sqlOf.get(f)!));

const ALLOWED_EXT = ["heic", "jpeg", "jpg", "pdf", "png", "webp"];
function extensionsOf(body: string): string[] {
  const alt = body.match(/-\[0-9\]\{13\}\\\.\(([^)]*)\)\$'\)/);
  expect(alt, "extension group must be closed and end-anchored").not.toBeNull();
  const exts = alt![1].split("|").flatMap((a) => {
    const letters = [...a.matchAll(/\[([A-Za-z])[A-Za-z]\](\?)?/g)].map((m) => ({ c: m[1].toLowerCase(), opt: !!m[2] }));
    expect(letters.map((l) => `[${l.c.toUpperCase()}${l.c}]${l.opt ? "?" : ""}`).join("")).toBe(a);
    const full = letters.map((l) => l.c).join("");
    const short = letters.filter((l) => !l.opt).map((l) => l.c).join("");
    return full === short ? [full] : [full, short];
  });
  return [...new Set(exts)].sort();
}

describe("helper_credentials.document_url is the member's own uploaded document (Q130)", () => {
  it("reads a real migration history", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  const ok = newestFunction("helper_credential_document_ok");
  const trig = newestFunction("enforce_helper_credential_document");
  const sub = newestFunction("is_submitted_credential_object");

  it("finds the newest definitions, none older than Q130", () => {
    expect(ok && trig && sub, "a definition is missing").toBeTruthy();
    for (const d of [ok!, trig!, sub!]) expect(d.file >= FIX, d.file).toBe(true);
  });

  it("the path helper anchors own folder + kind + a closed extension set, and requires the object", () => {
    const b = ok!.body;
    expect(b).toContain("p_type NOT IN ('trade_license', 'insurance', 'bond')");
    expect(b).toContain(`IF p_path !~ ('^' || p_user_id::text || '/credentials/' || p_type || '-[0-9]{13}\\.(`);
    expect(extensionsOf(b)).toEqual(ALLOWED_EXT);
    expect(b).toContain("RETURN EXISTS ( SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'user-documents' AND o.name = p_path );");
    expect(ok!.header).toMatch(/SECURITY DEFINER/);
    expect(ok!.header).toMatch(/SET search_path TO 'public'(?!\s*,)/);
  });

  it("the trigger refuses member vendor-type inserts, member swaps, documents on vendor types, and off-shape documents", () => {
    const b = trig!.body;
    expect(b).toContain(
      "is_member boolean := NOT ( public.is_server_context() OR has_role(auth.uid(), 'admin') OR coalesce(current_setting('app.trusted_ladder_write', true), '') = 'on' );",
    );
    expect(b).toContain(
      "IF TG_OP = 'INSERT' THEN IF is_member AND NEW.credential_type IN ('identity', 'background_check') THEN RAISE EXCEPTION",
    );
    // Unchanged document and type: never re-checked (existing rows keep working) …
    expect(b).toContain(
      "ELSE IF NEW.document_url IS NOT DISTINCT FROM OLD.document_url AND NEW.credential_type IS NOT DISTINCT FROM OLD.credential_type THEN RETURN NEW; END IF; IF is_member THEN RAISE EXCEPTION 'A submitted credential''s document and type cannot be changed",
    );
    expect(b).toMatch(/IF NEW\.credential_type IN \('identity', 'background_check'\) THEN IF NEW\.document_url IS NOT NULL THEN RAISE EXCEPTION '% credentials carry no document', NEW\.credential_type USING ERRCODE = '22023';/);
    expect(b).toContain(
      "ELSIF NEW.document_url IS NOT NULL AND NOT public.helper_credential_document_ok(NEW.user_id, NEW.credential_type, NEW.document_url) THEN RAISE EXCEPTION 'document_url must be a document you uploaded",
    );
    expect(trig!.header).toMatch(/SECURITY DEFINER/);
    expect(trig!.header).toMatch(/SET search_path TO 'public'(?!\s*,)/);
  });

  it("the trigger is attached BEFORE INSERT OR UPDATE and nothing later drops it", () => {
    const create = /CREATE TRIGGER trg_helper_credential_document_is_own BEFORE INSERT OR UPDATE ON public\.helper_credentials FOR EACH ROW EXECUTE FUNCTION public\.enforce_helper_credential_document\(\);/;
    let lastCreate = -1;
    let lastDrop = -1;
    everything.forEach((sql, i) => {
      // A DROP IF EXISTS immediately followed by the CREATE (replay idiom) counts as the create.
      if (create.test(sql)) lastCreate = i;
      else if (/DROP TRIGGER (IF EXISTS )?trg_helper_credential_document_is_own/.test(sql)) lastDrop = i;
    });
    expect(lastCreate, "trigger never created").toBeGreaterThanOrEqual(0);
    expect(lastDrop < lastCreate, `dropped later in ${files[lastDrop]}`).toBe(true);
  });

  it("members cannot UPDATE document_url / credential_type, and nothing re-grants it", () => {
    const later = allFrom(FIX);
    expect(later).toContain("REVOKE UPDATE (document_url, credential_type) ON public.helper_credentials FROM PUBLIC, anon, authenticated;");
    const regrants = files
      .filter((f) => f > FIX)
      .filter((f) => /GRANT\s+[^;]*UPDATE[^;]*ON\s+(TABLE\s+)?public\.helper_credentials\s+TO/i.test(sqlOf.get(f)!));
    expect(regrants).toEqual([]);
  });

  it("the member UPDATE policy has a WITH CHECK", () => {
    expect(allFrom(FIX)).toContain(
      `ALTER POLICY "Users can update own credentials" ON public.helper_credentials USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);`,
    );
  });

  it("a pending bond needs a document", () => {
    expect(allFrom(FIX)).toContain(
      "ADD CONSTRAINT helper_credentials_pending_bond_needs_document CHECK ( credential_type <> 'bond' OR status NOT IN ('unverified', 'submitted') OR nullif(btrim(document_url), '') IS NOT NULL );",
    );
  });

  it("the helpers are revoked from clients; the storage predicate stays authenticated-only", () => {
    const later = allFrom(FIX);
    expect(later).toContain("REVOKE ALL ON FUNCTION public.helper_credential_document_ok(uuid, text, text) FROM PUBLIC, anon, authenticated;");
    expect(later).toContain("REVOKE ALL ON FUNCTION public.enforce_helper_credential_document() FROM PUBLIC, anon, authenticated;");
    expect(later).not.toMatch(/GRANT [A-Z, ]*EXECUTE[A-Z, ]* ON FUNCTION public\.(helper_credential_document_ok|enforce_helper_credential_document)/i);
  });

  it("is_submitted_credential_object also freezes objects the caller's helper_credentials rows name", () => {
    expect(sub!.body).toContain(
      "OR EXISTS ( SELECT 1 FROM public.helper_credentials c WHERE c.user_id = auth.uid() AND c.document_url = p_name );",
    );
  });
});

// ── Seed / fixture writers ────────────────────────────────────────────────────
function rawField(text: string, key: string): string | null {
  const clean = text.replace(/^\s*\/\/[^\n]*$/gm, "");
  const m = new RegExp(`(?:^\\s*|[{,]\\s*)${key}:\\s*`, "m").exec(clean);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < clean.length; i++) {
    const c = clean[i];
    if (quote) {
      if (c === quote && clean[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return clean.slice(start, i).trim();
      depth--;
    } else if (c === "," && depth === 0) return clean.slice(start, i).trim();
  }
  return null;
}

/** The text of a same-file `const X = …;` or `function X(…) {…}` definition. */
function definitionOf(src: string, id: string): string | null {
  const c = src.match(new RegExp(`(?:const|let)\\s+${id}\\s*=([\\s\\S]*?);\\s*\\n`));
  if (c) return c[1];
  const f = src.match(new RegExp(`function\\s+${id}\\s*\\([\\s\\S]*?\\n\\}\\n`));
  return f ? f[0] : null;
}

/**
 * An expression with identifiers replaced, `depth` levels deep, by their
 * same-file definitions — so `await ensureSeedLicenseDocument(helperId)` is
 * judged by the path its body builds, and `SEED_PIXEL` by its data: literal.
 */
function resolve(src: string, expr: string, depth: number): string {
  if (depth === 0) return expr;
  const ids = [...new Set([...expr.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map((m) => m[1]))];
  let out = expr;
  for (const id of ids) {
    const def = definitionOf(src, id);
    if (def) out += `\n/*${id}*/ ${resolve(src, def, depth - 1)}`;
  }
  return out;
}

type Doc = { file: string; type: string; raw: string; resolved: string; direct: string };
function documentWrites(): Doc[] {
  const out: Doc[] = [];
  for (const file of walkSource([join(ROOT, "e2e"), join(ROOT, "scripts")], [".ts", ".mjs"])) {
    const src = readSource(file);
    if (src === null || !src.includes("credential_type")) continue;
    for (const lit of objectLiterals(src)) {
      // One row per literal: an enclosing array/object holding several rows is not a row.
      if ((lit.match(/credential_type\s*:/g) ?? []).length !== 1) continue;
      const type = rawField(lit, "credential_type")?.match(/^["']([a-z_]+)["']$/)?.[1];
      if (!type) continue;
      const raw = rawField(lit, "document_url");
      if (raw === null || raw === "null") continue;
      out.push({ file: file.replace(`${ROOT}/`, ""), type, raw, resolved: resolve(src, raw, 3), direct: /^[A-Za-z_$][\w$]*$/.test(raw) ? `${raw} ${definitionOf(src, raw) ?? ""}` : raw });
    }
  }
  return out;
}

describe("every helper_credentials fixture writes a document PATH, never a URL (Q130)", () => {
  const docs = documentWrites();

  it("finds the fixture writers", () => {
    // seedData.ts (mock), prod-seed.mjs, harness.ts — measured 2026-09-23.
    expect(docs.length).toBeGreaterThan(2);
    expect(new Set(docs.map((d) => d.file)).size).toBeGreaterThan(2);
  });

  it("each document is `<id>/credentials/<credential_type>-<time>.<ext>`, not data:/https", () => {
    const bad = docs.filter(
      (d) =>
        !new RegExp(`/credentials/${d.type}-\\$\\{[^}]+\\}|/credentials/${d.type}-[0-9]{13}\\.`).test(d.resolved) ||
        /["'`](data:|https?:)/.test(d.direct),
    );
    expect(bad.map((d) => `${d.file}: ${d.type} document_url ${d.raw}`)).toEqual([]);
  });
});
