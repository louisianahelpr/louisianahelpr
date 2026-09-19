import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * `Prefer: return=representation` with no `select=` is `RETURNING *`, and this
 * project has tables the client role cannot read `*` from.
 *
 * 2026-09-19, nightly-red #1582 (press-every-control): every teardown logged
 *
 *     customer job <id> "[PRESS DO NOT ACCEPT] …" [cancelled/unpaid]
 *       → delete matched 0 rows (HTTP 403); poster_cancel_job HTTP 400
 *
 * `del()` in scripts/audit/pressProdSafety.mjs sent the DELETE with
 * `Prefer: return=representation` and no `select`, so PostgREST emitted
 * `RETURNING "public"."jobs".*`. Verified live on prod the same day:
 *
 *     has_table_privilege('authenticated','public.jobs','SELECT')  → false
 *     column SELECT grants for authenticated on jobs               → 109 of 110
 *     the one withheld column                                      → offered_to_helper_id
 *
 * so `*` raises 42501 and PostgREST answers 403 — the DELETE never ran. 26
 * fixture jobs accumulated on prod, one per shard per night, and the failure
 * was reported as a *cancellation* problem rather than a permission one.
 *
 * The same file already documents and works around this for its INSERT
 * (createPressJob), which is what makes it a CLASS, not an incident: the
 * table-level grant was revoked in 20260915045110, and the next table to lose
 * a column grant will break every representation request that asks for `*`.
 *
 * So: every write request in our tool scripts and e2e harnesses that asks for
 * a representation must name the columns it wants. `select=id` is enough — the
 * point of the representation here is the returned ROW COUNT, which is how a
 * zero-row write is told apart from a successful one (CLAUDE.md: "a null error
 * is not a write").
 *
 * Scope: .mjs/.ts under scripts/ and e2e/ — the harnesses that talk to prod
 * over raw REST. The app itself goes through supabase-js, which always sends
 * an explicit select.
 */

const ROOT = resolve(__dirname, "../..");
const DIRS = ["scripts", "e2e"];

/** Source files that could issue a raw PostgREST write. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(mjs|ts)$/.test(p)) out.push(p);
  }
  return out;
}

const WINDOW = 8;

/**
 * A GENERIC FORWARDER is the shape that bites: a helper that attaches
 * `return=representation` to a path its CALLER supplies — `/rest/v1/${path}`,
 * `/rest/v1/${table}?${q}`. It cannot see which table it is writing to, so it
 * cannot know whether `RETURNING *` is readable, and every caller that forgets
 * `select=` inherits a 403 that looks like a policy rejection.
 *
 * A request with a LITERAL table in its URL (`/rest/v1/messages`) is not
 * flagged: whoever wrote it could check that table's grants, and several of
 * those deliberately read the whole returned row back.
 *
 * Per site, not per file: pressProdSafety.mjs had `profiles?select=*` a dozen
 * lines above the `RETURNING *` delete, so a file-wide grep called it clean.
 */
export function forwarderSites(src: string): Array<{ line: number; context: string }> {
  const lines = src.split("\n");
  const sites: Array<{ line: number; context: string }> = [];
  lines.forEach((l, i) => {
    if (!l.includes("return=representation")) return;
    const context = lines.slice(Math.max(0, i - WINDOW), i + WINDOW + 1).join("\n");
    // `/rest/v1/` immediately followed by an interpolation = caller-supplied path.
    if (!/\/rest\/v1\/\$\{/.test(context)) return;
    sites.push({ line: i + 1, context });
  });
  return sites;
}

/**
 * Does the forwarder name (or derive) the columns it asks back?
 *
 * COMMENTS ARE STRIPPED FIRST. The doc comment explaining this very bug sits
 * directly above the code it explains and mentions `select=id`, so a naive
 * grep read the explanation as the fix: `npm run vacuity` broke the derivation
 * in pressProdSafety.mjs and this guard stayed green. A check that a comment
 * can satisfy is not a check.
 */
export function namesItsColumns(context: string): boolean {
  const code = context
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n")
    // REGEX LITERALS TOO. `/[?&]select=/.test(path)` only ASKS whether the
    // caller already named columns; on its own it adds nothing to the URL.
    // Vacuity broke the append in pressProdSafety.mjs and this guard still
    // saw "select=" — in the test that guards the append. Only a `select=`
    // that ends up in a string the URL is built from counts.
    .replace(/\/[^/\n]*select=[^/\n]*\//g, "");
  return /select=/.test(code);
}

// @mutate scripts/audit/pressProdSafety.mjs | `${pathAndQuery}${pathAndQuery.includes("?") ? "&" : "?"}select=id` | pathAndQuery
// @mutate scripts/e2e/prod-audit-sweeper.mjs | export const PRESS_TITLE_MARKER = "PRESS DO NOT ACCEPT"; | export const PRESS_TITLE_MARKER = "NOTHING MATCHES THIS";

describe("raw PostgREST writes that ask for a representation name their columns", () => {
  const files = DIRS.flatMap((d) => sourceFiles(join(ROOT, d)));

  it("the inventory is non-empty (this guard is not vacuous)", () => {
    expect(files.length, "no scripts/ or e2e/ sources found").toBeGreaterThan(50);
    const sites = files.flatMap((f) => forwarderSites(readFileSync(f, "utf8")));
    expect(
      sites.length,
      "no generic REST forwarder asks for return=representation any more — re-point or delete this guard",
    ).toBeGreaterThan(1);
  });

  it("no generic forwarder asks for RETURNING * on a caller-supplied path", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const site of forwarderSites(readFileSync(f, "utf8"))) {
        if (namesItsColumns(site.context)) continue;
        offenders.push(`${relative(ROOT, f)}:${site.line}`);
      }
    }
    expect(
      offenders,
      "`Prefer: return=representation` with no `select=` is RETURNING *. `authenticated` has no " +
        "table-level SELECT on public.jobs (only 109 of 110 columns — offered_to_helper_id is withheld, " +
        "20260915045110), so `*` raises 42501 and the whole write comes back 403 without running. " +
        "That silently leaked 26 fixture jobs onto prod (press-every-control #1582). " +
        "Name the columns — `select=id` is enough to keep the row count:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the press fixture marker the service-role sweeper hunts is the one the harness writes", () => {
    // The sweeper is the ONLY path that can remove a cancelled press job
    // (`cancelled` is terminal in enforce_job_status_transition, and the poster
    // DELETE policy requires status='open'). If the two markers drift, the
    // sweeper matches nothing and the leak comes straight back — exactly how
    // the prod-audit sweeper's bracketed-marker bug went uncaught.
    const harness = readFileSync(join(ROOT, "scripts/audit/pressProdSafety.mjs"), "utf8");
    const sweeper = readFileSync(join(ROOT, "scripts/e2e/prod-audit-sweeper.mjs"), "utf8");
    const written = harness.match(/export const PRESS_MARKER = "([^"]+)"/)?.[1];
    const hunted = sweeper.match(/export const PRESS_TITLE_MARKER = "([^"]+)"/)?.[1];
    expect(written, "scripts/audit/pressProdSafety.mjs no longer exports PRESS_MARKER").toBeTruthy();
    expect(hunted, "scripts/e2e/prod-audit-sweeper.mjs no longer exports PRESS_TITLE_MARKER").toBeTruthy();
    expect(
      written!.includes(hunted!),
      `the sweeper hunts "${hunted}" but the harness titles its jobs "${written}" — the sweeper would match nothing`,
    ).toBe(true);
    // And the workflow must actually run it, or the marker agreeing proves nothing.
    const wf = readFileSync(join(ROOT, ".github/workflows/press-every-control.yml"), "utf8");
    expect(wf, "press-every-control.yml does not run the service-role sweeper").toContain("scripts/e2e/prod-audit-sweeper.mjs");
  });
});
