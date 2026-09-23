// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql | IF NOT public.credential_document_path_ok(NEW.user_id, 'license', NEW.license_url) THEN | IF false THEN
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql | IF NOT public.credential_document_path_ok(NEW.user_id, 'insurance', NEW.insurance_url) THEN | IF NOT public.credential_document_path_ok(NEW.user_id, 'license', NEW.insurance_url) THEN
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql | '^' \|\| p_user_id::text \|\| '/credentials/' | '/credentials/'
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql | [Hh][Ee][Ii][Cc])$') THEN | [Hh][Ee][Ii][Cc])') THEN
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql | \|[Ww][Ee][Bb][Pp]\| | \|[Ww][Ee][Bb][Pp]\|[Hh][Tt][Mm][Ll]\|
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql | WHERE o.bucket_id = 'user-documents' AND o.name = p_path | WHERE o.bucket_id = 'user-documents'
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql |           USING ERRCODE = '22023';\n      END IF;\n      NEW.is_licensed := true; |           USING ERRCODE = '22023';\n      END IF;\n      NEW.license_url := NULL;\n      NEW.is_licensed := true;
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql | credential_document_path_ok(uuid, text, text) FROM PUBLIC, anon, authenticated; | credential_document_path_ok(uuid, text, text) FROM PUBLIC, anon;
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql |     AND NOT public.is_submitted_credential_object(name)\n  );\nEND | \n  );\nEND
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql |   DROP POLICY IF EXISTS "Users can update their own documents" ON storage.objects; |
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql |      WHERE p.user_id = auth.uid() |      WHERE true
// @mutate src/components/profile/CredentialsTab.tsx | const ext = DOC_EXT_BY_TYPE[draft.file.type] ?? "pdf"; | const ext = draft.file.name.split(".").pop() \|\| "pdf";
// @mutate src/components/profile/CredentialsTab.tsx |   "image/webp": "webp",\n  "application/pdf": "pdf",\n}; |   "image/webp": "webp",\n  "application/pdf": "pdf",\n  "image/gif": "gif",\n};
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Q127 (docs/OPEN.md): a credential URL is the member's OWN uploaded document.
 *
 * auto_pending_credentials() accepted any license_url / insurance_url with one
 * non-[:space:] character, so U+200B (not [:space:]) reached 'pending' +
 * is_licensed with nothing to review; nothing checked it was a storage object,
 * or the member's. And the user-documents UPDATE/DELETE policies let a member
 * overwrite a verified object in place.
 *
 * Reading the NEWEST definitions across all migrations (any dollar-quote tag,
 * SQL comments stripped):
 *   - for both columns, a changed non-NULL URL must pass
 *     credential_document_path_ok(NEW.user_id, '<kind>', NEW.<kind>_url)
 *     BEFORE the flag/status are set, and a failure RAISEs (never normalises);
 *   - that helper anchors the path to the row's own folder and kind with a
 *     closed extension set (== the bucket's allowed types; the client's
 *     MIME->ext map must be a subset) and requires the uploaded object;
 *   - replaying every storage.objects policy statement in migration order, each
 *     surviving user-documents UPDATE/DELETE policy carries
 *     `NOT public.is_submitted_credential_object(name)`, and that helper is
 *     scoped to auth.uid();
 *   - CredentialsTab derives the extension from the MIME type, not the name.
 * Behaviour (live trigger chain + live storage policies, applied 3x):
 * src/test/pglite/credentialUrlIsOwnDocument.pglite.mjs — ALL PASS (31);
 * NEW_MIGRATION=skip -> 17 FAILED.
 */

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
const sqlOf = new Map(files.map((f) => [f, stripComments(readFileSync(join(MIG, f), "utf8"))]));
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

/** Final state of every storage.objects policy, replaying CREATE/DROP POLICY in migration order. */
function storagePolicies(): Map<string, { cmd: string; text: string; file: string }> {
  const live = new Map<string, { cmd: string; text: string; file: string }>();
  const stmt = /(CREATE|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+storage\.objects\b([^;]*);/gi;
  for (const file of files) {
    for (const m of sqlOf.get(file)!.matchAll(stmt)) {
      const [, verb, name, rest] = m;
      if (verb.toUpperCase() === "DROP") live.delete(name);
      else {
        const cmd = (rest.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i)?.[1] ?? "ALL").toUpperCase();
        live.set(name, { cmd, text: ws(rest), file });
      }
    }
  }
  return live;
}

const ALLOWED_EXT = ["heic", "jpeg", "jpg", "pdf", "png", "webp"];

describe("a credential URL is the member's own uploaded document (Q127)", () => {
  it("reads a real migration history", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  const trig = newestFunction("auto_pending_credentials");
  const ok = newestFunction("credential_document_path_ok");
  const sub = newestFunction("is_submitted_credential_object");

  it("finds the newest definitions, none older than Q127", () => {
    expect(trig && ok && sub, "a definition is missing").toBeTruthy();
    for (const d of [trig!, ok!, sub!]) expect(d.file >= "20260923110759").toBe(true);
  });

  for (const kind of ["license", "insurance"] as const) {
    const col = `NEW.${kind}_url`;
    const flag = kind === "license" ? "is_licensed" : "is_insured";
    it(`${kind}: a changed non-NULL URL must be the member's own ${kind} document, checked before the badge is set`, () => {
      const expected =
        `ELSIF ${col} IS NOT NULL THEN IF NOT public.credential_document_path_ok(NEW.user_id, '${kind}', ${col}) THEN ` +
        `RAISE EXCEPTION '${kind}_url must be a document you uploaded`;
      expect(trig!.body).toContain(expected);
      const at = trig!.body.indexOf(expected);
      const tail = trig!.body.slice(at);
      // Refused, not normalised: the RAISE's END IF is followed directly by the flag.
      expect(tail).toMatch(new RegExp(`USING ERRCODE = '22023'; END IF; NEW\\.${flag} := true;`));
    });
  }

  it("the path helper anchors folder + kind + a closed extension set and requires the uploaded object", () => {
    const b = ok!.body;
    expect(b).toContain(`IF p_path !~ ('^' || p_user_id::text || '/credentials/' || p_kind || '-[0-9]{13}\\.(`);
    const alt = b.match(/-\[0-9\]\{13\}\\\.\(([^)]*)\)\$'\)/);
    expect(alt, "extension group must be closed and end-anchored").not.toBeNull();
    // Expand each case-insensitive alternative (e.g. [Jj][Pp][Ee]?[Gg]) to the literal extensions it admits.
    const exts = alt![1].split("|").flatMap((a) => {
      const letters = [...a.matchAll(/\[([A-Za-z])[A-Za-z]\](\?)?/g)].map((m) => ({ c: m[1].toLowerCase(), opt: !!m[2] }));
      expect(letters.map((l) => `[${l.c.toUpperCase()}${l.c}]${l.opt ? "?" : ""}`).join("")).toBe(a);
      const full = letters.map((l) => l.c).join("");
      const short = letters.filter((l) => !l.opt).map((l) => l.c).join("");
      return full === short ? [full] : [full, short];
    });
    expect([...new Set(exts)].sort()).toEqual(ALLOWED_EXT);
    expect(b).toContain(`RETURN EXISTS ( SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'user-documents' AND o.name = p_path );`);
    expect(b).toContain(`p_kind NOT IN ('license', 'insurance')`);
  });

  it("the path helper is not client-executable; the trigger stays revoked", () => {
    const later = (from: string) => files.filter((f) => f >= from).map((f) => ws(sqlOf.get(f)!)).join(" ");
    expect(later(ok!.file)).toContain(
      "REVOKE ALL ON FUNCTION public.credential_document_path_ok(uuid, text, text) FROM PUBLIC, anon, authenticated;",
    );
    expect(later(ok!.file)).not.toMatch(/GRANT [A-Z, ]*EXECUTE[A-Z, ]* ON FUNCTION public\.credential_document_path_ok/i);
    expect(ok!.header).toMatch(/SET search_path TO 'public'(?!\s*,)/);
  });

  it("is_submitted_credential_object only ever answers about the caller's own row", () => {
    expect(sub!.body).toContain("WHERE p.user_id = auth.uid() AND (p.license_url = p_name OR p.insurance_url = p_name)");
    expect(sub!.header).toMatch(/SECURITY DEFINER/);
    expect(sub!.header).toMatch(/SET search_path TO 'public'(?!\s*,)/);
  });

  it("every surviving user-documents UPDATE/DELETE policy freezes a submitted credential", () => {
    const pols = storagePolicies();
    // Inventory floor: the replay sees the user-documents policies at all.
    const ud = [...pols].filter(([, p]) => p.text.includes("'user-documents'"));
    expect(ud.length).toBeGreaterThan(3);
    const writes = ud.filter(([, p]) => p.cmd === "UPDATE" || p.cmd === "DELETE" || p.cmd === "ALL");
    expect(writes.map(([n]) => n).sort()).toEqual([
      "user-documents: owner delete, not a submitted credential",
      "user-documents: owner update, not a submitted credential",
    ]);
    for (const [name, p] of writes) {
      const guards = p.text.match(/AND NOT public\.is_submitted_credential_object\(name\)/g) ?? [];
      // UPDATE has USING and WITH CHECK; DELETE only USING.
      expect(guards.length, name).toBe(p.cmd === "UPDATE" ? 2 : 1);
      expect(p.text, name).toContain("(storage.foldername(name))[1] = (SELECT auth.uid())::text");
    }
  });

  it("CredentialsTab writes the shape the trigger accepts (extension from the MIME type)", () => {
    const src = readFileSync(join(ROOT, "src", "components", "profile", "CredentialsTab.tsx"), "utf8");
    expect(src).toContain("const path = `${userId}/credentials/${kind}-${Date.now()}.${ext}`;");
    expect(src).toContain("const ext = DOC_EXT_BY_TYPE[draft.file.type] ?? \"pdf\";");
    expect(src).not.toMatch(/file\.name\.split\(/);
    const map = src.match(/const DOC_EXT_BY_TYPE[^{]*\{([^}]*)\}/);
    expect(map).not.toBeNull();
    const vals = [...map![1].matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(vals.length).toBeGreaterThan(3);
    for (const v of vals) expect(ALLOWED_EXT, v).toContain(v);
  });
});
