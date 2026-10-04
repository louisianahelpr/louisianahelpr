/**
 * Q1202 — the Helpr on an offer may clear its response window, never move it.
 *
 * enforce_helper_jobs_column_whitelist listed response_deadline, so the
 * assigned Helpr of an unconfirmed offer could PATCH it years out and
 * expire_unanswered_offers never fired. The whitelist now refuses any
 * non-NULL change from the Helpr's seat. Three layers:
 *   1. DB: the effective whitelist carries the refusal.
 *   2. DB: the only functions that set it to a non-NULL value are the
 *      poster's accept RPCs (the poster is outside the Helpr branch); every
 *      other writer clears it. A new non-NULL writer that runs as the Helpr
 *      would be refused, so it must be classified here first.
 *   3. Client: no jobs update in src/ sends response_deadline.
 * Behaviour, red then green: src/test/pglite/helperOnlyClearsResponseDeadline.pglite.mjs
 * (applied 3x: ALL PASS; NEW_MIGRATION=skip: 2 FAILED).
 */
import { describe, it, expect } from "vitest";
import { join, relative } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";

const ROOT = process.cwd();
const defs = effectiveDefs(join(ROOT, "supabase/migrations"));
// The poster's accept RPCs stamp the window the poster picked.
const POSTER_SIDE_SETTERS = ["accept_application", "accept_group_application"];

describe("Q1202: the Helpr only clears jobs.response_deadline", () => {
  it("the effective whitelist refuses a non-NULL change from the Helpr", () => {
    const body = blankSqlComments(defs.get("enforce_helper_jobs_column_whitelist")?.stmt ?? "").replace(/\s+/g, " ");
    expect(body).toContain(
      "IF NEW.response_deadline IS DISTINCT FROM OLD.response_deadline AND NEW.response_deadline IS NOT NULL THEN RAISE EXCEPTION 'Helpers may only clear jobs.response_deadline, not move it'",
    );
  });

  it("only the poster's accept RPCs set it to a value; every other writer clears it", () => {
    const setters: string[] = [];
    let clearers = 0;
    for (const [name, def] of defs) {
      const code = blankSqlComments(def.stmt);
      for (const m of code.matchAll(/(?<![\w.])response_deadline\s*(?::=|=)\s*([^,;\n)]+)/gi)) {
        const v = m[1].trim();
        if (/^null\b/i.test(v)) clearers++;
        else if (!/^(?:OLD|NEW)\.response_deadline\b/i.test(v) && !/^\$|^now\(\)\s*[<>]/.test(v)) setters.push(`${name}: ${v}`);
      }
    }
    expect(clearers).toBeGreaterThan(5);
    const unexpected = setters.filter((s) => !POSTER_SIDE_SETTERS.some((n) => s.startsWith(`${n}:`)));
    expect(unexpected, "a function sets response_deadline to a value; if it runs as the Helpr the whitelist refuses it").toEqual([]);
    expect(setters.some((s) => s.startsWith("accept_application:")), "the scan no longer sees accept_application's stamp: it is blind").toBe(true);
  });

  it("no client jobs update sends response_deadline", () => {
    const src = walkSource([join(ROOT, "src")]).filter((f) => !/\.test\.tsx?$|\/src\/test\//.test(f));
    const hits: string[] = [];
    let updates = 0;
    for (const f of src) {
      const code = blankComments(readSource(f) ?? "");
      for (const m of code.matchAll(/\.from\(\s*["']jobs["']\s*\)/g)) {
        const end = code.indexOf(";", m.index!);
        const chain = code.slice(m.index!, end === -1 ? undefined : end);
        if (!/\.(update|upsert)\s*\(/.test(chain)) continue;
        updates++;
        if (/response_deadline\s*:/.test(chain)) hits.push(`${relative(ROOT, f)}:${code.slice(0, m.index!).split("\n").length}`);
      }
    }
    expect(updates).toBeGreaterThan(10);
    expect(hits).toEqual([]);
  });
});

// @mutate supabase/migrations/20261004192041_helper_only_clears_response_deadline.sql |   IF NEW.response_deadline IS DISTINCT FROM OLD.response_deadline AND NEW.response_deadline IS NOT NULL THEN |   IF false THEN
