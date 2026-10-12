/**
 * Q1352 — nobody saw Content-Security-Policy violations.
 *
 * csp-report (supabase/functions/csp-report) stores one public.error_logs row
 * per browser report, tags.source = 'csp' (report.ts toErrorLogRow). The daily
 * digest showed a source only as one "latest message" line, and only while it
 * was in the top 15 sources; prod-errors-check ignores it. Measured 2026-10-12:
 * 115 rows since 2026-10-05 (all script-src-elem blocking vercel.live's
 * feedback.js), never read. 20261012071234 makes send_ops_daily_digest() lead
 * with a CSP line counted by directive and blocked host.
 *
 * This pins the NEWEST definition (effectiveDefs replays every migration) and
 * that csp-report still writes the source and tags the digest reads.
 * Behaviour: src/test/pglite/opsDigestCountsCsp.pglite.mjs (4 FAIL with
 * NEW_MIGRATION=skip on prod's 20260914183932 body; ALL PASS applied 3x).
 */
// @mutate supabase/migrations/20261012071234_ops_digest_counts_csp_violations.sql |     ELSE v_csp_line \|\| left(v_lines, 2700 - length(v_csp_line)) |     ELSE left(v_lines, 2700)
// @mutate supabase/migrations/20261012071234_ops_digest_counts_csp_violations.sql |                      AND e.tags ->> 'source' = 'csp' |                      AND e.tags ->> 'source' = 'cspx'
// @mutate supabase/migrations/20261012071234_ops_digest_counts_csp_violations.sql |                    GROUP BY 1, 2) g) c; |                    GROUP BY 1) g) c;
// @mutate supabase/migrations/20261012071234_ops_digest_counts_csp_violations.sql | '[[:cntrl:]]', ' ', 'g'), 40) AS directive, | '[[:cntrl:]]x', ' ', 'g'), 40) AS directive,
// @mutate supabase/functions/csp-report/report.ts | tags: { source: "csp", directive, blocked, | tags: { source: "csp-report", directive, blocked,
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase/migrations");
const defs = effectiveDefs(MIG);
const body = blankSqlComments(defs.get("send_ops_daily_digest")?.stmt ?? "").replace(/\s+/g, " ");
const report = blankComments(readFileSync(join(process.cwd(), "supabase/functions/csp-report/report.ts"), "utf8"));

describe("Q1352: the daily digest counts CSP violations by directive and blocked host", () => {
  it("the newest definition is found", () => {
    expect(defs.size).toBeGreaterThan(500);
    expect(body).toMatch(/SECURITY DEFINER/);
    expect(body).toMatch(/'kind', 'digest'/);
  });

  it("counts the last 24h of source='csp' rows, grouped by directive and host", () => {
    expect(body).toMatch(/e\.tags ->> 'source' = 'csp' GROUP BY 1, 2\) g\) c;/);
    expect(body).toMatch(/e\.tags ->> 'directive'/);
    // anon can INSERT error_logs directly: a newline in a tag must not forge a digest line.
    expect(body).toMatch(/'\[\[:cntrl:\]\]', ' ', 'g'\), 40\) AS directive/);
    expect(body).toMatch(/'\[\[:cntrl:\]\]', ' ', 'g'\), 60\) AS host/);
    expect(body).toMatch(/split_part\(split_part\(e\.tags ->> 'blocked', ':\/\/', 2\), '\/', 1\)/);
    expect(body).toMatch(/WHERE e\.created_at > now\(\) - interval '24 hours' AND jsonb_typeof\(e\.tags\) = 'object' AND e\.tags ->> 'source' = 'csp'/);
  });

  it("the CSP line leads the message, so the 2700-char cut and the top-15 cut never drop it", () => {
    expect(body).toMatch(/ELSE v_csp_line \|\| left\(v_lines, 2700 - length\(v_csp_line\)\)/);
    expect(body).toMatch(/'csp', COALESCE\(v_csp, 0\)/);
  });

  it("csp-report still writes the source and the tags the digest reads", () => {
    expect(report).toMatch(/tags: \{ source: "csp", directive, blocked,/);
  });
});
