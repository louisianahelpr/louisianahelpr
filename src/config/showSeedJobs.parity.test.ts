import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SEED_GATED_SURFACES,
  SEED_VISIBILITY_AUTHORITY,
  SEED_VISIBILITY_FLAG_KEY,
} from "./showSeedJobs";

/**
 * The fixture-visibility switch reached ONE of three browse surfaces for as
 * long as it was a client constant: `/jobs` passed `p_include_seed`, while the
 * map RPC took no arguments and `open_jobs_browse` had no `is_seed` column.
 * Nothing failed — the two surfaces that could not honour it simply did not,
 * silently, and the docstring went on claiming otherwise.
 *
 * Now that the switch is one SQL function, the same drift is one careless
 * `CREATE OR REPLACE` away: a later migration re-issues `get_open_jobs_for_map`
 * from an older body, the gate quietly leaves that surface, and every test in
 * the repo still passes. So this grades the LATEST definition of every gated
 * object in the migration tree — not the migration that introduced the gate,
 * which would keep passing forever after being superseded (the exact trap
 * `earlyAccess.parity.test.ts` documents having fallen into twice).
 */

const MIGRATIONS_DIR = resolve(__dirname, "../../supabase/migrations");

const FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  // Timestamp-prefixed, so filename order is chronological.
  .sort()
  .map((name) => ({ name, sql: readFileSync(resolve(MIGRATIONS_DIR, name), "utf8") }));

/** `public.foo` → the markers that begin a definition of it. */
function markersFor(object: string): string[] {
  return [
    `CREATE OR REPLACE FUNCTION ${object}(`,
    `CREATE FUNCTION ${object}(`,
    `CREATE OR REPLACE VIEW ${object} `,
    `CREATE VIEW ${object} `,
  ];
}

/**
 * The last definition of `object` anywhere in the tree, as the SQL text of
 * that one statement. Dollar-quoted function bodies are sliced to their
 * closing tag; a view runs to its first `;` (view bodies here contain none).
 */
function latestDefinition(object: string): { file: string; body: string } {
  for (let i = FILES.length - 1; i >= 0; i--) {
    const { name, sql } = FILES[i];
    let start = -1;
    for (const marker of markersFor(object)) {
      const at = sql.lastIndexOf(marker);
      if (at > start) start = at;
    }
    if (start === -1) continue;

    const tagMatch = sql.slice(start).match(/AS (\$[A-Za-z_]*\$)/);
    if (tagMatch) {
      const tag = tagMatch[1];
      const bodyStart = sql.indexOf(tag, start) + tag.length;
      const end = sql.indexOf(tag, bodyStart);
      return { file: name, body: sql.slice(start, end === -1 ? undefined : end) };
    }
    const semi = sql.indexOf(";", start);
    return { file: name, body: sql.slice(start, semi === -1 ? undefined : semi) };
  }
  throw new Error(`no definition of ${object} found in ${MIGRATIONS_DIR}`);
}

/** Comment lines can say anything; only executable SQL counts as a gate. */
function executable(body: string): string {
  return body
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

describe("fixture-job visibility — one switch, every surface", () => {
  it("the authority function exists and reads the documented flag key", () => {
    const { body } = latestDefinition(SEED_VISIBILITY_AUTHORITY);
    expect(executable(body)).toContain(SEED_VISIBILITY_FLAG_KEY);
    expect(executable(body)).toContain("platform_settings");
  });

  it("fails toward TODAY'S behaviour — an unreadable flag keeps fixtures visible", () => {
    // `COALESCE(…, false)` is the whole safety property: a missing key, a
    // reset blob or an absent settings row must never empty the public
    // marketplace. Named for the exception (`…_hidden_…`) for the same reason.
    const { body } = latestDefinition(SEED_VISIBILITY_AUTHORITY);
    expect(executable(body)).toMatch(/COALESCE\([\s\S]*false\s*\)/);
    expect(SEED_VISIBILITY_FLAG_KEY).toContain("hidden");
  });

  it.each(SEED_GATED_SURFACES.map((s) => [s.surface, s.object] as const))(
    "%s (%s) consults the authority in its LATEST definition",
    (_surface, object) => {
      const { file, body } = latestDefinition(object);
      expect(
        executable(body),
        `${object} was last defined in ${file} and no longer calls ${SEED_VISIBILITY_AUTHORITY}()`,
      ).toContain(`${SEED_VISIBILITY_AUTHORITY}()`);
    },
  );

  /**
   * THE LIST ITSELF IS THE WEAK POINT, and this is the test that says so.
   *
   * The `it.each` above proves every surface IN `SEED_GATED_SURFACES` consults
   * the authority. It cannot prove the list is COMPLETE — and on 2026-09-02 it
   * was not. `public.get_public_open_jobs`, the anon landing teaser, was absent,
   * so the suite passed while that one surface had no `is_seed` reference at
   * all. Flipping the flag at launch would have silenced /jobs, the dashboard
   * and the map while the public marketing page kept advertising fixture jobs,
   * which reads as a content problem and is actually a missing `AND`.
   *
   * A registry guarded by a test that only checks what the registry names is a
   * guard with a hole exactly the shape of whatever you forgot to register. So:
   * discover the surfaces from the migrations instead of from the list, and
   * fail if the migrations know about one the list does not.
   */
  it("every open-jobs feed in the migrations is registered as a gated surface", () => {
    const registered = new Set<string>(SEED_GATED_SURFACES.map((s) => s.object));

    // Replay the migrations in order: a CREATE registers a surface, a later
    // DROP retires it. Without the DROP half this flags every predecessor the
    // history ever contained — `public.open_jobs_safe` was dropped in
    // 20260618120000 for leaking raw locations to anon, and demanding a seed
    // gate on an object that no longer exists is noise that gets the whole
    // test deleted.
    const discovered = new Set<string>();
    for (const { sql } of FILES) {
      for (const m of sql.matchAll(
        /CREATE (?:OR REPLACE )?(?:FUNCTION|VIEW)\s+(public\.\w*open_jobs\w*)/gi,
      )) {
        discovered.add(m[1].toLowerCase());
      }
      for (const m of sql.matchAll(
        /DROP\s+(?:FUNCTION|VIEW)\s+(?:IF EXISTS\s+)?(public\.\w*open_jobs\w*)/gi,
      )) {
        discovered.delete(m[1].toLowerCase());
      }
    }

    // Sanity: the discovery must actually find things, or this test passes for
    // the wrong reason — the exact failure it exists to prevent.
    expect(discovered.size).toBeGreaterThan(0);

    const unregistered = [...discovered].filter(
      (o) => ![...registered].some((r) => r.toLowerCase() === o),
    );

    expect(
      unregistered,
      `These browse feeds select open jobs but are NOT in SEED_GATED_SURFACES, so ` +
        `nothing asserts they honour ${SEED_VISIBILITY_AUTHORITY}(). Add them to the ` +
        `list in showSeedJobs.ts — and give them the gate — before the flag is flipped.`,
    ).toEqual([]);
  });

  it("keeps `p_include_seed` narrowing-only — a caller can hide fixtures, never re-admit them", () => {
    const { body } = latestDefinition("public.get_ranked_open_jobs");
    // `NOT is_seed OR (p_include_seed AND NOT <flag>)`: the argument is
    // AND-ed with the flag, so `p_include_seed => true` cannot widen.
    expect(executable(body)).toMatch(
      /NOT j\.is_seed OR \(\s*p_include_seed AND NOT [\w.]*seed_hidden\s*\)/,
    );
  });

  it("no client-side seed flag survives", () => {
    // The constant that could only ever reach one of the three surfaces. If
    // it comes back as live code, this file's whole premise is wrong.
    // Comments are stripped first: showSeedJobs.ts names the retired constant
    // in prose on purpose, so the next reader can find out where it went.
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\n"'`]*\/\/.*$/gm, "");
    const srcDir = resolve(__dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith("parity.test.ts")) {
          if (stripComments(readFileSync(path, "utf8")).includes("SHOW_SEED_JOBS_PUBLICLY")) {
            offenders.push(path);
          }
        }
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
