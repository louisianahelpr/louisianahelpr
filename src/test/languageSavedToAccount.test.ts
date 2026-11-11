/**
 * F260q (lead 11-11): the member's language is saved to their ACCOUNT (profiles.language), so server-written words
 * can follow it. Holds the three layers together: the migration (column, CHECK, member-only column grant), the
 * client write (saveLanguage.ts: own row, checked with .select + unwrapMutation, nothing for a signed-out visitor),
 * and setLang calling it. The database behaviour itself is proved by src/test/pglite/profileLanguage.pglite.mjs.
 *
 * @mutate src/lib/i18n/language.ts |   void saveModule().then((m) => m?.saveLanguage(next), | void saveModule().then((m) => m,
 * @mutate src/lib/i18n/saveLanguage.ts |     if (!userId) return;\n | \n
 * @mutate src/lib/i18n/saveLanguage.ts | .eq("user_id", userId).select("user_id") | .eq("user_id", userId)
 * @mutate supabase/migrations/20261111213927_profile_language.sql | GRANT UPDATE (language) ON public.profiles TO authenticated; | GRANT UPDATE (language) ON public.profiles TO authenticated, anon;
 * @mutate supabase/migrations/20261111213927_profile_language.sql | CHECK (language IN ('en', 'es')) | CHECK (language IS NOT NULL)
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MIG_DIR = join(ROOT, "supabase", "migrations");

/** The newest migration that names profiles.language (comments ignored). */
function newestLanguageMigration(): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  const hits = files.filter((f) => /public\.profiles[\s\S]*\blanguage\b/.test(blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"))) && /\(language\)|language text/.test(readFileSync(join(MIG_DIR, f), "utf8")));
  expect(hits.length).toBeGreaterThan(0);
  return blankSqlComments(readFileSync(join(MIG_DIR, hits.at(-1)!), "utf8"));
}

describe("the member's language is saved to the account (F260q)", () => {
  it("the migration adds the column with only en/es, and grants UPDATE on it to members only", () => {
    const sql = newestLanguageMigration();
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en'/);
    expect(sql).toMatch(/CHECK \(language IN \('en', 'es'\)\)/);
    const grants = [...sql.matchAll(/GRANT UPDATE \(language\) ON public\.profiles TO ([^;]+);/g)].map((m) => m[1].trim());
    expect(grants).toEqual(["authenticated"]);
    expect(sql).not.toMatch(/GRANT\s+UPDATE\s+ON\s+(TABLE\s+)?public\.profiles/);
  });

  it("saveLanguage writes the member's own row, checked, and nothing when signed out", () => {
    const src = blankComments(read("src/lib/i18n/saveLanguage.ts"));
    expect(src).toMatch(/if \(!userId\) return;/);
    expect(src).toMatch(/\.from\("profiles"\)\.update\(\{ language: lang \}\)\.eq\("user_id", userId\)\.select\("user_id"\)/);
    expect(src).toMatch(/unwrapMutation\(/);
    expect(src).toMatch(/report\(err,/);
  });

  it("setLang saves the pick through its own chunk (boot never carries the write)", () => {
    const src = blankComments(read("src/lib/i18n/language.ts"));
    expect(src).toMatch(/const saveModule = \(\) => loadModule\(\(\) => import\("\.\/saveLanguage"\)\);/);
    const setLang = src.slice(src.indexOf("export function setLang("), src.indexOf("function fill("));
    expect(setLang.length).toBeGreaterThan(200);
    expect(setLang).toMatch(/void saveModule\(\)\.then\(\(m\) => m\?\.saveLanguage\(next\),/);
    expect(src).not.toMatch(/^import .*saveLanguage/m);
  });
});
