/**
 * CLASS GUARD (CJ-007): every scheduled job records what it did, and has a
 * work expectation or a reasoned exemption.
 *
 * THE BUG (prod, re-measured 2026-09-25): 61 active crons; the 35 SQL ones had
 * never written a cron_run_log row because their command was a bare
 * `SELECT public.fn()` and the count fn returned went nowhere, and
 * cron_work_expectations.candidate_key was NULL on 52 of 61. The app could
 * prove a job FIRED and not whether it DID anything. Fixed by
 * 20260925231818_cron_work_visibility.sql.
 *
 * THE CLASS, from the migrations (helpers/cronWorkRegister.ts):
 *   inventory = every job cron.schedule leaves scheduled (minus unschedule),
 *               plus every job with a standing liveness expectation (the
 *               jobs created outside the migrations).
 *   1. Every inventoried job has a work_visibility entry, and every entry
 *      names an inventoried job (two-way: a retired job's entry fails).
 *   2. 'candidates' needs a standing candidate_key rule; 'idle' needs
 *      work_keys and max_idle, and each key must be one its function returns;
 *      'exempt' needs a reason, and a reason that cites log_cron_defect needs
 *      a function that calls it.
 *   3. Every scheduled SQL job's NEWEST command goes through
 *      cron_record_work('<job>', ...), wrapping a function that returns
 *      something. Every HTTP job's edge function answers through cronResult
 *      with its own name (that is what puts it in cron_run_log).
 *   4. A monitored-only job with no edge function is in LIVE_ONLY_SQL, with why
 *      (two-way).
 *
 * RED on the original bug: with 20260925231818 removed, test 1 lists all 63
 * jobs as unregistered and test 3 lists all 36 SQL jobs as unrecorded
 * (CRON_WORK_MIGRATIONS_BEFORE=20260925231818 reproduces it; see the last test).
 *
 * @mutate supabase/migrations/20260925231818_cron_work_visibility.sql | ('sweep-release-last-chance',       $c$SELECT public.cron_record_work('sweep-release-last-chance', to_jsonb(public.sweep_release_last_chance()));$c$), | ('sweep-release-last-chance',       $c$SELECT public.sweep_release_last_chance();$c$),
 * @mutate supabase/migrations/20260925231818_cron_work_visibility.sql | ('weekly-helper-report',            'exempt', | ('weekly-helper-report-gone',       'exempt',
 * @mutate supabase/migrations/20260925231818_cron_work_visibility.sql | ('sweep-silent-cron-failures',      'idle', interval '6 hours', ARRAY['recorded'] | ('sweep-silent-cron-failures',      'idle', interval '6 hours', ARRAY['recorded_rows']
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import {
  candidateRules,
  jobCommands,
  jobInventory,
  workRegister,
  type MigrationFile,
} from "./helpers/cronWorkRegister";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase", "migrations");
const FUNCTIONS = join(ROOT, "supabase", "functions");

/**
 * Jobs created on the database outside the migrations whose command the repo
 * cannot see, each with why. 20260925231818 wraps them live when their command
 * is `SELECT public.<fn>();`; sweep_silent_cron_failures files them as
 * 'unrecorded' otherwise.
 */
// @two-way src/test/cronWorkVisibility.test.ts:listed as live-only but scheduled in a migration, unmonitored, or an edge function
const LIVE_ONLY_SQL: Record<string, string> = {
  "extend-boosts-hourly":
    "Created outside the migrations (cronLivenessCoverage.test.ts header); not an edge function. Its command lives only on prod.",
};

function load(before?: string): MigrationFile[] {
  return readdirSync(MIG)
    .filter((f) => f.endsWith(".sql") && (!before || f < before))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIG, file), "utf8") }));
}

const files = load();
const inventory = jobInventory(files);
const register = workRegister(files);
const commands = jobCommands(files);
const defs = effectiveDefs(MIG);

const isHttp = (cmd: string) => cmd.includes("net.http_post(");
const edgeFnOf = (cmd: string) => /\/functions\/v1\/([a-z0-9-]+)/.exec(cmd)?.[1];
/** The function a recorded command wraps: cron_record_work('job', to_jsonb(public.<fn>())). */
const wrappedFn = (cmd: string, job: string) =>
  new RegExp(String.raw`cron_record_work\(\s*'${job}'\s*,\s*to_jsonb\(\s*public\.(\w+)\(\s*\)\s*\)\s*\)`).exec(cmd)?.[1];
const returnType = (fn: string) =>
  /\)\s*RETURNS\s+(\w+)/i.exec(defs.get(fn)?.stmt ?? "")?.[1]?.toLowerCase();

describe("every scheduled job records its work and says what 'did nothing' means (CJ-007)", () => {
  it("the inventory comes from the migrations (not empty, both halves present)", () => {
    expect(inventory.size).toBeGreaterThan(55);
    expect(inventory.get("sweep-release-last-chance")).toBe("scheduled");
    expect(inventory.get("extend-boosts-hourly")).toBe("monitored-only");
    // Retired jobs stay out: unscheduled and their expectation deleted.
    expect(inventory.has("sweep-pending-broadcast-fan-outs")).toBe(false);
    expect(register.size).toBeGreaterThan(55);
  });

  it("every job has a work_visibility entry, and every entry names a live job", () => {
    const missing = [...inventory.keys()].filter((j) => !register.has(j)).sort();
    const stale = [...register.keys()].filter((j) => !inventory.has(j)).sort();
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });

  it("each entry is well-formed for its kind", () => {
    const candidates = candidateRules(files);
    const bad: string[] = [];
    for (const e of register.values()) {
      if (e.visibility === "candidates") {
        if (!candidates.has(e.jobname)) bad.push(`${e.jobname}: 'candidates' without a standing candidate_key rule`);
      } else if (e.visibility === "idle") {
        if (!e.workKeys?.length || !e.maxIdle) bad.push(`${e.jobname}: 'idle' needs work_keys and max_idle`);
      } else if (e.visibility === "exempt") {
        if ((e.reason ?? "").trim().length < 40) bad.push(`${e.jobname}: 'exempt' needs a reason of 40+ chars`);
      } else {
        bad.push(`${e.jobname}: unknown work_visibility ${String(e.visibility)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("an idle job's work keys are ones its function returns; a log_cron_defect reason is true", () => {
    const bad: string[] = [];
    for (const e of register.values()) {
      const cmd = commands.get(e.jobname)?.command ?? "";
      const fn = wrappedFn(cmd, e.jobname);
      const body = fn ? defs.get(fn)?.stmt ?? "" : "";
      if (e.visibility === "idle") {
        if (!fn) {
          bad.push(`${e.jobname}: idle rules are for recorded SQL jobs; no cron_record_work command found`);
          continue;
        }
        for (const k of e.workKeys ?? []) {
          const ok =
            k === "result"
              ? ["integer", "bigint", "int", "numeric"].includes(returnType(fn) ?? "")
              : new RegExp(`'${k}'\\s*,`).test(body);
          if (!ok) bad.push(`${e.jobname}: work key '${k}' is not something public.${fn}() returns`);
        }
      }
      if (e.visibility === "exempt" && /log_cron_defect/.test(e.reason ?? "")) {
        if (!fn || !/log_cron_defect\s*\(/.test(body))
          bad.push(`${e.jobname}: reason cites log_cron_defect but ${fn ? `public.${fn}()` : "its command"} never calls it`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every scheduled SQL job's newest command records its work", () => {
    const unrecorded: string[] = [];
    let sql = 0;
    for (const [job, kind] of inventory) {
      if (kind !== "scheduled") continue;
      const c = commands.get(job);
      if (!c || isHttp(c.command)) continue;
      sql++;
      const fn = wrappedFn(c.command, job);
      if (!fn) unrecorded.push(`${job} (newest command in ${c.file} discards its result)`);
      else if (!defs.has(fn)) unrecorded.push(`${job}: wraps public.${fn}(), which no migration defines`);
      else if (returnType(fn) === "void") unrecorded.push(`${job}: public.${fn}() returns void, so there is nothing to record`);
    }
    expect(sql).toBeGreaterThan(30);
    expect(unrecorded).toEqual([]);
  });

  it("every HTTP job answers through cronResult with its own name", () => {
    const bad: string[] = [];
    let http = 0;
    for (const [job, kind] of inventory) {
      const c = commands.get(job);
      // 20260831190419's loop builds the URL with format(), so it names no
      // function literally; those jobs are named after their function.
      const fnName = c && isHttp(c.command) ? edgeFnOf(c.command) ?? job : kind === "monitored-only" ? job : undefined;
      if (!fnName || job in LIVE_ONLY_SQL) continue;
      const src = join(FUNCTIONS, fnName, "index.ts");
      if (!existsSync(src)) {
        bad.push(`${job}: no supabase/functions/${fnName}/index.ts`);
        continue;
      }
      http++;
      const text = readFileSync(src, "utf8");
      // The name literally, or through a constant (`const FN = "marketing-publish"`).
      const consts = [...text.matchAll(new RegExp(String.raw`const\s+(\w+)\s*=\s*['"]${fnName}['"]`, "g"))].map((m) => m[1]);
      const names = [`['"]${fnName}['"]`, ...consts.map((c) => String.raw`${c}\b`)];
      if (!names.some((n) => new RegExp(String.raw`cronResult\(\s*${n}`).test(text)))
        bad.push(`${job}: supabase/functions/${fnName} never answers cronResult("${fnName}", ...)`);
    }
    expect(http).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it("LIVE_ONLY_SQL lists exactly the monitored-only jobs that are not edge functions", () => {
    const actual = [...inventory]
      .filter(([job, kind]) => kind === "monitored-only" && !existsSync(join(FUNCTIONS, job, "index.ts")))
      .map(([job]) => job)
      .sort();
    expect(Object.keys(LIVE_ONLY_SQL).sort()).toEqual(actual);
  });

  it("RED: before 20260925231818 every job was unregistered and every SQL job unrecorded", () => {
    const before = load("20260925231818");
    const inv = jobInventory(before);
    const reg = workRegister(before);
    const cmds = jobCommands(before);
    expect([...inv.keys()].filter((j) => !reg.has(j)).length).toBe(inv.size);
    const sqlJobs = [...inv].filter(([j, k]) => k === "scheduled" && cmds.get(j) && !isHttp(cmds.get(j)!.command));
    expect(sqlJobs.length).toBeGreaterThan(30);
    expect(sqlJobs.filter(([j]) => wrappedFn(cmds.get(j)!.command, j))).toEqual([]);
  });
});
