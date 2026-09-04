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

  /**
   * THE OTHER DIRECTION, and the one that actually found something.
   *
   * The test above discovers browse feeds by NAME (`public.*open_jobs*`) and
   * asks whether each is registered. That is a convention masquerading as a
   * definition, and the registry's own fifth entry already violates it:
   * `notify_saved_searches_on_new_job` is a gated surface the name rule cannot
   * see. A byte-identical function passes or fails purely on what it is called.
   *
   * The obvious repair — discover by BEHAVIOUR, "selects jobs where status is
   * open" — was prototyped over all migrations before this was written, and it
   * is STRICTLY WORSE: it returns 13 candidates, ZERO of which are the four
   * real browse surfaces, and all 13 of which are ordinary job logic
   * (`enforce_open_job_limit`, `helper_cancel_booking`, `rpc_open_dispute`…).
   * A guard that noisy gets an allowlist bolted on until it is quiet, and then
   * it guards nothing. Recorded here so nobody re-derives it.
   *
   * What IS decidable without ambiguity: an object that CALLS the gate is a
   * gated surface, by construction. Zero false positives possible. So this
   * asks the reverse question — is everything that consults the authority
   * actually registered? — and the answer was no: `notify_helpers_on_job_post`
   * calls `seed_jobs_hidden_publicly()` and was absent from the list. Confirmed
   * against the live database, where exactly six objects call the gate.
   *
   * The consequence of that gap is the subtle kind: the surface BEHAVES
   * correctly today, so nothing is visibly broken. But the parity suite proves
   * its claim only over registered surfaces, so if someone later removed the
   * gate from an unregistered one, every test would still pass.
   */
  /**
   * DISCOVERY AXIS TWO: what SELECTS open jobs?
   *
   * This is the forward question, and it is kept alongside the caller-based
   * check below because NEITHER SUBSUMES THE OTHER, which took a real bug to
   * learn:
   *
   *   · "what calls the gate, and is it all registered?" is decidable with zero
   *     false positives, and it found a gated surface missing from the registry
   *     (`notify_helpers_on_job_post`). It is structurally BLIND to a feed that
   *     never had a gate at all — such a feed calls nothing, so a check that
   *     starts from callers cannot see it.
   *   · This one is noisy and needs the allowlist below. It is also the only
   *     half that found `sweep_daily_job_digest`: a daily per-parish digest
   *     EMAIL counting fixture jobs, with no `is_seed` reference anywhere in it.
   *     At the time, 9 of 9 open jobs with a parish were fixtures — so flipping
   *     the launch switch would have silenced every browse surface while that
   *     email kept telling users about jobs they could not find.
   *
   * I had prototyped this predicate, measured it as noisy, and set it aside as
   * "strictly worse". That judgement was wrong about what it is FOR. Noisy
   * discovery plus a reasoned allowlist beats precise discovery that cannot see
   * the case you care about.
   *
   * Every allowlist entry states why it is not a public feed. Nothing goes in
   * here to quiet a failure — that is how the name regex this replaced came to
   * exist.
   */
  const NOT_A_PUBLIC_FEED = new Map<string, string>([
    // Mutations on ONE job the caller is already party to. They read
    // `status = 'open'` as a precondition, not as a feed filter.
    ["public.decline_job_offer", "single-job mutation; status is a precondition"],
    ["public.expire_unanswered_offers", "sweep over offers, not a browse feed"],
    ["public.helper_abort_job", "single-job mutation; status is a precondition"],
    ["public.helper_cancel_booking", "single-job mutation; status is a precondition"],
    ["public.report_helper_no_show", "single-job mutation; status is a precondition"],
    ["public.rpc_open_dispute", "single-job mutation; status is a precondition"],
    ["public.settle_dispute_record", "single-job mutation; status is a precondition"],
    ["public.can_message_in_job", "authorisation check on one job"],
    // Counts the POSTER'S OWN open jobs to enforce a cap. Their own fixtures
    // should count against their own cap.
    ["public.enforce_open_job_limit", "BEFORE-trigger counting the poster's own open jobs"],
    // The helper's own applications. A fixture job you applied to must keep
    // rendering on your activity screen after the flag flips, or the row you
    // are looking at silently vanishes.
    ["public.get_jobs_for_my_applications", "the caller's OWN applications, not a public feed"],
    // Dead RPC: zero callers in src/ or supabase/functions (grepped 2026-09-03).
    // Exempt because reddening the tree over a function nothing calls is how a
    // gate gets switched off — but it counts open jobs with no is_seed filter,
    // so it needs the gate BEFORE it is ever wired to anything.
    [
      "public.get_marketplace_activity_count",
      "no caller in src/ or supabase/functions as of 2026-09-03 — dead RPC; needs the gate before it is ever wired up",
    ],
  ]);

  /**
   * The exemptions above that hold ONLY while nothing calls the object.
   *
   * Their reason text is prose, and prose is not a check. This is the same
   * failure shape the name-regex axis had: the guard reads as if it verifies
   * something it never looks at. `get_marketplace_activity_count` counts open
   * jobs with no `is_seed` filter and consults no gate (confirmed against prod
   * on 2026-09-03 — its live `pg_get_functiondef` contains neither
   * `seed_jobs_hidden_publicly` nor `is_seed`). It is exempt purely because
   * nothing calls it. Wire it into, say, a landing-page "jobs posted this
   * month" counter and the exemption is silently false: this suite stays green
   * while that counter reports fixture jobs after the launch flip.
   *
   * So the precondition is asserted, not asserted-in-a-comment. If this fails,
   * do NOT add the caller to an allowlist — give the object the gate and move
   * it into SEED_GATED_SURFACES.
   */
  const EXEMPT_ONLY_WHILE_UNCALLED = ["get_marketplace_activity_count"];

  it("every exemption that depends on having no callers still has none", () => {
    // `src/integrations/supabase/types.ts` is generated from the schema and
    // names every RPC that exists, so it is a mention, never a call site.
    const GENERATED = resolve(__dirname, "../integrations/supabase/types.ts");
    const stripComments = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\n"'`]*\/\/.*$/gm, "");

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") walk(path);
        } else if (
          /\.tsx?$/.test(entry.name) &&
          !entry.name.endsWith("parity.test.ts") &&
          // `src/test/edge/harness.ts` writes and deletes gitignored `.gen.ts`
          // siblings while its own tests run concurrently with this one — a
          // real file that can vanish between this readdirSync and the
          // readFileSync below. It is scaffolding, never a real call site.
          !entry.name.includes(".gen.")
        ) {
          if (path !== GENERATED) files.push(path);
        }
      }
    };
    walk(resolve(__dirname, ".."));
    walk(resolve(__dirname, "../../supabase/functions"));

    const offenders: string[] = [];
    for (const fn of EXEMPT_ONLY_WHILE_UNCALLED) {
      for (const path of files) {
        let content: string;
        try {
          content = readFileSync(path, "utf8");
        } catch {
          // Same transient-file race, one layer later — the harness deleted
          // it between the walk above and this read. Not a real source file.
          continue;
        }
        if (stripComments(content).includes(fn)) {
          offenders.push(`${fn} <- ${path}`);
        }
      }
    }

    expect(
      offenders.sort(),
      `These objects are exempt from the seed gate ONLY because nothing calls ` +
        `them, and something now does. Give them the gate and register them in ` +
        `SEED_GATED_SURFACES — do not widen the exemption.`,
    ).toEqual([]);
  });

  it("every migration object that SELECTS open jobs is gated or declared not-a-feed", () => {
    const registered = new Set(SEED_GATED_SURFACES.map((s) => s.object.toLowerCase()));

    const header = /CREATE (?:OR REPLACE )?(?:FUNCTION|VIEW)\s+(public\.\w+)/gi;
    const selectsOpenJobs = new Set<string>();
    const dropped = new Set<string>();
    for (const { sql } of FILES) {
      const heads = [...sql.matchAll(header)];
      heads.forEach((h, i) => {
        const body = sql.slice(
          (h.index ?? 0) + h[0].length,
          i + 1 < heads.length ? heads[i + 1].index : sql.length,
        );
        if (
          /\b(?:FROM|JOIN)\s+(?:public\.)?jobs\b/i.test(body) &&
          /\bstatus\s*(?:::\s*\w+)?\s*=\s*'open'/i.test(body)
        ) {
          selectsOpenJobs.add(h[1].toLowerCase());
        }
      });
      for (const d of sql.matchAll(
        /DROP\s+(?:FUNCTION|VIEW)\s+(?:IF EXISTS\s+)?(public\.\w+)/gi,
      )) {
        dropped.add(d[1].toLowerCase());
      }
    }
    for (const d of dropped) selectsOpenJobs.delete(d);
    const discovered = [...selectsOpenJobs];

    // Sanity: the discovery must find things, or this passes vacuously.
    expect(discovered.length, "discovery found nothing — the extraction drifted").toBeGreaterThan(0);

    // NO "the browse RPCs must appear here" ANCHOR, and the reason is worth
    // stating because the obvious version of it is wrong. The three browse RPCs
    // read the GATED VIEW `open_jobs_browse` (which carries
    // `NOT is_seed OR NOT seed_jobs_hidden_publicly()`), so in migration TEXT
    // they do not present as `FROM jobs` + `status = 'open'` and this scan does
    // not discover them. That is correct behaviour, not a gap: they inherit the
    // gate from the view, and the caller-based check below is what covers them.
    //
    // The positive anchor here is the anti-rot rule instead. Every one of the
    // NOT_A_PUBLIC_FEED entries must still be discovered, so if the extraction
    // ever breaks, all of them go stale at once and this fails loudly rather
    // than quietly finding nothing. A guard needs SOME assertion that fails
    // when it stops working; this is that assertion.

    // Anti-rot: an allowlist entry for something no longer discovered is stale
    // and must be removed, so the list can only shrink.
    const stale = [...NOT_A_PUBLIC_FEED.keys()].filter((o) => !discovered.includes(o));
    expect(stale, "stale NOT_A_PUBLIC_FEED entries — remove them").toEqual([]);

    const unaccounted = discovered
      .filter((o) => !registered.has(o) && !NOT_A_PUBLIC_FEED.has(o))
      .sort();
    expect(
      unaccounted,
      `These objects select open jobs but are neither registered as seed-gated ` +
        `surfaces nor declared NOT_A_PUBLIC_FEED. Either give them the gate and ` +
        `register them, or declare why they are not a public feed.`,
    ).toEqual([]);
  });

  it("every object that CALLS the seed gate is registered as a gated surface", () => {
    const registered = new Set(SEED_GATED_SURFACES.map((s) => s.object.toLowerCase()));

    // Union across every definition in history, not just the latest: if any
    // revision of an object ever consulted the gate, it is a gated surface and
    // must be on the list. Conservative in the safe direction.
    const header = /CREATE (?:OR REPLACE )?(?:FUNCTION|VIEW)\s+(public\.\w+)/gi;
    const callers = new Set<string>();
    const dropped = new Set<string>();
    for (const { sql } of FILES) {
      const heads = [...sql.matchAll(header)];
      heads.forEach((h, i) => {
        const body = sql.slice(
          (h.index ?? 0) + h[0].length,
          i + 1 < heads.length ? heads[i + 1].index : sql.length,
        );
        if (body.includes(SEED_VISIBILITY_AUTHORITY)) callers.add(h[1].toLowerCase());
      });
      for (const d of sql.matchAll(
        /DROP\s+(?:FUNCTION|VIEW)\s+(?:IF EXISTS\s+)?(public\.\w+)/gi,
      )) {
        dropped.add(d[1].toLowerCase());
      }
    }
    // The authority defines itself; it is not one of its own consumers.
    callers.delete(SEED_VISIBILITY_AUTHORITY.toLowerCase());
    for (const d of dropped) callers.delete(d);

    // Same sanity floor as above: a discovery that finds nothing passes for
    // exactly the reason this file exists to prevent.
    expect(
      callers.size,
      "found NO callers of the seed gate — the extraction has drifted",
    ).toBeGreaterThan(0);

    expect(
      [...callers].filter((c) => !registered.has(c)).sort(),
      `These objects call ${SEED_VISIBILITY_AUTHORITY}() — so they ARE seed-gated ` +
        `surfaces — but are absent from SEED_GATED_SURFACES, which means nothing ` +
        `asserts they keep the gate. Add them to showSeedJobs.ts.`,
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
