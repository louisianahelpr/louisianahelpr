// @mutate vercel.json | upgrade-insecure-requests; report-uri https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/csp-report; report-to csp-endpoint" | upgrade-insecure-requests"
// @mutate vercel.json | ; report-to csp-endpoint" | "
// @mutate vercel.json | "csp-endpoint=\"https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/csp-report\"" | "csp-endpoint=\"https://o1.ingest.sentry.io/api/1/security/\""
// @mutate supabase/config.toml | [functions.csp-report]\n    verify_jwt = false | [functions.csp-report]\n    verify_jwt = true
/*
 * GUARD (2026-10-05, owner-approved hardening): the live CSP reports its
 * violations to our own csp-report edge function, in both mechanisms.
 *
 * Before this, the Content-Security-Policy header in vercel.json had no
 * report-uri and no report-to (measured on origin/main 3e791549c), so a
 * blocked script on prod left no trace anywhere. The reports go to
 * supabase/functions/csp-report (one error_logs row as anon, origin 'client';
 * src/test/edge/csp-report.test.ts), never Sentry (small quota).
 *
 * Checks, from vercel.json and the function tree:
 *   - the site-wide CSP carries `report-uri <url>` and `report-to <group>`;
 *   - the same header block sets Reporting-Endpoints mapping <group> to the
 *     SAME url (a report-to group with no endpoint sends nothing);
 *   - the url is this project's own functions/v1/<name> (the host the auth
 *     rewrite already uses), <name> exists as a function, and config.toml
 *     gives it verify_jwt = false (browsers send no apikey, so a gated
 *     endpoint would 401 every report).
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
type Header = { key: string; value: string };
type Block = { source: string; headers: Header[] };
const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
  headers: Block[];
  rewrites?: Array<{ source: string; destination: string }>;
};

const cspBlocks = vercel.headers.filter((b) => b.headers.some((h) => h.key === "Content-Security-Policy"));
const siteWide = cspBlocks.find((b) => b.source === "/(.*)");
const csp = siteWide?.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
const directives = new Map(
  csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...rest] = d.split(/\s+/);
    return [name, rest] as const;
  }),
);

const projectHost = (vercel.rewrites ?? [])
  .map((r) => /^https:\/\/([a-z0-9]+\.supabase\.co)\/auth\/v1\//.exec(r.destination)?.[1])
  .find(Boolean);

/** Parse a Reporting-Endpoints value: `name="url", other="url"`. */
function endpoints(value: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of value.matchAll(/([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/g)) out.set(m[1], m[2]);
  return out;
}

describe("the CSP reports violations to our own csp-report function", () => {
  it("reads the real site-wide CSP (floor)", () => {
    expect(siteWide, "no Content-Security-Policy on /(.*) in vercel.json").toBeDefined();
    expect(directives.size).toBeGreaterThan(10);
    expect(projectHost, "the /auth/v1 rewrite names the project host").toBeTruthy();
  });

  const reportUri = directives.get("report-uri") ?? [];
  const reportTo = directives.get("report-to") ?? [];

  it("carries report-uri pointing at this project's csp-report function", () => {
    expect(reportUri).toHaveLength(1);
    expect(reportUri[0]).toBe(`https://${projectHost}/functions/v1/csp-report`);
  });

  it("carries report-to whose group Reporting-Endpoints maps to the same url", () => {
    expect(reportTo).toHaveLength(1);
    const re = siteWide?.headers.find((h) => h.key === "Reporting-Endpoints")?.value ?? "";
    expect(endpoints(re).get(reportTo[0])).toBe(reportUri[0]);
  });

  it("the endpoint is a real, ungated function", () => {
    const name = /\/functions\/v1\/([a-z0-9-]+)$/.exec(reportUri[0] ?? "")?.[1] ?? "";
    expect(existsSync(join(ROOT, "supabase", "functions", name, "index.ts"))).toBe(true);
    const toml = readFileSync(join(ROOT, "supabase", "config.toml"), "utf8");
    const stanza = new RegExp(`^\\s*\\[functions\\.${name}\\]\\s*\\n\\s*verify_jwt\\s*=\\s*false\\s*$`, "m");
    expect(stanza.test(toml), `config.toml must set [functions.${name}] verify_jwt = false`).toBe(true);
  });
});
