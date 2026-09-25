// @mutate supabase/migrations/20260925143327_notification_copy_names_the_person.sql | $q$'" was cancelled by the person who posted it.'$q$ | $q$'" was cancelled by the poster.'$q$
// @mutate supabase/migrations/20260925143327_notification_copy_names_the_person.sql | $q$COALESCE(full_name, 'Someone')$q$ | $q$COALESCE(full_name, 'A poster')$q$
// @mutate supabase/migrations/20260925143327_notification_copy_names_the_person.sql | $q$The job is now open to everyone.$q$ | $q$The job is now visible to all helpers.$q$
// @mutate supabase/migrations/20260925143327_notification_copy_names_the_person.sql | $q$'You finished your first job and earned a $5 referral credit!'$q$ | $q$'You finished your first job as a Helpr and earned a $5 referral credit!'$q$
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

/**
 * NEVER ROLE-BASED, IN THE SQL-WRITTEN COPY TOO.
 *
 * CLAUDE.md: "copy addressing only Helprs or only posters is a defect".
 * roleNeutralCopy.test.ts and helprNotHelperInCopy.test.ts hold that rule for
 * src/ and supabase/functions (TypeScript). Notifications written by Postgres
 * triggers and RPCs were outside both, and still said "cancelled by the
 * poster", "The poster viewed your application", "message the customer",
 * "visible to all helpers" until 20260925143327.
 *
 * INVENTORY: every SQL function whose EFFECTIVE body (all migrations replayed,
 * pg_get_functiondef + regexp_replace rewrites applied: effectiveDefs) writes
 * INSERT INTO notifications. Every string literal in it that contains
 * whitespace is treated as copy (keys, types and codes are single tokens).
 * Comments are blanked. A literal is a finding when it uses a role noun for a
 * person ("poster(s)", "customer(s)"), the old noun "helper(s)" (the approved
 * noun is "Helpr"), or an identity construction ("as a Helpr").
 *
 * KNOWN is exact and two-way.
 *
 * Behaviour: src/test/pglite/sqlNotificationCopyRoleNeutral.pglite.mjs loads
 * the effective bodies, applies the migration 3x and reads prosrc.
 */

const MIG = join(process.cwd(), "supabase/migrations");

const ROLE_NOUN = /(^|[^A-Za-z0-9_$./\\-])(posters?|customers?|helpers?)(?![A-Za-z0-9_$/\\:(-])/i;
const IDENTITY = /\bas an? (helpr|poster|customer|helper)s?\b/i;

// @two-way src/test/sqlNotificationCopyRoleNeutral.test.ts:stale known role copy
// function -> the finding still in it. notify_helper_on_tip is the tips lane's
// (ME-006); reword it there.
const KNOWN: Record<string, string[]> = {
  notify_helper_on_tip: ["A poster left you a $"],
};

function findings(): { producers: string[]; found: Record<string, string[]> } {
  const producers: string[] = [];
  const found: Record<string, string[]> = {};
  for (const [name, def] of effectiveDefs(MIG)) {
    const code = blankSqlComments(def.stmt);
    const at = code.search(/\bAS\s+\$[A-Za-z_0-9]*\$/i);
    const body = at >= 0 ? code.slice(at) : code;
    if (!/insert\s+into\s+(public\.)?notifications\b/i.test(body)) continue;
    producers.push(name);
    for (const m of body.matchAll(/'((?:[^']|'')*)'/g)) {
      const text = m[1];
      if (!/\s/.test(text)) continue;
      if (ROLE_NOUN.test(text) || IDENTITY.test(text)) (found[name] ??= []).push(text);
    }
  }
  return { producers: producers.sort(), found };
}

describe("SQL-written notification copy names the person, not a role", () => {
  const { producers, found } = findings();

  it("the inventory is real", () => {
    expect(producers.length).toBeGreaterThan(30);
    expect(producers).toContain("poster_cancel_job");
    expect(producers).toContain("notify_on_job_update");
  });

  it("no known entry is stale", () => {
    const stale = Object.entries(KNOWN)
      .filter(([fn, texts]) => texts.some((t) => !(found[fn] ?? []).includes(t)))
      .map(([fn]) => `stale known role copy ${fn} — remove it (lower the baseline)`);
    expect(stale).toEqual([]);
  });

  it("role words in notification copy are exactly the known list (two-way)", () => {
    expect(found).toEqual(KNOWN);
  });
});
