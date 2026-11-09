/**
 * Part 3 message review (owner UI audit 11-09), wording only. Reads the NEWEST definition of each SQL notice producer
 * (effectiveDefs), comments blanked.
 *
 * F192 + F193: after a 3rd change request the person who posted read "⚠️ Scope creep detected" (jargon, emoji, an
 * accusing tone) and the Helpr "Admins have been notified." with no next step; both now say what happened, what they
 * can do, and call the people who settle problems "our team". Proof of unchanged behaviour:
 * src/test/pglite/revisionNoticeWording.pglite.mjs.
 *
 * @mutate supabase/migrations/20261109193417_revision_notices_plain_words.sql |         'Several changes asked on this job', |         '⚠️ Scope creep detected',
 * @mutate supabase/migrations/20261109193417_revision_notices_plain_words.sql | Our team can see this and will step in if needed. | Admins have been notified.
 *
 * F194: the role is "Helpr" in every member notice the edge functions send (it read "the helpr" in five), and the
 * expiring-job push drops "visibility" and "!".
 * @mutate supabase/functions/create-payment/index.ts | Payment was released to the Helpr.` | Payment was released to the helpr.`
 * @mutate supabase/functions/expiring-jobs-push/index.ts | nobody's been picked yet. Boost it so more Helprs see it.` | with no helpr yet. Boost it to get more visibility!`
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { readFileSync } from "node:fs";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const body = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "");

describe("F192/F193: the change-request notices are plain and name 'our team'", () => {
  it("track_revision_scope_creep's two member notices", () => {
    const b = body("track_revision_scope_creep");
    expect(b.length).toBeGreaterThan(500);
    expect(b).toContain("'Several changes asked on this job'");
    expect(b).toContain("ask our team to step in");
    expect(b).toContain("'Several changes asked on your job'");
    expect(b).toContain("Our team can see this and will step in if needed.");
    expect(b).not.toMatch(/⚠|Scope creep detected|Admins have been notified/);
    // The staff fraud flag keeps its own words (staff only).
    expect(b).toContain("'scope_creep'");
  });
});

describe("F194: 'Helpr' is capitalised in the edge functions' member notices", () => {
  const FILES = ["create-payment", "auto-expire-jobs", "expiring-jobs-push"].map((f) => `supabase/functions/${f}/index.ts`);
  it("no member notice message says a lower-case 'helpr'", () => {
    const hits: string[] = [];
    for (const f of FILES) {
      const code = blankComments(readFileSync(resolve(__dirname, "../..", f), "utf8"));
      // One literal per message, whichever quote it uses (a template holds "…" around the job title).
      for (const m of code.matchAll(/message:\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) if (/\bhelpr\b/.test(m[1])) hits.push(`${f}: ${m[1].slice(0, 80)}`);
    }
    expect(FILES.length).toBe(3);
    expect(hits).toEqual([]);
  });

  it("the expiring-job push has no upsell jargon or exclamation", () => {
    const code = blankComments(readFileSync(resolve(__dirname, "../../supabase/functions/expiring-jobs-push/index.ts"), "utf8"));
    expect(code).toContain("Boost it so more Helprs see it.");
    expect(code).not.toMatch(/visibility!/);
  });
});

