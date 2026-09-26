// CLASS GUARD for `jobs.offered_to_helper_id` (owner decision 2026-09-14: the
// poster and the offered Helpr may know who a direct offer went to; nobody
// else may — not the hired Helpr, not a roster member, not an applicant, not a
// stranger, not anon).
//
// The BUG was four leaks (the jobs table's own SELECT grant,
// get_jobs_for_my_applications, open_jobs_browse, and a client select naming
// the column). Migration 20260915045110 fixes all four. This file guards the
// whole CLASS so the next one cannot ship, and it is built from the app's own
// inventory — the migrations and the source tree — not from a list someone
// remembered to update:
//
//   (a) No client read of `jobs` asks for columns it did not name.
//       `select("*")`, a bare `.select()` and `Prefer: return=representation`
//       without `select=` all expand to every column, so all three are now a
//       42501 on the WHOLE query, not a silently-wider row.
//   (b) Every read path that can RETURN the column is scoped to the poster or
//       the offered Helpr. The inventory is derived from the migrations, so a
//       NEW function or view that returns it fails this test until it is
//       classified here.
//   (c) JOB_READABLE_COLUMN_LIST is exactly the jobs columns minus the private
//       ones — a column missing from it is a column the app stops reading, and
//       a stale one is a 400 on every query that uses the list.
//   (d) A migration that adds a column to `jobs` must call
//       `sync_jobs_select_grants()`, or that column comes up with no SELECT
//       grant for `authenticated` and every read naming it fails in prod.
//
// Shown red on the pre-fix tree (a worktree of origin/main) before it was
// allowed to be green — see the branch's commit message.
//
// FOUND HOLLOW 2026-09-21, shape (1) "satisfiable by a comment": it passed
// 13/13 with open_jobs_browse projecting offered_to_helper_id RAW — the leak
// itself, back in the browse feed — because the deleted CASE was left behind
// as a `--` line and `latestDefinitions()` handed the assertions the RAW
// statement text. Every group-(b) and group-(d) assertion now reads the
// comment-BLANKED form (`DbObject.code`, `maskComments(...)`), and the
// registered mutation below IS the comment shape, so both doors are pinned.
// @mutate supabase/migrations/20260915045110_hide_offered_helper_from_non_posters.sql | CASE\n            WHEN customer_id = auth.uid() OR offered_to_helper_id = auth.uid() THEN offered_to_helper_id\n            ELSE NULL::uuid\n        END AS offered_to_helper_id, | offered_to_helper_id, -- CASE WHEN customer_id = auth.uid() OR offered_to_helper_id = auth.uid() THEN offered_to_helper_id ELSE NULL::uuid END AS offered_to_helper_id

import { describe, it, expect } from "vitest";
import { walkSource, readSource } from "./helpers/walkSource";
import {
  enclosingLiteral,
  isServiceRoleFile,
  jobsColumnsFromMigrations,
  jobsColumnsFromTypes,
  jobsRestPathOffsets,
  latestDefinitions,
  maskComments,
  maskJsComments,
  migrationsAddingJobsColumns,
  returnsOffereeColumn,
  type DbObject,
} from "./helpers/jobsPrivacySource";
import { JOB_PRIVATE_COLUMNS, JOB_READABLE_COLUMN_LIST } from "@/lib/jobColumns";

/** The migration that took the table-level SELECT off `public.jobs`. */
const FIX_MIGRATION = "20260915045110_hide_offered_helper_from_non_posters.sql";

/**
 * Where a CLIENT talks to the database. `supabase/functions/**` is deliberately
 * absent: edge functions hold `service_role`, which keeps its table-level
 * SELECT on `jobs` and is unaffected by the column grants — the ten
 * `from("jobs").select("*")` reads in create-payment/index.ts are all on
 * `supabaseAdmin` and are correct as they are.
 */
const CLIENT_ROOTS = ["src", "e2e", "scripts"];
const CLIENT_EXTS = [".ts", ".tsx", ".mjs", ".js"] as const;

/**
 * A vitest spec under src/ issues no PostgREST request — it runs against a
 * mock — and other guards keep SYNTHETIC query strings as their own
 * can-it-fail fixtures (`src/test/discardedQueryFilters.test.ts` holds 16
 * `from("jobs").select("*")` samples whose whole point is the discarded-filter
 * shape). Flagging those would be a false positive, and "fixing" them would
 * break the fixtures. e2e/** is NOT excluded: Playwright specs hit prod for
 * real, which is exactly where a select-less read fails.
 */
const isUnitSpec = (file: string) => /^src[/\\].*\.(test|spec)\.tsx?$/.test(file);

const clientSources = (): Array<{ file: string; src: string }> => {
  const out: Array<{ file: string; src: string }> = [];
  for (const file of walkSource(CLIENT_ROOTS, CLIENT_EXTS)) {
    if (file.includes("src/test/helpers/jobsPrivacySource")) continue; // the guard's own machinery
    if (isUnitSpec(file)) continue;
    const src = readSource(file);
    if (src === null) continue; // vanished mid-walk; cannot be an offender
    out.push({ file, src: maskJsComments(src) });
  }
  return out;
};

const lineOf = (src: string, idx: number) => src.slice(0, idx).split("\n").length;

describe("offer privacy (a): no client read of jobs takes columns it did not name", () => {
  it("no `.from(\"jobs\")` uses `select(\"*\")` or a bare `select()`", () => {
    const offenders: string[] = [];
    for (const { file, src } of clientSources()) {
      for (const m of src.matchAll(/\.from\(\s*["'`]jobs["'`]\s*\)([\s\S]{0,400}?)\.select\(([^)]*)\)/g)) {
        const arg = m[2].trim();
        if (arg === "" || /^["'`]\*["'`]$/.test(arg)) {
          offenders.push(`${file}:${lineOf(src, m.index!)} → .select(${arg || ""})`);
        }
      }
    }
    expect(
      offenders,
      "`*` expands to every column of jobs, including offered_to_helper_id, which `authenticated` may not " +
        "SELECT since 20260915045110 — PostgREST 42501s the WHOLE query. Use JOB_READABLE_COLUMNS " +
        "(src/lib/jobColumns.ts), and get the offeree from fetchJobOfferTargets().\n" +
        offenders.join("\n"),
    ).toEqual([]);
  }, 30_000);

  it("every PostgREST jobs path in client code names its columns", () => {
    const offenders: string[] = [];
    const unparsed: string[] = [];
    const serviceRoleExempt: string[] = [];

    // A write that does not ask for the row back returns nothing, so it needs
    // no column privilege. These are the shapes that say "write, no read".
    const WRITE_ONLY = /method:\s*["'`](PATCH|POST|DELETE|PUT)["'`]|\.(patch|post|delete|put)\(|["'`](patch|post|delete|put)["'`]\s*,|\bdel\(/i;

    for (const { file, src } of clientSources()) {
      const serviceRole = isServiceRoleFile(src);
      for (const idx of jobsRestPathOffsets(src)) {
        const literal = enclosingLiteral(src, idx);
        if (literal === null) { unparsed.push(`${file}:${lineOf(src, idx)}`); continue; }
        if (literal.includes("select=")) continue;

        const window = src.slice(Math.max(0, idx - 700), idx + 700);
        const wantsRow = /return=representation/i.test(window);
        const isWrite = WRITE_ONLY.test(window);
        if (!wantsRow && isWrite) continue; // a blind write; no row comes back

        if (serviceRole) { serviceRoleExempt.push(`${file}:${lineOf(src, idx)}`); continue; }
        offenders.push(
          `${file}:${lineOf(src, idx)} → ${literal.slice(0, 90)}${wantsRow ? "  [return=representation]" : "  [read]"}`,
        );
      }
    }

    // Not silently skipped: an unreadable literal means this guard has a hole.
    expect(unparsed, `jobs REST paths this guard could not parse — fix the guard, do not ignore:\n${unparsed.join("\n")}`).toEqual([]);
    // The exemptions are printed rather than assumed, so they stay reviewable.
    expect(serviceRoleExempt.length, `service_role callers exempted (they keep the table grant): ${serviceRoleExempt.join(", ")}`).toBe(7);
    expect(
      offenders,
      "A jobs read with no `select=` is `SELECT *`, and `return=representation` with no `select=` is " +
        "`RETURNING *` — both 42501 for `authenticated` since 20260915045110. Name the columns in the URL.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  }, 30_000);

  it("no client source names offered_to_helper_id inside a jobs select list", () => {
    const offenders: string[] = [];
    for (const { file, src } of clientSources()) {
      for (const m of src.matchAll(/\.from\(\s*["'`]jobs["'`]\s*\)([\s\S]{0,400}?)\.select\(\s*["'`]([^"'`]*)["'`]/g)) {
        if (m[2].split(",").some((c) => c.trim().split(":")[0].trim() === "offered_to_helper_id")) {
          offenders.push(`${file}:${lineOf(src, m.index!)} → select("${m[2]}")`);
        }
      }
      for (const idx of jobsRestPathOffsets(src)) {
        const literal = enclosingLiteral(src, idx);
        if (literal?.includes("select=") && /select=[^&]*offered_to_helper_id/.test(literal)) {
          offenders.push(`${file}:${lineOf(src, idx)} → ${literal.slice(0, 90)}`);
        }
      }
    }
    expect(
      offenders,
      "The offeree is not readable from the jobs table by any client. Use fetchJobOfferTargets() " +
        "(src/lib/jobOfferTargets.ts → get_job_offer_targets), which answers only the poster and the offeree.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  }, 30_000);
});

describe("offer privacy (b): every read path that returns the offeree is caller-scoped", () => {
  /**
   * The INVENTORY, reviewed once. Key = `kind:name`, value = why it is safe.
   *
   *   returns-guarded — the object CAN return the column, and its latest
   *     definition nulls or filters it to the poster / the offeree.
   *   own-row-only    — it returns the column, but only from rows whose
   *     offeree IS the caller, so the value is always the caller's own id.
   *   no-return       — it reads the column in a predicate, an assignment or a
   *     trigger and cannot hand it back: its return type has no such column.
   *
   * The test below derives the same set from the migrations and fails if the
   * two differ, so a new object that touches the column must be classified
   * here before it can ship.
   */
  const REVIEWED: Record<string, "returns-guarded" | "own-row-only" | "no-return"> = {
    "function:get_job_offer_targets": "own-row-only",
    "function:get_my_pending_direct_offers": "own-row-only",
    "function:get_jobs_for_my_applications": "returns-guarded",
    "view:open_jobs_browse": "returns-guarded",
    // Q290: the data export returns the caller's own jobs rows and strips the
    // column unless the caller is the poster or the offeree (checked below).
    "function:export_my_data": "returns-guarded",
    // Q345: filters on the column to decline a pending offer between the pair;
    // returns only counts (closed_offers), never the offeree.
    "function:block_user_and_settle": "no-return",
    "function:can_message_in_job": "no-return",
    "function:can_send_message_to_in_job": "no-return",
    // V-008: re-checks the job is not under a live direct offer; returns boolean.
    "function:deliver_saved_search_alert": "no-return",
    "function:enforce_application_job_state": "no-return",
    "function:enforce_hire_columns_rpc_only": "no-return",
    "function:enforce_jobs_insert_column_lock": "no-return",
    "function:get_messaging_closes_at": "no-return",
    // Q333/Q334: reads the column only to decide whether the caller has a
    // thread on the job; returns a boolean about the OTHER party, never the offeree.
    "function:get_thread_counterparty_deleted": "no-return",
    "function:get_open_jobs_for_map": "no-return",
    "function:get_public_open_jobs": "no-return",
    "function:get_ranked_open_jobs": "no-return",
    "function:instant_book_claim": "no-return",
    "function:is_party_to_job": "no-return",
    "function:jobs_private_select_columns": "no-return",
    "function:notify_helper_on_direct_offer": "no-return",
    "function:notify_helpers_on_job_post": "no-return",
    "function:notify_saved_searches_on_new_job": "no-return",
    "function:prevent_job_field_escalation": "no-return",
    "function:purge_user_data": "no-return",
    "function:respond_to_direct_offer": "no-return",
    "function:user_may_see_job_address": "no-return",
  };

  const touching = (): Array<[string, DbObject]> =>
    [...latestDefinitions()].filter(([, o]) => /offered_to_helper_id/i.test(o.text)).sort(([a], [b]) => a.localeCompare(b));

  it("the inventory derived from the migrations is exactly the reviewed set", () => {
    const derived = touching().map(([key]) => key).sort();
    const reviewed = Object.keys(REVIEWED).sort();
    expect(
      derived.filter((k) => !reviewed.includes(k)),
      "a database object now touches jobs.offered_to_helper_id and has not been classified in REVIEWED. " +
        "Decide whether it can RETURN the column, then add it.",
    ).toEqual([]);
    expect(
      reviewed.filter((k) => !derived.includes(k)),
      "REVIEWED names an object no migration defines any more — delete the stale entry.",
    ).toEqual([]);
  }, 30_000);

  it("every object classified `no-return` really cannot return the column", () => {
    const wrong = touching()
      .filter(([key]) => REVIEWED[key] === "no-return")
      .filter(([, obj]) => returnsOffereeColumn(obj))
      .map(([key, obj]) => `${key} (${obj.file})`);
    expect(
      wrong,
      "these are classified `no-return` but their output shape carries offered_to_helper_id — " +
        "either they leak it or the classification is stale.",
    ).toEqual([]);
  }, 30_000);

  it("get_job_offer_targets returns a row only to the poster or the offeree", () => {
    const def = latestDefinitions().get("function:get_job_offer_targets");
    expect(def, "get_job_offer_targets is not defined in any migration").toBeTruthy();
    const text = def!.code.replace(/\s+/g, " ");
    expect(def!.file, "the accessor must come from the offer-privacy migration").toBe(FIX_MIGRATION);
    expect(text, "the accessor must be caller-bound").toContain("SECURITY DEFINER");
    expect(text).toMatch(/SET search_path TO 'public'/);
    expect(
      text,
      "the accessor must restrict rows to the poster or the offeree, reading auth.uid() itself",
    ).toContain("j.customer_id = (SELECT auth.uid()) OR j.offered_to_helper_id = (SELECT auth.uid())");
    expect(text, "it must never take the caller's identity as an argument").not.toMatch(/p_user_id|p_uid|p_caller/);
  });

  it("get_jobs_for_my_applications nulls the offeree for everyone but the poster and the offeree", () => {
    const def = latestDefinitions().get("function:get_jobs_for_my_applications");
    const text = def!.code.replace(/\s+/g, " ");
    expect(def!.file, "the latest definition must be the offer-privacy one").toBe(FIX_MIGRATION);
    expect(
      text,
      "the RPC returns SETOF jobs, so it must override the column rather than pass the row through",
    ).toContain("CASE WHEN j.customer_id = v_uid OR j.offered_to_helper_id = v_uid THEN j.offered_to_helper_id ELSE NULL END");
  });

  it("export_my_data strips the offeree for everyone but the poster and the offeree (Q290)", () => {
    const def = latestDefinitions().get("function:export_my_data");
    expect(def, "export_my_data is not defined in any migration").toBeTruthy();
    const text = def!.code.replace(/\s+/g, " ");
    expect(text).toContain(
      "CASE WHEN t.customer_id = v_uid OR t.offered_to_helper_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'offered_to_helper_id' END",
    );
    expect(text, "it must never take the caller's identity as an argument").not.toMatch(/p_user_id|p_uid|p_caller/);
  });

  it("open_jobs_browse nulls the offeree for everyone but the poster and the offeree", () => {
    const def = latestDefinitions().get("view:open_jobs_browse");
    const text = def!.code.replace(/\s+/g, " ");
    expect(def!.file, "the latest view definition must be the offer-privacy one").toBe(FIX_MIGRATION);
    expect(
      text,
      "the browse view projects the column, so it must CASE-null it",
    ).toContain("CASE WHEN customer_id = auth.uid() OR offered_to_helper_id = auth.uid() THEN offered_to_helper_id ELSE NULL::uuid END AS offered_to_helper_id");
    // The view's owner bypasses RLS: a write grant on it is an unpoliced write
    // to public.jobs (F-SEC-05, 20260706140000). The migration that redefines
    // the view restates the REVOKE.
    // Comment-blanked for the same reason: a `-- DROP VIEW …` line must not
    // fail this, and a commented-out REVOKE must not satisfy it.
    const migration = maskComments(readSource(`supabase/migrations/${FIX_MIGRATION}`)!);
    expect(migration, "a redefinition of open_jobs_browse must use CREATE OR REPLACE, never DROP + CREATE")
      .not.toMatch(/DROP\s+VIEW\s+(IF\s+EXISTS\s+)?(public\.)?open_jobs_browse/i);
    const flat = migration.replace(/\s+/g, " ");
    // `REVOKE ALL` + `GRANT SELECT`, the shape 20260915041247 landed: a named
    // privilege list would have to name MAINTAIN, which the db-deploy
    // replay-smoke Postgres cannot parse (migrationPrivilegeKeywords.test.ts).
    expect(flat, "and must restate the write REVOKE on the way out")
      .toContain("REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;");
    expect(flat, "and re-grant the read the guest browse depends on")
      .toContain("GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;");
  });
});

describe("offer privacy (c): JOB_READABLE_COLUMN_LIST is the jobs columns minus the private ones", () => {
  /**
   * `boost_auto_extended` is in prod (and so in the generated types) but no
   * migration creates it — it was added out of band. RECORDED here rather than
   * papered over: it is real migration drift, it belongs in docs/OPEN.md, and
   * pinning it means a SECOND undocumented column fails this test instead of
   * hiding behind the first.
   */
  // @two-way src/test/offeredHelperPrivacy.test.ts:).toEqual(KNOWN_UNMIGRATED_COLUMNS.slice().sort())
  const KNOWN_UNMIGRATED_COLUMNS = ["boost_auto_extended"];

  const readable = [...JOB_READABLE_COLUMN_LIST] as string[];
  const priv = [...JOB_PRIVATE_COLUMNS] as string[];

  it("the private column is the offeree, and it is not in the readable list", () => {
    expect(priv).toEqual(["offered_to_helper_id"]);
    expect(readable).not.toContain("offered_to_helper_id");
    expect(new Set(readable).size, "the readable list has a duplicate").toBe(readable.length);
  });

  it("readable + private is exactly the jobs Row of the generated types", () => {
    const fromTypes = jobsColumnsFromTypes().sort();
    const listed = [...readable, ...priv].sort();
    expect(fromTypes.length, "types.ts jobs Row did not parse").toBeGreaterThan(100);
    expect(
      fromTypes.filter((c) => !listed.includes(c)),
      "a jobs column exists in prod but is in neither JOB_READABLE_COLUMN_LIST nor JOB_PRIVATE_COLUMNS — " +
        "the app would never read it. Add it to src/lib/jobColumns.ts.",
    ).toEqual([]);
    expect(
      listed.filter((c) => !fromTypes.includes(c)),
      "JOB_READABLE_COLUMN_LIST names a column that no longer exists — PostgREST 400s the whole select.",
    ).toEqual([]);
  });

  it("every jobs column the migrations create is covered by the list", () => {
    const fromMigrations = [...jobsColumnsFromMigrations()].sort();
    const listed = [...readable, ...priv];
    expect(fromMigrations.length, "the migration walk found no jobs columns").toBeGreaterThan(100);
    expect(
      fromMigrations.filter((c) => !listed.includes(c)),
      "a column the migrations add to jobs is missing from src/lib/jobColumns.ts.",
    ).toEqual([]);
    expect(
      listed.filter((c) => !fromMigrations.includes(c)).sort(),
      "a jobs column exists that no migration creates — that is migration drift. If it is real and new, " +
        "add the migration; if it is known, record it in KNOWN_UNMIGRATED_COLUMNS and in docs/OPEN.md.",
    ).toEqual(KNOWN_UNMIGRATED_COLUMNS.slice().sort());
  });
});

describe("offer privacy (d): a migration that adds a jobs column re-syncs the grants", () => {
  it("every jobs ADD COLUMN at or after the fix calls sync_jobs_select_grants()", () => {
    const offenders = migrationsAddingJobsColumns()
      .filter((m) => m.file >= FIX_MIGRATION)
      .filter((m) => !/sync_jobs_select_grants\s*\(\s*\)/i.test(maskComments(m.text)))
      .map((m) => `${m.file} adds ${m.columns.join(", ")}`);
    expect(
      offenders,
      "`authenticated` has column-level SELECT grants on jobs, so a NEW column comes up with no grant at " +
        "all and every read naming it fails in prod with 42501. End the migration with " +
        "`SELECT public.sync_jobs_select_grants();` and add the column to src/lib/jobColumns.ts.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  }, 30_000);

  it("the fix migration itself ends by syncing the grants", () => {
    const sql = maskComments(readSource(`supabase/migrations/${FIX_MIGRATION}`)!);
    expect(sql.trimEnd().endsWith("SELECT public.sync_jobs_select_grants();")).toBe(true);
  });
});
