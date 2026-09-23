/*
 * CLASS CHECK — no notification producer writes a doubled apostrophe (Q310).
 *
 * FOUND 2026-09-23: 20260902014651 wrote check_referral_bonus inside
 * `EXECUTE $fn$ … $fn$`, where no quote unescaping happens, so its message
 * was 'Your referral''''s first posted job…' and every recipient read
 * "referral''s". Measured live via pg_get_functiondef. Later restatements
 * copied the text verbatim, so the defect survived three migrations.
 *
 * THE CHECK: in the EFFECTIVE definition of every function that inserts into
 * notifications (src/test/helpers/effectiveFunctionDefs.ts replays every
 * migration), no string literal contains four consecutive quotes. Inside a
 * dollar-quoted body a literal with '''' is an escaped '' — never intended in
 * user-facing copy.
 *
 * @mutate supabase/migrations/20260923211309_referral_bonus_links_and_apostrophe.sql | 'Your referral''s first | 'Your referral''''s first
 */
import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIGRATIONS = join(resolve(__dirname, "..", ".."), "supabase", "migrations");
const INSERTS_NOTIFICATION = /\binsert\s+into\s+(?:public\.)?notifications\b/i;

describe("notification copy is not over-escaped (Q310)", () => {
  it("no notification producer's effective body contains a '''' literal", () => {
    const offenders: string[] = [];
    for (const [name, def] of effectiveDefs(MIGRATIONS)) {
      if (!INSERTS_NOTIFICATION.test(def.stmt)) continue;
      const hit = def.stmt.match(/[^\n]*\w''''\w[^\n]*/);
      if (hit) offenders.push(`${name} (${def.file}): ${hit[0].trim().slice(0, 120)}`);
    }
    expect(offenders).toEqual([]);
  });
});
