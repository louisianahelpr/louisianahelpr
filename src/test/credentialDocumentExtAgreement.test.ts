// @mutate supabase/functions/_shared/storageKeys.ts |   heic: "image/heic",\n}; |   heic: "image/heic",\n  gif: "image/gif",\n};
// @mutate supabase/functions/_shared/storageKeys.ts | return mime ? { ext: e, contentType: mime } : null; | return { ext: e, contentType: mime ?? "application/octet-stream" };
// @mutate supabase/functions/complete-signup/index.ts | if (unsupportedDocs.length > 0) { | if (false) {
// @mutate supabase/functions/complete-signup/index.ts | /credentials/license-${Date.now()}.${licenseDoc.ext}` | /credentials/license-${Date.now()}.${safeDocumentExt(licenseContentType, licenseExt)}`
// @mutate supabase/functions/complete-signup/index.ts | contentType: insuranceDoc.contentType, | contentType: insuranceContentType \|\| "application/octet-stream",
// @mutate supabase/migrations/20260921092104_cap_private_storage_buckets.sql | 'image/heic','application/pdf'] | 'image/heic','application/pdf','image/gif']
// @mutate src/components/profile/CredentialsTab.tsx | "image/webp", "application/pdf"]; | "image/webp", "application/pdf", "image/tiff"];
// @mutate supabase/migrations/20260923110759_credential_url_is_own_document.sql | [Pp][Nn][Gg]\|[Jj][Pp][Ee]?[Gg]\|[Ww][Ee][Bb][Pp]\|[Hh][Ee][Ii][Cc])$') THEN | [Pp][Nn][Gg]\|[Jj][Pp][Ee]?[Gg]\|[Ww][Ee][Bb][Pp])$') THEN
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import {
  CREDENTIAL_DOCUMENT_EXT_MIME,
  credentialDocument,
} from "../../supabase/functions/_shared/storageKeys.ts";

/**
 * Q133 (docs/OPEN.md): four lists decide what a credential document may be,
 * and they must agree, or a real signup breaks.
 *
 *   1. the user-documents bucket's allowed_mime_types — read from the newest
 *      migration statement that sets it (20260921092104); cross-checked live
 *      2026-09-23: {image/jpeg,image/png,image/webp,image/heic,application/pdf};
 *   2. CREDENTIAL_DOCUMENT_EXT_MIME / credentialDocument() in
 *      supabase/functions/_shared/storageKeys.ts (what complete-signup uses),
 *      layered on safeDocumentExt()'s wider DOCUMENT_MIME_EXT map;
 *   3. CredentialsTab.tsx's ALLOWED_TYPES / DOC_EXT_BY_TYPE (the in-app path);
 *   4. the extension group of the Q127/Q130 trigger helpers
 *      credential_document_path_ok() and helper_credential_document_ok(),
 *      which REFUSE any other extension.
 *
 * complete-signup uploads, then writes the path in the SAME profiles UPDATE
 * that approves the account. If (2) let an extension through that (4) refuses,
 * that UPDATE fails (22023) after the upload: a 500, an unapproved account and
 * an orphaned object. So complete-signup asks credentialDocument() BEFORE any
 * upload and answers 400 for an unsupported file; this test pins that order
 * and that the four lists agree.
 */

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
// SQL/TS comments BLANKED (string-aware), never deleted: src/test/guardsDoNotDeleteSource.test.ts
// forbids the regex stripper (Q129).
const stripSql = blankSqlComments;
const stripTs = blankComments;
const ws = (s: string) => s.replace(/\s+/g, " ").trim();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/** The user-documents bucket's allowed_mime_types after replaying every migration that sets it. */
function bucketMimes(): { file: string; mimes: string[] | null } {
  let last: { file: string; mimes: string[] | null } = { file: "", mimes: null };
  for (const f of files) {
    for (const stmt of stripSql(readFileSync(join(MIG, f), "utf8")).split(";")) {
      if (!/storage\.buckets/i.test(stmt) || !/allowed_mime_types/i.test(stmt) || !stmt.includes("'user-documents'")) continue;
      const m = stmt.match(/allowed_mime_types\s*=\s*(?:ARRAY\s*\[([^\]]*)\]|NULL)/i);
      if (!m) continue;
      last = { file: f, mimes: m[1] === undefined ? null : [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort() };
    }
  }
  return last;
}

function newestBody(name: string): string {
  let body = "";
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`, "gi");
  for (const f of files) {
    const sql = stripSql(readFileSync(join(MIG, f), "utf8"));
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index!);
      const tag = rest.match(/\bAS\s+(\$[A-Za-z_0-9]*\$)/);
      if (!tag) continue;
      const open = tag.index! + tag[0].length;
      body = ws(rest.slice(open, rest.indexOf(tag[1], open)));
    }
  }
  return body;
}

/** Literal extensions admitted by a `-[0-9]{13}\.(…)$'` group of case-insensitive alternatives. */
function triggerExts(body: string): string[] {
  const alt = body.match(/-\[0-9\]\{13\}\\\.\(([^)]*)\)\$'\)/);
  expect(alt, "extension group must be closed and end-anchored").not.toBeNull();
  return [
    ...new Set(
      alt![1].split("|").flatMap((a) => {
        const letters = [...a.matchAll(/\[([A-Za-z])[A-Za-z]\](\?)?/g)].map((m) => ({ c: m[1].toLowerCase(), opt: !!m[2] }));
        const full = letters.map((l) => l.c).join("");
        const short = letters.filter((l) => !l.opt).map((l) => l.c).join("");
        return full === short ? [full] : [full, short];
      }),
    ),
  ].sort();
}

/** `const NAME … = { "k": "v", … }` or `[ "a", … ]` in a TS source, as entries. */
function tsMap(src: string, name: string): Array<[string, string]> {
  const m = stripTs(src).match(new RegExp(`const ${name}[^=]*=\\s*\\{([^}]*)\\}`));
  expect(m, `${name} not found`).not.toBeNull();
  return [...m![1].matchAll(/"?([\w/.-]+)"?\s*:\s*"([^"]+)"/g)].map((x) => [x[1], x[2]]);
}
function tsArray(src: string, name: string): string[] {
  const m = stripTs(src).match(new RegExp(`const ${name}[^=]*=\\s*(?:new Set\\()?\\[([^\\]]*)\\]`));
  expect(m, `${name} not found`).not.toBeNull();
  return [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const bucket = bucketMimes();
const storageKeys = read("supabase", "functions", "_shared", "storageKeys.ts");
const credentialsTab = read("src", "components", "profile", "CredentialsTab.tsx");
const credExts = Object.keys(CREDENTIAL_DOCUMENT_EXT_MIME).sort();

describe("credential document types agree across bucket, edge function, client and triggers (Q133)", () => {
  it("reads the bucket list from a real migration", () => {
    expect(bucket.file >= "20260921092104", bucket.file).toBe(true);
    expect(bucket.mimes?.length ?? 0).toBeGreaterThan(3);
  });

  it("the bucket admits exactly the content types credentialDocument() stores as", () => {
    expect([...new Set(Object.values(CREDENTIAL_DOCUMENT_EXT_MIME))].sort()).toEqual(bucket.mimes);
  });

  it("credentialDocument()'s extensions are exactly what both credential triggers accept", () => {
    const profiles = newestBody("credential_document_path_ok");
    const helper = newestBody("helper_credential_document_ok");
    expect(profiles && helper, "a trigger helper is missing").toBeTruthy();
    expect(triggerExts(profiles)).toEqual(credExts);
    expect(triggerExts(helper)).toEqual(credExts);
  });

  it("every bucket type round-trips; every other type safeDocumentExt knows is refused before upload", () => {
    for (const mime of bucket.mimes ?? []) {
      const d = credentialDocument(mime, undefined);
      expect(d, mime).not.toBeNull();
      expect(credExts).toContain(d!.ext);
      expect(d!.contentType, mime).toBe(mime);
    }
    const docMimes = tsMap(storageKeys, "DOCUMENT_MIME_EXT").map(([k]) => k);
    expect(docMimes.length).toBeGreaterThan(5);
    for (const mime of docMimes.filter((m) => !(bucket.mimes ?? []).includes(m))) {
      expect(credentialDocument(mime, undefined), mime).toBeNull();
    }
    const fallbackExts = tsArray(storageKeys, "DOCUMENT_EXT_ALLOWED");
    expect(fallbackExts.length).toBeGreaterThan(5);
    for (const ext of [...fallbackExts, "bin", "exe", "svg"]) {
      const d = credentialDocument(undefined, ext);
      if (credExts.includes(ext)) expect(d?.ext, ext).toBe(ext);
      else expect(d, ext).toBeNull();
      // Whatever it stores, the bucket admits.
      if (d) expect(bucket.mimes).toContain(d.contentType);
    }
  });

  it("the in-app picker only offers bucket types, each mapped to a trigger extension", () => {
    const allowed = tsArray(credentialsTab, "ALLOWED_TYPES");
    const map = new Map(tsMap(credentialsTab, "DOC_EXT_BY_TYPE"));
    expect(allowed.length).toBeGreaterThan(3);
    for (const t of allowed) {
      expect(bucket.mimes, t).toContain(t);
      expect(credExts, `${t} -> ${map.get(t)}`).toContain(map.get(t));
    }
  });

  it("complete-signup decides the credential type BEFORE any upload, and uses only what it decided", () => {
    const src = stripTs(read("supabase", "functions", "complete-signup", "index.ts"));
    const firstUpload = src.indexOf(".upload(");
    expect(firstUpload).toBeGreaterThan(0);
    const lic = src.indexOf("credentialDocument(licenseContentType, licenseExt)");
    const ins = src.indexOf("credentialDocument(insuranceContentType, insuranceExt)");
    const refuse = src.indexOf("if (unsupportedDocs.length > 0) {");
    expect(lic).toBeGreaterThan(0);
    expect(ins).toBeGreaterThan(0);
    expect(refuse).toBeGreaterThan(Math.max(lic, ins));
    expect(refuse).toBeLessThan(firstUpload);
    expect(ws(src.slice(refuse, refuse + 400))).toMatch(/return new Response\([\s\S]*status: 400/);
    expect(src).toContain("const licensePath = `${userId}/credentials/license-${Date.now()}.${licenseDoc.ext}`;");
    expect(src).toContain("const insurancePath = `${userId}/credentials/insurance-${Date.now()}.${insuranceDoc.ext}`;");
    expect(src).toContain("contentType: licenseDoc.contentType,");
    expect(src).toContain("contentType: insuranceDoc.contentType,");
    expect(src).not.toMatch(/safeDocumentExt\((license|insurance)ContentType/);
  });
});
