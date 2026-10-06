/**
 * CLASS GUARD (nightly-red #2436, e2e-journeys 37460190561): no e2e harness
 * backdates a job's created_at with a user's token.
 *
 * Q1189 made jobs.created_at server-owned (enforce_poster_jobs_money_lock's
 * locked_always), so the poster-token PATCH every harness used to age a job
 * past the early-access window answers 42501 "Posters may not modify
 * jobs.created_at". Three money-outcome journeys went red on it the next
 * night; four more sites carried the same PATCH behind a funding step that
 * live-mode Stripe currently skips, so they would go red the day funding
 * works again. The one way is e2e/ageJobPastEarlyAccess.ts (service role,
 * is_seed only, node fetch).
 *
 * Built from the e2e tree itself: every `.patch(` call and every
 * `fetch(` with method PATCH whose argument names /rest/v1/jobs and
 * created_at is a violation, except inside the helper.
 */
// @mutate e2e/journeys/04-money-outcomes.spec.ts | await ageJobPastEarlyAccess(SUPABASE_URL, job.id, `the ${label} job`); | await api.patch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${job.id}&select=id`, { headers: rest(poster), data: { created_at: new Date().toISOString() } });
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const HELPER = "e2e/ageJobPastEarlyAccess.ts";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

const FILES = [...walk(join(ROOT, "e2e")), ...walk(join(ROOT, "scripts/e2e"))].map((f) => relative(ROOT, f)).sort();

/** The text of a call from its opening paren to the balanced close (bounded). */
function callText(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length && i < open + 2000; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open, open + 2000);
}

/** Violations in one file's code (comments already blanked), as line numbers. */
export function violationsIn(code: string): number[] {
  const calls = [
    ...[...code.matchAll(/\.patch\s*\(/g)].map((m) => ({ at: m.index! + m[0].length - 1, patch: true })),
    ...[...code.matchAll(/\bfetch\s*\(/g)].map((m) => ({ at: m.index! + m[0].length - 1, patch: false })),
  ];
  const out: number[] = [];
  for (const { at, patch } of calls) {
    const call = callText(code, at);
    if (!patch && !/method\s*:\s*["'`]PATCH["'`]/.test(call)) continue;
    if (/\/rest\/v1\/jobs\b/.test(call) && /\bcreated_at\b/.test(call)) out.push(code.slice(0, at).split("\n").length);
  }
  return out;
}

export function createdAtPatches(files = FILES): string[] {
  return files
    .filter((f) => f !== HELPER)
    .flatMap((f) => violationsIn(blankComments(readFileSync(join(ROOT, f), "utf8"))).map((line) => `${f}:${line}`));
}

describe("e2e harnesses age jobs as the service role, through one helper (#2436)", () => {
  it("scans a real e2e tree", () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it("detects both shapes of the old poster-token PATCH, and not a read", () => {
    const pw = "await api.patch(`${U}/rest/v1/jobs?id=eq.${id}&select=id`, {\n headers: rest(poster),\n data: { created_at: new Date().toISOString() },\n});";
    const nodeFetch = 'await fetch(`${U}/rest/v1/jobs?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ created_at: x }) });';
    const read = "await fetch(`${U}/rest/v1/jobs?select=id,created_at`, { headers });";
    expect(violationsIn(pw)).toEqual([1]);
    expect(violationsIn(nodeFetch)).toEqual([1]);
    expect(violationsIn(read)).toEqual([]);
  });

  it("no harness PATCHes jobs.created_at itself", () => {
    expect(createdAtPatches(), "age the job with ageJobPastEarlyAccess (e2e/ageJobPastEarlyAccess.ts): created_at is server-owned since Q1189").toEqual([]);
  });

  it("the helper is the one in use, and touches only is_seed rows as the service role", () => {
    const sites = FILES.filter((f) => f !== HELPER).filter((f) => /ageJobPastEarlyAccess\s*\(/.test(blankComments(readFileSync(join(ROOT, f), "utf8"))));
    expect(sites.length).toBeGreaterThanOrEqual(5);
    const helper = blankComments(readFileSync(join(ROOT, HELPER), "utf8"));
    expect(helper).toMatch(/is_seed=eq\.true/);
    expect(helper).toMatch(/resolveServiceKey\(\)/);
  });
});
