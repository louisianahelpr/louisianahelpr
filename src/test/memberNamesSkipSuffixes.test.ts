/**
 * Jobs audit 11-21 (G9): a short name ("First L.") never takes its initial from a name suffix or from bracketed
 * text. Measured on prod before the fix: "John Smith Jr." -> "John J.", "Tremaine Broussard II" -> "Tremaine I.",
 * "Jean-Baptiste (Seed 16)" -> "Jean-Baptiste 1.".
 *
 * The rule has three copies and all three must agree: formatName (src/lib/utils.ts), memberDisplayName
 * (supabase/functions/_shared/memberDisplayName.ts) and public.member_display_name (20261121233442). This file
 * runs the two TypeScript copies on the audit's names and reads the NEWEST SQL definition for the same rule.
 * Behaviour of the SQL itself (3x replay, parity with both copies over 800 names, unchanged output for names
 * with no suffix or bracket, grants): src/test/pglite/memberDisplayNameSuffix.pglite.mjs.
 *
 * @mutate src/lib/utils.ts | const last = [...rest].reverse().find((w) => !NAME_SUFFIX.test(w)) ?? rest[rest.length - 1]; | const last = rest[rest.length - 1];
 * @mutate src/lib/utils.ts | const laterWords = (parts: string[]) => parts.slice(1).join(" ").replace(/\([^)]*\)/g, " ").split(" ").filter(Boolean); | const laterWords = (parts: string[]) => parts.slice(1);
 * @mutate supabase/functions/_shared/memberDisplayName.ts | const last = [...rest].reverse().find((w) => !NAME_SUFFIX.test(w)) ?? rest[rest.length - 1]; | const last = rest[rest.length - 1];
 * @mutate supabase/functions/_shared/memberDisplayName.ts | const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean); | const parts = (fullName ?? "").replace(/\([^)]*\)/g, " ").trim().split(/\s+/).filter(Boolean);
 * @mutate supabase/migrations/20261121233442_member_display_name_skips_suffixes.sql | WHERE u.w !~* '^(jr\|sr\|ii\|iii\|iv\|v)\.?,?$' | WHERE true
 * @mutate supabase/migrations/20261121233442_member_display_name_skips_suffixes.sql | regexp_replace(array_to_string(v.parts[2:], ' '), '\([^)]*\)', ' ', 'g') | array_to_string(v.parts[2:], ' ')
 */
import { describe, expect, it } from "vitest";
import { formatName } from "@/lib/utils";
import { memberDisplayName } from "../../supabase/functions/_shared/memberDisplayName";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { join } from "node:path";

const CASES: [string, string][] = [
  ["John Smith Jr.", "John S."],
  ["Tremaine Broussard II", "Tremaine B."],
  ["Mary Ann Landry Sr", "Mary L."],
  ["Jean-Baptiste Émile Arceneaux-Thibodeaux III", "Jean-Baptiste A."],
  ["Jean-Baptiste (Seed 16)", "Jean-Baptiste"],
  ["John Smith, Jr.", "John S."],
  ["John Smith IV", "John S."],
  ["Ann (Annie) Doucet", "Ann D."],
  // Every later word a suffix: the last word stays, so the rule is idempotent ("Mary V." stays "Mary V.").
  ["John Jr", "John J."],
  ["Mary V.", "Mary V."],
  // The first word is never changed, so a leading bracket never lets the surname lead (lh-authz-rls review).
  ["(Jane) Landry", "(Jane) L."],
  ["(Mary Ann) Landry Broussard", "(Mary B."],
  ["(Seed 3)", "(Seed 3."],
  // Not suffixes.
  ["Ann Vi", "Ann V."],
  ["Ann Junior", "Ann J."],
  ["Lexi Lombas", "Lexi L."],
];

describe("short names skip a suffix and bracketed text (Jobs audit 11-21, G9)", () => {
  it("formatName and memberDisplayName give the same short name for every case", () => {
    expect(CASES.length).toBeGreaterThan(10);
    for (const [name, want] of CASES) {
      expect(formatName(name), name).toBe(want);
      expect(memberDisplayName(name), name).toBe(want);
    }
    // Every word after the first bracketed: the first word alone.
    expect(formatName("Ann (Seed 3) (he/him)")).toBe("Ann");
    expect(memberDisplayName("Ann (Seed 3) (he/him)")).toBe("Ann");
  });

  it("formatting a short name again changes nothing (installed clients format the server's value again)", () => {
    for (const [name] of CASES) expect(formatName(formatName(name)), name).toBe(formatName(name));
  });

  it("the newest public.member_display_name drops brackets and skips the same suffixes", () => {
    const defs = effectiveDefs(join(process.cwd(), "supabase/migrations"));
    const def = defs.get("member_display_name");
    expect(def?.file).toBe("20261121233442_member_display_name_skips_suffixes.sql");
    expect(def!.stmt).toContain("regexp_replace(array_to_string(v.parts[2:], ' '), '\\([^)]*\\)', ' ', 'g')");
    expect(def!.stmt).toContain("WHEN cardinality(r.rest) = 0 THEN v.parts[1]");
    expect(def!.stmt).toContain("WHERE u.w !~* '^(jr|sr|ii|iii|iv|v)\\.?,?$'");
    expect(def!.stmt).toMatch(/ORDER BY u\.i DESC LIMIT 1/);
  });
});
