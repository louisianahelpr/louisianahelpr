/*
 * Which `@mutate` registrations break a SQL definition the database no longer
 * runs (Q406).
 *
 * A registration like
 *   // @mutate supabase/migrations/20260901000000_x.sql | <find> | <replace>
 * edits one migration's copy of a function. When a LATER migration redefines
 * that function, the guard (which reads the newest definition, as
 * guardsReadTheNewestMigration requires) never sees the edit: it stays green
 * and the registration is scored "survived" or, worse, is kept as proof while
 * it proves nothing. jobCancelClosesPendingApplications was this on 2026-09-25.
 *
 * "Newest" is effectiveDefs()'s answer, not the newest CREATE text: it replays
 * every migration, including the pg_get_functiondef + regexp_replace rewrites,
 * so a find string a rewrite has since replaced counts as superseded too.
 * CREATE TRIGGER and CREATE VIEW statements are tracked the same way (newest
 * statement of that name wins); their bodies have no rewrite migrations.
 *
 * Only a find string that sits INSIDE a tracked definition is graded. Text
 * outside every definition (a GRANT, an ALTER TABLE, a DO block) has no
 * "newer copy" to compare against and is left to the vacuity run itself.
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { blankSqlComments } from "./blankNonCode";
import { effectiveDefs, migrationFiles, parseDefs } from "./effectiveFunctionDefs";

export interface Span {
  kind: "function" | "view" | "trigger";
  key: string;
  start: number;
  end: number;
}

export interface MutateTarget {
  guard: string;
  line: number;
  target: string;
  find: string;
}

export interface SupersededTarget extends MutateTarget {
  object: string;
  /** Where the definition the database runs now comes from. */
  now: string;
}

/** A registration whose target is a migration file. */
export const MIGRATION_TARGET = /^supabase\/migrations\/[^/]+\.sql$/;

const VIEW = /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:\w+\.)?"?(\w+)"?/gi;
const TRIGGER =
  /create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+"?(\w+)"?\s+(?:before|after|instead\s+of)\b[\s\S]*?\bon\s+(?:\w+\.)?"?(\w+)"?/gi;

/** Every function, view and trigger definition in one migration, as offsets into its raw text. */
export function definitionSpans(sql: string): Span[] {
  const spans: Span[] = parseDefs(sql).map((d) => ({
    kind: "function",
    key: d.name,
    start: d.index,
    end: d.index + d.stmt.length,
  }));
  const code = blankSqlComments(sql);
  const upToSemicolon = (from: number) => {
    const semi = code.indexOf(";", from);
    return semi === -1 ? code.length : semi + 1;
  };
  for (const m of code.matchAll(VIEW)) {
    spans.push({ kind: "view", key: m[1].toLowerCase(), start: m.index!, end: upToSemicolon(m.index!) });
  }
  for (const m of code.matchAll(TRIGGER)) {
    const key = `${m[1]}@${m[2]}`.toLowerCase();
    spans.push({ kind: "trigger", key, start: m.index!, end: upToSemicolon(m.index!) });
  }
  return spans;
}

/**
 * Grade every registration in `mutations` that targets a migration.
 * `superseded`: its find string sits inside a definition that a later
 * migration (or a later statement in the same one) redefines or rewrites.
 * `inside`: how many find strings sat inside ANY tracked definition — the
 * number a caller floors, since a parser that finds no definition reports no
 * offender. `dir` is the migrations directory; a target
 * `supabase/migrations/<f>.sql` is read as `<dir>/<f>.sql`, so a fixture tree
 * can stand in for the real one.
 */
export function gradeMutateTargets(
  dir: string,
  mutations: MutateTarget[],
): { inside: number; superseded: SupersededTarget[] } {
  const fns = effectiveDefs(dir);
  const newest = new Map<string, { file: string; index: number }>();
  for (const file of migrationFiles(dir)) {
    for (const s of definitionSpans(readFileSync(join(dir, file), "utf8"))) {
      if (s.kind !== "function") newest.set(`${s.kind}:${s.key}`, { file, index: s.start });
    }
  }

  const out: SupersededTarget[] = [];
  let insideCount = 0;
  for (const m of mutations) {
    if (!MIGRATION_TARGET.test(m.target) || !m.find) continue;
    const file = basename(m.target);
    let sql: string;
    try {
      sql = readFileSync(join(dir, file), "utf8");
    } catch {
      continue; // a missing target is the vacuity run's own failure
    }
    const at = sql.indexOf(m.find);
    if (at === -1) continue;
    const inside = definitionSpans(sql)
      .filter((s) => s.start <= at && at < s.end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    if (!inside) continue;
    insideCount++;

    const object = `${inside.kind} ${inside.key}`;
    if (inside.kind === "function") {
      const eff = fns.get(inside.key);
      if (!eff) continue;
      if (eff.file !== file || eff.index !== inside.start) {
        out.push({ ...m, object, now: eff.file });
      } else if (eff.rewrites.length && !eff.stmt.includes(m.find)) {
        out.push({ ...m, object, now: `${eff.file} rewritten by ${eff.rewrites.join(", ")}` });
      }
    } else {
      const n = newest.get(`${inside.kind}:${inside.key}`);
      if (n && (n.file !== file || n.index !== inside.start)) out.push({ ...m, object, now: n.file });
    }
  }
  return { inside: insideCount, superseded: out };
}
