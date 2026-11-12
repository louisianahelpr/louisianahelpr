/**
 * Handoff item 5 (migration 20261112025718): the departed-member scrub handles ONE-WORD names, only at the start of a
 * title or message, never for a stopword. The stopword list (public.departed_name_stopwords) must hold every
 * capitalised word a notice template in the migrations starts a literal with: this guard rebuilds that list from the
 * migrations and fails when a new template word is missing (add it to a restated departed_name_stopwords).
 *
 * Reads the EFFECTIVE definitions. Backend proof: src/test/pglite/departedScrubOneWordNames.pglite.mjs
 * (3x; FAILs without the migration; 3 mutants each FAIL).
 */
// @mutate supabase/migrations/20261112025718_departed_member_scrub_one_word_names.sql |  OR v_full = ANY (public.departed_name_stopwords())) THEN | ) THEN
// @mutate supabase/migrations/20261112025718_departed_member_scrub_one_word_names.sql |     v_rx := CASE WHEN v_one_word THEN '^' ELSE '\m' END |     v_rx := CASE WHEN v_one_word THEN '\m' ELSE '\m' END
// @mutate supabase/migrations/20261112025718_departed_member_scrub_one_word_names.sql |     'Upcoming', 'User', | 'User',
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = resolve(__dirname, "../../supabase/migrations");
const defs = effectiveDefs(MIG);
const scrub = blankSqlComments(defs.get("scrub_departed_member_name_from_notifications")?.stmt ?? "").replace(/\s+/g, " ");
const stopStmt = defs.get("departed_name_stopwords")?.stmt ?? "";
const stop = new Set([...blankSqlComments(stopStmt).matchAll(/'([A-Z][a-z]+)'/g)].map((m) => m[1]));

// The same scan the migration's list was built from: a literal right after format(, a notify call's comma, THEN, ELSE,
// || or :=, and an edge function's title/message/body string (lh-authz-rls review of 20261112025718).
const RX = /(?:format\(|notify[a-z_]*\([^;]*?,\s*|THEN\s+|ELSE\s+|\|\|\s*|:=\s*)'([A-Z][a-z]+)(?=[ ,.:!'])/g;
const RXF = /(?:title|message|body)\s*:\s*[`'"]([A-Z][a-z]+)(?=[ ,.:!'])/g;
const FN_DIR = resolve(__dirname, "../../supabase/functions");
const scanned = new Set<string>();
for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
  for (const m of readFileSync(resolve(MIG, f), "utf8").matchAll(RX)) if (m[1].length >= 2) scanned.add(m[1]);
}
for (const f of (readdirSync(FN_DIR, { recursive: true }) as string[]).filter((x) => x.endsWith(".ts")).sort()) {
  for (const m of readFileSync(resolve(FN_DIR, f), "utf8").matchAll(RXF)) if (m[1].length >= 2) scanned.add(m[1]);
}

describe("departed-member scrub: one-word names", () => {
  it("reads the newest definitions (floor)", () => {
    expect(scrub.length).toBeGreaterThan(2000);
    expect(stop.size).toBeGreaterThan(290);
    expect(scanned.size).toBeGreaterThan(220);
  });

  it("one-word names: capitalised, not a stopword, anchored at the start, not before an initial", () => {
    expect(scrub).toContain("IF OLD.anonymized_at IS NOT NULL OR NEW.anonymized_at IS NULL OR v_full = '' THEN");
    expect(scrub).not.toContain("v_full !~ '\\s' THEN");
    expect(scrub).toContain("IF v_one_word AND (v_full !~ '^[[:upper:]][[:alpha:]]+$' OR v_full = ANY (public.departed_name_stopwords())) THEN RETURN NEW;");
    expect(scrub).toContain("v_rx := CASE WHEN v_one_word THEN '^' ELSE '\\m' END");
    expect(scrub).toContain("|| CASE WHEN v_one_word THEN '(?! \\w\\.)' ELSE '' END;");
  });

  it("the stopword list holds every template-initial word and the month/weekday names", () => {
    expect([...scanned].filter((w) => !stop.has(w)).sort()).toEqual([]);
    for (const w of ["Monday", "Sunday", "Jan", "December", "Wed"]) expect(stop.has(w)).toBe(true);
    expect(stopStmt).toMatch(/IMMUTABLE/);
  });
});
