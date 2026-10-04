/*
 * GUARD (docs/OPEN.md Q1176): a live read does not fail the whole check on the
 * CLI's transient login failure.
 *
 * db-drift-detect went red 2026-10-03 17:17Z (nightly-red #2205):
 * function-body-drift.mjs's `supabase db query --linked` got "failed to connect
 * as temp role ... password authentication failed for user cli_login_postgres
 * (SQLSTATE 28P01)"; the re-run went green with nothing drifted. Every CLI live
 * read now goes through scripts/lib/supabaseDbQuery.mjs, which retries only
 * that class of failure. Red first: ten scripts called the CLI directly.
 */
// @mutate scripts/lib/supabaseDbQuery.mjs |       if (attempt < tries && isTransient(text)) { |       if (false) {
// @mutate scripts/lib/supabaseDbQuery.mjs |   /failed to connect as temp role/i, |   /never-matches-anything-q1176/i,
// @mutate scripts/audit/function-body-drift.mjs |   const raw = supabaseDbQuery(["--linked", "-o", "json", LIVE_SQL], { |   const raw = execFileSync("supabase", ["db", "query", "--linked", "-o", "json", LIVE_SQL], {
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error — plain .mjs module, no declaration file
import { supabaseDbQuery, isTransient } from "../../scripts/lib/supabaseDbQuery.mjs";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = join(__dirname, "..", "..");
const LOGIN_FAIL = 'failed to connect as temp role: failed to connect to postgres: server error (FATAL: password authentication failed for user "cli_login_postgres" (SQLSTATE 28P01))';

function runner(failures: Array<string | null>) {
  const calls: string[][] = [];
  const run = (_bin: string, argv: string[]) => {
    calls.push(argv);
    const f = failures[calls.length - 1];
    if (f) throw Object.assign(new Error("Command failed"), { stderr: f });
    return '{"rows":[]}';
  };
  return { run, calls };
}
const quiet = { waitMs: 0, sleep: () => undefined, log: () => undefined };

describe("live reads retry the CLI's transient login failure, and only that (Q1176)", () => {
  it("no script runs `supabase db query` except through supabaseDbQuery", () => {
    const files = (readdirSync(join(ROOT, "scripts"), { recursive: true }) as string[])
      .filter((f) => /\.(mjs|js|cjs|ts)$/.test(f))
      .map((f) => join(ROOT, "scripts", f));
    expect(files.length).toBeGreaterThan(100);
    const direct = files
      .filter((f) => !f.endsWith(join("lib", "supabaseDbQuery.mjs")))
      .filter((f) => /["']db["']\s*,\s*["']query["']|\bdb query --linked\b/.test(blankComments(readFileSync(f, "utf8"))))
      .map((f) => relative(ROOT, f));
    expect(direct).toEqual([]);
  });

  it("the 28P01 temp-role login of 2026-10-03 is transient; a real SQL error is not", () => {
    expect(isTransient(LOGIN_FAIL)).toBe(true);
    // each signature on its own, so no pattern rides on another's match
    expect(isTransient("failed to connect as temp role: context deadline exceeded")).toBe(true);
    expect(isTransient('FATAL: password authentication failed for user "cli_login_postgres"')).toBe(true);
    expect(isTransient("read tcp 10.0.0.1:5432: connection reset by peer")).toBe(true);
    expect(isTransient("dial tcp: i/o timeout")).toBe(true);
    expect(isTransient("server closed the connection unexpectedly")).toBe(true);
    expect(isTransient('ERROR: relation "public.nope" does not exist (SQLSTATE 42P01)')).toBe(false);
    expect(isTransient("permission denied for table jobs")).toBe(false);
  });

  it("one transient failure, then success: the result comes back after one retry", () => {
    const { run, calls } = runner([LOGIN_FAIL, null]);
    expect(supabaseDbQuery(["--linked", "-o", "json", "select 1"], {}, { ...quiet, run })).toBe('{"rows":[]}');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(["db", "query", "--linked", "-o", "json", "select 1"]);
  });

  it("a real error throws at once, unretried", () => {
    const { run, calls } = runner(['ERROR: syntax error at or near "selec" (SQLSTATE 42601)']);
    expect(() => supabaseDbQuery(["--linked", "-o", "json", "selec 1"], {}, { ...quiet, run })).toThrow();
    expect(calls).toHaveLength(1);
  });

  it("a login that keeps failing still fails the run, after three tries", () => {
    const { run, calls } = runner([LOGIN_FAIL, LOGIN_FAIL, LOGIN_FAIL]);
    expect(() => supabaseDbQuery(["--linked"], {}, { ...quiet, run })).toThrow();
    expect(calls).toHaveLength(3);
  });

  it("global flags (--workdir) go before the subcommand", () => {
    const { run, calls } = runner([null]);
    supabaseDbQuery(["--linked"], {}, { ...quiet, run, globalArgs: ["--workdir", "/x"] });
    expect(calls[0]).toEqual(["--workdir", "/x", "db", "query", "--linked"]);
  });
});
