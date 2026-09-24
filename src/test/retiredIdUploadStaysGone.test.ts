/**
 * CLASS CHECK — the retired "upload your ID to us" path stays retired (Q40).
 *
 * Users never send an ID to Helpr: Stripe Identity collects it (owner,
 * 2026-09-23). The legacy path survived anyway, in four layers that did not
 * know about each other:
 *   - Profile.tsx `handleIdUpload` → id-documents + profiles.id_document_url
 *     (+ idv_status 'pending'), unreachable but live code;
 *   - CompleteProfile / uploadProfileFiles `idFile` → id-documents, always null;
 *   - complete-signup `idBase64` → id-documents + id_document_url, and its
 *     `portfolioFiles` → user-documents + portfolio_urls, sent by no client;
 *   - admin People → Documents "ID Document" section, signing id-documents.
 *
 * INVENTORY: every non-test .ts/.tsx under src/ and supabase/functions/,
 * walked from the tree, comments blanked with the shared helper (string bodies
 * kept: the bucket name lives in a string). A hit on any RETIRED token is a
 * reader or writer of the retired path coming back.
 *
 * KNOWN_READERS is EXACT and two-way (see each entry's reason).
 *
 * DATABASE HALF (20260923145614 emptied the column, pinned it NULL with a CHECK
 * and dropped the bucket's four client policies; 20260923165718 (Q196) then
 * dropped the column, its CHECK and the id-documents bucket itself — the app
 * had not launched, so no shipped build still selected it): read from
 * supabase/migrations with SQL comments blanked,
 *   - the column is either dropped or still pinned NULL (its retired CHECK's
 *     last statement is the ADD);
 *   - no function's NEWEST definition names the column (plpgsql binds columns
 *     at call time, so a stale body fails every call with 42703 — exactly how
 *     purge_user_data would have broken account deletion);
 *   - each of the four id-documents policies' last statement is its DROP.
 *
 * @mutate supabase/migrations/20260924072554_redacted_job_description_is_user_copy.sql |        SET full_name                = NULL, |        SET full_name                = NULL, id_document_url = NULL,
 * @mutate supabase/migrations/20260923165718_drop_retired_id_document_column_and_bucket.sql | ALTER TABLE IF EXISTS public.profiles DROP COLUMN IF EXISTS id_document_url; | SELECT 1;
 * @mutate supabase/migrations/20260923145614_drop_retired_id_document_upload.sql | DROP POLICY IF EXISTS "Admins can view all ID documents"        ON storage.objects; | SELECT 1;
 * @mutate supabase/functions/complete-signup/index.ts | if (phone) updateData.phone = phone; | if (phone) updateData.phone = phone; if (body.idBase64) updateData.id_document_url = "x";
 * @mutate src/components/admin/adminusers/useOpenProfile.ts | setViewProfile(profile); | setViewProfile(profile); void supabase.storage.from("id-documents").createSignedUrl("x", 1);
 * @mutate supabase/functions/_shared/purgeBuckets.ts | "avatars", | "avatars", "id-documents",
 * @mutate src/components/ProtectedRoute.tsx | avatar_url?: string \| null; | avatar_url?: string \| null; id_document_url?: string \| null;
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const ROOTS = ["src", "supabase/functions"];

/** Generated from the live schema; follows the column, not the app. */
const GENERATED = new Set(["src/integrations/supabase/types.ts"]);

/** Tokens that only the retired path uses. */
const RETIRED: { token: RegExp; what: string }[] = [
  { token: /\bid_document_url\b/, what: "profiles.id_document_url" },
  { token: /["'`]id-documents["'`]/, what: "the id-documents bucket" },
  { token: /\bidBase64\b/, what: "complete-signup's idBase64 upload" },
  { token: /\bportfolioFiles\b/, what: "complete-signup's portfolioFiles upload" },
];

/** `file :: what`, each with why it may stay. */
// @two-way src/test/retiredIdUploadStaysGone.test.ts:const staleReaders =
// Empty since Q196 (2026-09-23): the bucket and the column are both dropped, so
// accountPurge no longer sweeps the bucket and GateProfile no longer names it.
const KNOWN_READERS: Record<string, string> = {};

const MIGRATIONS = join(REPO, "supabase", "migrations");
const COLUMN = /\bid_document_url\b/;
const ID_POLICIES = [
  "Users can upload their own ID docs",
  "Users can view their own ID docs",
  "Admins can view all ID documents",
  "Users can delete their own ID documents",
];
type Migration = { file: string; sql: string };

/** Every migration, oldest first, with SQL comments blanked. */
function migrations(): Migration[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, sql: blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8")) }));
}

/** function name -> body of its NEWEST definition (any dollar-quote tag). */
function newestFunctionBodies(migs: Migration[]): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>();
  const def = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
  for (const { file, sql } of migs) {
    for (const m of sql.matchAll(def)) {
      const rest = sql.slice(m.index!);
      const open = /\bAS\s+(\$\w*\$)/i.exec(rest);
      if (!open) continue;
      const start = open.index + open[0].length;
      const end = rest.indexOf(open[1], start);
      if (end === -1) continue;
      out.set(m[1].toLowerCase(), { file, body: rest.slice(start, end) });
    }
  }
  return out;
}

/** The last statement in migration history that adds or drops the column. */
function lastColumnDdl(migs: Migration[]): string | null {
  let last: string | null = null;
  const ddl = /\b(add|drop)\s+column\s+(?:if\s+(?:not\s+)?exists\s+)?id_document_url\b/gi;
  for (const { file, sql } of migs) for (const m of sql.matchAll(ddl)) last = `${m[1].toLowerCase()} @ ${file}`;
  return last;
}

/** "add" or "drop": whichever the history says last about the retired CHECK. */
function lastRetiredConstraint(migs: Migration[]): string | null {
  let last: string | null = null;
  const re = /\b(add|drop)\s+constraint\s+(?:if\s+exists\s+)?profiles_id_document_url_retired\b/gi;
  for (const { sql } of migs) for (const m of sql.matchAll(re)) last = m[1].toLowerCase();
  return last;
}

/** "create" or "drop": whichever the history says last about this policy. */
function lastPolicyStatement(migs: Migration[], name: string): string | null {
  let last: string | null = null;
  const re = new RegExp(`\\b(create|drop)\\s+policy\\s+(?:if\\s+exists\\s+)?"${name}"`, "gi");
  for (const { sql } of migs) for (const m of sql.matchAll(re)) last = m[1].toLowerCase();
  return last;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules" || entry === "test" || entry === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

function retiredHits(files: { file: string; text: string }[]): string[] {
  const hits = new Set<string>();
  for (const { file, text } of files) {
    if (GENERATED.has(file)) continue;
    const code = blankComments(text);
    for (const { token, what } of RETIRED) if (token.test(code)) hits.add(`${file} :: ${what}`);
  }
  return [...hits].sort();
}

describe("the retired ID-upload path stays gone (Q40)", () => {
  const files = ROOTS.flatMap((r) => walk(join(REPO, r))).map((f) => ({
    file: relative(REPO, f),
    text: readFileSync(f, "utf8"),
  }));

  it("walks the real tree (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(800);
    expect(files.some((f) => f.file === "supabase/functions/complete-signup/index.ts")).toBe(true);
    expect(files.some((f) => f.file === "src/pages/profile/Profile.tsx")).toBe(true);
  });

  it("no reader or writer of the retired path, beyond the exact known list", () => {
    const hits = retiredHits(files);
    const staleReaders = Object.keys(KNOWN_READERS).filter((k) => !hits.includes(k));
    expect(staleReaders, "stale KNOWN_READERS entry — remove it in the same commit").toEqual([]);
    expect(
      hits.filter((h) => !(h in KNOWN_READERS)),
      "the retired 'upload your ID to us' path is back — Stripe Identity collects the ID (Q40)",
    ).toEqual([]);
  });

  describe("database half", () => {
    const migs = migrations();
    const bodies = newestFunctionBodies(migs);

    it("reads the real history (not vacuous)", () => {
      expect(migs.length).toBeGreaterThan(500);
      expect(bodies.size).toBeGreaterThan(300);
      // Newest definition, not a pinned file: AL-012 (20260924072554) redefined it after the drop.
      expect(bodies.get("purge_user_data")?.file ?? "").toMatch(/^\d{14}_/);
      expect((bodies.get("purge_user_data")?.file ?? "") >= "20260923145614").toBe(true);
    });

    it("the column is dropped, or still pinned NULL by its retired CHECK", () => {
      const dropped = lastColumnDdl(migs)?.startsWith("drop") ?? false;
      expect(dropped || lastRetiredConstraint(migs) === "add", "id_document_url can hold data again").toBe(true);
    });

    it("no function's newest definition still names the dropped column", () => {
      const stale = [...bodies]
        .filter(([, { body }]) => COLUMN.test(body))
        .map(([fn, { file }]) => `${fn} @ ${file}`);
      expect(stale, "a function body names profiles.id_document_url: every call fails with 42703").toEqual([]);
    });

    it.each(ID_POLICIES)("the id-documents policy %s ends dropped", (name) => {
      expect(lastPolicyStatement(migs, name)).toBe("drop");
    });

    it("can fail: a stale body and a re-added column are both caught", () => {
      const planted: Migration[] = [
        { file: "a.sql", sql: "ALTER TABLE public.profiles DROP COLUMN IF EXISTS id_document_url;" },
        {
          file: "b.sql",
          sql:
            "CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $x$ BEGIN UPDATE profiles SET id_document_url = NULL; END $x$;\n" +
            "ALTER TABLE public.profiles ADD COLUMN id_document_url text;",
        },
      ];
      expect(lastColumnDdl(planted)).toBe("add @ b.sql");
      expect(COLUMN.test(newestFunctionBodies(planted).get("f")!.body)).toBe(true);
    });
  });

  it("can fail: the deleted Profile.tsx writer is caught, a comment is not", () => {
    const planted = [
      "// id_document_url in a comment is fine",
      'await supabase.storage.from("id-documents").upload(path, file);',
      "await supabase.from(\"profiles\").update({ id_document_url: path, idv_status: \"pending\" });",
    ].join("\n");
    expect(retiredHits([{ file: "src/pages/profile/Profile.tsx", text: planted }])).toEqual([
      "src/pages/profile/Profile.tsx :: profiles.id_document_url",
      "src/pages/profile/Profile.tsx :: the id-documents bucket",
    ]);
    expect(retiredHits([{ file: "src/x.ts", text: "// id_document_url, \"id-documents\"" }])).toEqual([]);
  });
});
