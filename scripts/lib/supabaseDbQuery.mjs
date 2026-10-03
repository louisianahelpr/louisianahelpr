/**
 * `supabase db query ...` with a bounded retry on the CLI's TRANSIENT login
 * failures (docs/OPEN.md Q1176).
 *
 * WHY. db-drift-detect went red on 2026-10-03 17:17Z (nightly-red #2205):
 * function-body-drift.mjs's live read got "failed to connect as temp role ...
 * password authentication failed for user cli_login_postgres (SQLSTATE
 * 28P01)". The CLI creates a temporary login role per call and connects
 * through the pooler; when the pooler has not yet seen that role, the login
 * fails. The same job's other live reads passed, the re-run went green and
 * #2205 closed itself: nothing had drifted. A check that pages on a blip is a
 * check people learn to ignore, so every CLI live read goes through here.
 *
 * Only the signatures below are retried (3 tries, 5 s apart). Anything else
 * (bad SQL, a real permission error, a missing link) throws at once, unchanged,
 * so a broken check still fails the run. stderr is piped to read the error and
 * written through after the final attempt, so the run log keeps it.
 *
 * Guard: src/test/liveQueriesRetryTransientLogin.test.ts (no script calls the
 * CLI's `db query` except through this module; the retry rules).
 */
import { execFileSync } from "node:child_process";

/** Failures that say nothing about the query: the temp-role login or the link dropped. */
export const TRANSIENT = [
  /failed to connect as temp role/i,
  /password authentication failed for user "cli_login_/i,
  /SQLSTATE 28P01\).*cli_login/i,
  /connection reset by peer/i,
  /i\/o timeout/i,
  /server closed the connection unexpectedly/i,
];

export const isTransient = (text) => TRANSIENT.some((re) => re.test(String(text ?? "")));

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `supabase db query <args>` and return its stdout (a string with
 * `encoding: "utf8"`), retrying only a transient login/connection failure.
 * `opts` are execFileSync options; stdio is always piped.
 */
export function supabaseDbQuery(args, opts = {}, { globalArgs = [], tries = 3, waitMs = 5000, run = execFileSync, sleep = sleepSync, log = (m) => process.stderr.write(m) } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return run("supabase", [...globalArgs, "db", "query", ...args], { encoding: "utf8", ...opts, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      const text = `${e?.stderr ?? ""}\n${e?.stdout ?? ""}\n${e?.message ?? ""}`;
      if (attempt < tries && isTransient(text)) {
        log(`supabase db query: transient connect failure (attempt ${attempt} of ${tries}); retrying in ${waitMs / 1000}s\n`);
        sleep(waitMs);
        continue;
      }
      if (e?.stderr) log(String(e.stderr));
      throw e;
    }
  }
}
