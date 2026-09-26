/*
 * Q28 (2026-09-26): a guard that cuts a function body out of a migration with
 * ONE hard-coded dollar-quote tag reads the wrong thing the day a migration
 * uses another tag. cronFailureAlertDoesNotDependOnCron parsed only `$fn$`,
 * silently read the PREVIOUS definition when 20260923050055 used `$function$`,
 * and stayed green on a revert of the Q33 fix; raceClassGuard's
 * latestDefinition() matched only `$$` / `$function$` until Q28 moved it to
 * the shared parser. Prod's corpus mixes $function$, $$, $fn$ and $body$.
 *
 * The shared parser is src/test/helpers/effectiveFunctionDefs.ts (parseDefs /
 * effectiveDefs: any tag, CREATE with or without OR REPLACE, later regexp
 * rewrites replayed, `before:` for pre-fix baselines). New migration-reading
 * guards use it. The files below predate it; each delimits a body it has just
 * located in ONE named migration and fails closed (expect(match).toBeTruthy())
 * when its tag is not there, so none can read a stale body silently. The list
 * is exact and two-way: it may only shrink, and a fixed entry must leave it.
 */
// @mutate src/test/jobsGuardRpcParity.test.ts | rest.match(/\$function\$([\s\S]*?)\$function\$/) | rest.match(/AS\s+(\$\w*\$)([\s\S]*?)\1/)
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const TEST_DIR = resolve(__dirname);

// A regex (literal or RegExp string) capturing a body between one fixed tag:
// \$function\$([\s\S]…, \$fn\$([\s\S]…, \$(function)?\$([\s\S]…, \$\$([\s\S]…
const FIXED_TAG_BODY = /\\{1,2}\$(?:\w*|\(function\)\?)\\{1,2}\$\s*\(\[\\{1,2}s\\{1,2}S\]/;

// @two-way src/test/migrationBodiesUseSharedParser.test.ts:stale legacy fixed-tag entry
const LEGACY_FIXED_TAG: Record<string, string> = {
  "src/test/advancedAnalyticsTierParity.test.ts": "reads the newest *_helper_advanced_analytics.sql; fails closed on another tag",
  "src/test/disputeClosedWithoutPaymentIsWatched.test.ts": "reads the sweep's newest definition; fails closed ('must be delimited by $fn$')",
  "src/test/jobsGuardRpcParity.test.ts": "rpc_withdraw_dispute body; fails closed ('could not delimit')",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== "fixtures" && e !== "helpers" && e !== "node_modules") out.push(...walk(p));
    } else if (/\.(test|spec)\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

function offenders(): string[] {
  return walk(TEST_DIR)
    .filter((f) => !f.endsWith("migrationBodiesUseSharedParser.test.ts"))
    .filter((f) => FIXED_TAG_BODY.test(blankComments(readFileSync(f, "utf8"))))
    .map((f) => relative(REPO, f))
    .sort();
}

describe("migration bodies are read with the shared any-tag parser (Q28)", () => {
  it("only the listed legacy guards delimit a body with one fixed dollar tag (exact, two-way)", () => {
    const found = offenders();
    const stale = Object.keys(LEGACY_FIXED_TAG).filter((f) => !found.includes(f));
    expect(stale, "stale legacy fixed-tag entry: it now uses the shared parser, remove it from LEGACY_FIXED_TAG").toEqual([]);
    expect(found).toEqual(Object.keys(LEGACY_FIXED_TAG).sort());
  });

  it("the detector sees every tag shape it claims to (floor)", () => {
    for (const shape of [
      String.raw`/\$function\$([\s\S]*?)\$function\$/`,
      String.raw`/AS \$fn\$([\s\S]*?)\$fn\$;/`,
      String.raw`"\\$(function)?\\$([\\s\\S]*?)"`,
      String.raw`/\$\$([\s\S]*?)\$\$/`,
    ]) expect(FIXED_TAG_BODY.test(shape), shape).toBe(true);
    expect(walk(TEST_DIR).length).toBeGreaterThan(500);
  });

  it("raceClassGuard reads bodies through effectiveDefs, not its own regex", () => {
    const src = blankComments(readFileSync(join(TEST_DIR, "raceClassGuard.test.ts"), "utf8"));
    expect(src).toMatch(/effectiveDefs\(MIGRATIONS_DIR/);
    expect(FIXED_TAG_BODY.test(src)).toBe(false);
  });
});
