/**
 * Q1881 (finding lh-trust-safety@4326e0ccc#7): the shared contact-leak filter
 * (contact_leak_reason: Declutter text, job text, bios, reviews, messages) let
 * a phone number or a payment app through when written in Unicode math digits,
 * fullwidth letters, single digits spaced out, or single digits mixed with
 * number words.
 *
 * CLASS: the EFFECTIVE (newest, any dollar tag) contact_leak_reason must
 *   - NFKC-normalise the text before any check,
 *   - run EVERY pattern check on the normalised text (never on p_text, which
 *     is how "ｃａｓｈａｐｐ" passed the payment check),
 *   - keep the spaced single-digit phone rule, with number words read as digits.
 * Behaviour on real Postgres: src/test/pglite/contactLeakNfkc.pglite.mjs
 * (21 PASS after, applied 3x; 6 FAIL with NEW_MIGRATION=skip; 4 mutants red).
 * Can fail on the original bug: the definitions before 20261030080734 fail all three.
 *
 * @mutate supabase/migrations/20261030080734_contact_leak_nfkc.sql | translate(normalize(p_text, NFKC), | translate(p_text,
 * @mutate supabase/migrations/20261030080734_contact_leak_nfkc.sql |   ELSIF v_norm ~* '\mvenmo\M |   ELSIF p_text ~* '\mvenmo\M
 * @mutate supabase/migrations/20261030080734_contact_leak_nfkc.sql |   ELSIF v_tokens ~ '(^\|[^0-9])[0-9]([^0-9a-z]{1,3}[0-9]){9}(?![0-9])' THEN |   ELSIF false THEN
 * @mutate supabase/migrations/20261030080734_contact_leak_nfkc.sql |   v_tokens := regexp_replace(v_tokens, '\mfive\M', '5', 'g'); |
 */
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";
const FIX = "20261030080734";
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function problems(defs: ReturnType<typeof effectiveDefs>): string[] {
  const def = defs.get("contact_leak_reason");
  if (!def) return ["contact_leak_reason: no definition"];
  const body = blankSqlComments(def.stmt);
  const out: string[] = [];
  if (!/v_norm\s*:=[^;]*\bnormalize\s*\(\s*p_text\s*,\s*NFKC\s*\)/i.test(body)) out.push("no NFKC normalisation of p_text");
  if (/\bp_text\s*~/.test(body)) out.push("a pattern check reads the raw p_text");
  if (!/\bv_tokens\s*~\s*'\(\^\|\[\^0-9\]\)\[0-9\]\(\[\^0-9a-z\]\{1,3\}\[0-9\]\)\{9\}\(\?!\[0-9\]\)'/.test(body)) out.push("no spaced single-digit phone rule");
  for (const w of WORDS) {
    if (!new RegExp(`\\\\m${w}\\\\M[^;]*'${WORDS.indexOf(w)}'`).test(body)) out.push(`number word ${w} not read as a digit`);
  }
  return out;
}

describe("Q1881: the shared contact-leak filter normalises before it scans", () => {
  it("finds the effective definition", () => {
    const defs = effectiveDefs(DIR);
    expect(defs.size).toBeGreaterThan(100);
    expect(defs.get("contact_leak_reason")?.file).toMatch(/^2026/);
  });

  it("the newest contact_leak_reason NFKC-normalises, scans only the normalised text, and catches spaced digits", () => {
    expect(problems(effectiveDefs(DIR))).toEqual([]);
  });

  it("can fail: the definition before the fix has every problem", () => {
    const before = problems(effectiveDefs(DIR, { before: FIX }));
    expect(before).toContain("no NFKC normalisation of p_text");
    expect(before).toContain("a pattern check reads the raw p_text");
    expect(before).toContain("no spaced single-digit phone rule");
  });
});
