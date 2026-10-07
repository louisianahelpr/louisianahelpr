/**
 * Q1421: nothing secret goes into a Playwright trace.
 *
 * A Playwright APIRequestContext (and every page/context) is traced, CI uploads
 * trace.zip on failure, and the repo is PUBLIC: a trace copies request headers
 * and bodies verbatim (lh-authz-rls review 2026-10-06 found user JWTs and a
 * password-grant body in a journeys artifact). Two rules, both read from source:
 *
 *  1. A service-role header never rides a Playwright request method
 *     (`x.get/post/put/patch/delete/head/fetch(...)`): it leaves through node's
 *     fetch (e2e/serviceRoleFetch.ts srFetch, scripts/lib/adminSession.mjs).
 *  2. A spec that types a password from the environment into a form turns its
 *     trace off (`test.use({ trace: "off" })`).
 *
 * @mutate e2e/journeys/throwaway.ts | await ok(await srFetch(key, "GET", `${SUPABASE_URL}/auth/v1/admin/users/${userId}`), `read auth user ${userId}`); | await ok(await api.get(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: sr(key) }), `read auth user ${userId}`);
 * @mutate e2e/prod-audit/harness.ts |     const r = await srFetch(svc, "DELETE", `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`); |     const r = await _a.delete(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { headers: { apikey: svc, Authorization: `Bearer ${svc}` } });
 * @mutate e2e/auth.spec.ts | test.use({ trace: "off" }); | test.use({});
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(__dirname, "../..");
/** Every .ts under e2e/ (node_modules and generated output excluded), repo-relative. */
function walkE2e(dir = join(ROOT, "e2e")): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkE2e(p));
    else if (/\.(ts|mts)$/.test(e.name)) out.push(relative(ROOT, p));
  }
  return out;
}
const E2E_FILES = walkE2e();
const PLAYWRIGHT_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "fetch"]);
/** How a service-role header is spelled in e2e/ (a helper call, or the key in apikey / Bearer). */
const SERVICE_HEADER =
  /\bsr\(|\bserviceHeaders\(|\bSR\b|Bearer \$\{\s*(svc|svcKey|key|serviceKey|SERVICE_KEY|svc\.key)\b|\bapikey:\s*(svc|svcKey|key|serviceKey|SERVICE_KEY|svc\.key)\b/;

/** Every `<receiver>.<method>(...)` call whose arguments carry a service-role header. */
export function tracedServiceCalls(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      const receiver = node.expression.expression.getText(sf);
      if (PLAYWRIGHT_METHODS.has(name) && receiver !== "globalThis") {
        const args = node.arguments.map((a) => a.getText(sf)).join(", ");
        if (SERVICE_HEADER.test(args)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          out.push(`${file}:${line + 1} ${receiver}.${name}(...) sends a service-role header through a traced Playwright request`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** A spec that fills a password field from the environment / credentials, not a literal. */
const TYPES_REAL_PASSWORD = /\.locator\(\s*["']#password["']\s*\)\.fill\(\s*(?!["'`])/;
const TRACE_OFF = /\btest\.use\(\s*\{\s*trace:\s*["']off["']\s*\}\s*\)/;

describe("Q1421: no secret reaches a Playwright trace", () => {
  it("reads a real inventory (floor)", () => {
    expect(E2E_FILES.length).toBeGreaterThan(100); // 140 on 2026-10-07
    const keyUsers = E2E_FILES.filter((f) => /SUPABASE_SERVICE_ROLE_KEY|serviceKey|srFetch/.test(readFileSync(join(ROOT, f), "utf8")));
    expect(keyUsers.length).toBeGreaterThanOrEqual(6);
  });

  it("no e2e file sends a service-role header through a Playwright request method", () => {
    const offenders = E2E_FILES.flatMap((f) => tracedServiceCalls(f, readFileSync(join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the detector fires on the shapes that leaked (synthetic)", () => {
    expect(tracedServiceCalls("x.ts", "await api.get(u, { headers: sr(key) });")).toHaveLength(1);
    expect(tracedServiceCalls("x.ts", "await request.fetch(u, { method: 'POST', headers: { ...SR } });")).toHaveLength(1);
    expect(tracedServiceCalls("x.ts", "await a.delete(u, { headers: { apikey: svc, Authorization: `Bearer ${svc}` } });")).toHaveLength(1);
    expect(tracedServiceCalls("x.ts", "await srFetch(key, 'GET', u);")).toEqual([]);
    expect(tracedServiceCalls("x.ts", "await fetch(u, { headers: sr(key) });")).toEqual([]);
  });

  it("every spec that types a real password into a form turns its trace off", () => {
    const typers = E2E_FILES.filter((f) => TYPES_REAL_PASSWORD.test(readFileSync(join(ROOT, f), "utf8")));
    expect(typers.length).toBeGreaterThanOrEqual(3);
    const traced = typers.filter((f) => !TRACE_OFF.test(readFileSync(join(ROOT, f), "utf8")));
    expect(traced).toEqual([]);
  });
});
