// Q966 review: the Helpr-answer lock written the fail-open way again.
// @mutate supabase/migrations/20261003180355_dispute_text_server_owned.sql |     IF (OLD.status::text = 'disputed'\n        AND v_uid IS NOT NULL\n        AND v_uid = OLD.helper_id\n        AND OLD.disputed_by IS DISTINCT FROM OLD.helper_id\n        AND NULLIF(btrim(COALESCE(OLD.dispute_helper_response, '')), '') IS NULL) IS NOT TRUE THEN |     IF NOT (OLD.status::text = 'disputed'\n        AND v_uid IS NOT NULL\n        AND v_uid = OLD.helper_id\n        AND OLD.disputed_by IS DISTINCT FROM OLD.helper_id\n        AND NULLIF(btrim(COALESCE(OLD.dispute_helper_response, '')), '') IS NULL) THEN
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * A REFUSAL MUST NOT BE SKIPPED BY A NULL.
 *
 * `IF NOT (<allowed>) THEN RAISE` reads as "refuse unless allowed", but when
 * any comparison inside <allowed> meets a NULL the whole condition is NULL,
 * NOT NULL is NULL, and plpgsql's IF NULL does NOT run the RAISE: the write
 * goes through. Found by the lh-authz-rls review of Q966 (2026-10-03): the new
 * Helpr-answer lock compared `v_uid = OLD.helper_id`, and on a crew job (or a
 * Helpr whose account is gone; jobs_helper_id_fkey is ON DELETE SET NULL)
 * helper_id is NULL, so the poster could write the crew's answer. Q728 was
 * the same NULL in open_dispute_as (`_uid <> _helper` on a crew).
 *
 * The fail-closed spellings: `IF (<allowed>) IS NOT TRUE THEN RAISE`, or the
 * comparisons made NULL-safe (IS [NOT] DISTINCT FROM, COALESCE(..., false)).
 *
 * INVENTORY: every function the migrations leave in the database (replayed in
 * order, later rewrites and DROPs applied; comments blanked). Each
 * `IF NOT ( … ) THEN RAISE` whose parenthesised condition holds a bare
 * `=`, `<>` or `!=` outside EXISTS(...) / COALESCE(...) is an offender. The
 * shape is narrow on purpose: `IF NOT a AND b = c` is a deny-IF (refuse when
 * b is known to be c), where NULL meaning "not known" is the intent.
 */

const MIG = join(__dirname, "..", "..", "supabase", "migrations");

/** Replace each balanced `NAME( … )` call (EXISTS, COALESCE) with TRUE: neither can be NULL-skipped. */
function stripNullSafeCalls(s: string): string {
  const re = /\b(?:EXISTS|COALESCE)\s*\(/gi;
  let out = "";
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    out += s.slice(i, m.index);
    let depth = 1;
    let j = re.lastIndex;
    for (; j < s.length && depth; j++) {
      if (s[j] === "(") depth++;
      else if (s[j] === ")") depth--;
    }
    out += " TRUE ";
    i = j;
    re.lastIndex = j;
  }
  return out + s.slice(i);
}

/** Every `IF NOT ( … ) THEN RAISE` in one function body, flagged when its condition holds a bare comparison. */
export function negatedRefusals(stmt: string): { cond: string; nullable: boolean }[] {
  const body = blankSqlComments(stmt);
  const out: { cond: string; nullable: boolean }[] = [];
  const re = /\bIF\s+NOT\s*\(/gi;
  while (re.exec(body)) {
    let depth = 1;
    let j = re.lastIndex;
    for (; j < body.length && depth; j++) {
      if (body[j] === "(") depth++;
      else if (body[j] === ")") depth--;
    }
    if (!/^\s*THEN\s+RAISE\b/i.test(body.slice(j))) continue;
    const cond = body.slice(re.lastIndex, j - 1);
    out.push({ cond: cond.replace(/\s+/g, " ").trim(), nullable: /(?<![<>!@=])(=|<>|!=)(?![>=])/.test(stripNullSafeCalls(cond)) });
  }
  return out;
}

describe("a refusal is not skipped by a NULL (IF NOT (<comparison>) THEN RAISE)", () => {
  const defs = effectiveDefs(MIG);
  const all = [...defs].flatMap(([name, d]) => negatedRefusals(d.stmt).map((r) => ({ name, file: d.file, ...r })));

  it("the inventory is real", () => {
    expect(defs.size).toBeGreaterThan(300);
    // The shape exists (fail-closed ones included), so a parser that finds nothing cannot pass.
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((r) => r.name === "enforce_jobs_dispute_evidence_append_only")).toBe(true);
  });

  it("no live function refuses with IF NOT (<bare comparison>) THEN RAISE", () => {
    const offenders = all.filter((r) => r.nullable).map((r) => `${r.name} (${r.file}): IF NOT (${r.cond.slice(0, 160)}) THEN RAISE`);
    expect(
      offenders,
      "a NULL in the comparison makes the condition NULL and the RAISE is skipped; write `IF (<allowed>) IS NOT TRUE THEN RAISE`",
    ).toEqual([]);
  });

  describe("the guard can fail", () => {
    it("on the Q966 review's original: the Helpr-answer lock before the fix", () => {
      const original = `CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN
        IF NOT (OLD.status::text = 'disputed'
                AND v_uid IS NOT NULL
                AND v_uid = OLD.helper_id
                AND OLD.disputed_by IS DISTINCT FROM OLD.helper_id
                AND NULLIF(btrim(COALESCE(OLD.dispute_helper_response, '')), '') IS NULL) THEN
          RAISE EXCEPTION 'no' USING ERRCODE = '42501';
        END IF; RETURN NEW; END $function$;`;
      expect(negatedRefusals(original).filter((r) => r.nullable)).toHaveLength(1);
    });

    it("and not on the fail-closed spellings or a NULL-safe comparison", () => {
      const ok = `IF (v_uid = OLD.helper_id) IS NOT TRUE THEN RAISE EXCEPTION 'x'; END IF;
        IF NOT (COALESCE(NEW.a, '{}') @> COALESCE(OLD.a, '{}')) THEN RAISE EXCEPTION 'y'; END IF;
        IF NOT (v_uid IS NOT DISTINCT FROM OLD.helper_id) THEN RAISE EXCEPTION 'z'; END IF;
        IF NOT EXISTS (SELECT 1 FROM t WHERE t.a = 1) THEN RAISE EXCEPTION 'w'; END IF;
        IF NOT (x = 1) THEN RETURN NEW; END IF;`;
      expect(negatedRefusals(ok).filter((r) => r.nullable)).toEqual([]);
    });
  });
});
