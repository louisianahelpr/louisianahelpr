/**
 * CLASS CHECK — every place that renders a listing's expiry uses the shared
 * formatter, `formatTimeLeft` (src/lib/dateUtils.ts).
 *
 * Owner report (OPEN.md, 2026-09-12): a live listing read "Expired" for its
 * last 59 seconds. Two card families each printed their own "Expired" beside
 * the formatter, and the job detail tile used date-fns' fuzzy
 * `formatDistanceToNow` — three rules for one fact. The formatter now owns the
 * whole answer, "Expired" included, so any second spelling is a defect.
 *
 * Inventory is derived from source: every non-test file under src/ that reads
 * a bare `expires_at` or calls `formatTimeLeft`. Each must contain no
 * `formatDistance*(` call and no hand-written "Expired" literal. Comments are
 * stripped first so prose about the old bug does not trip it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");

/** Files that mention expiry for something that is NOT a job listing. */
const NOT_A_LISTING: Record<string, string> = {
  "lib/dateUtils.ts": "the formatter itself",
  "pages/payItForward/CreditCard.tsx": "gift-card credit expiry date, not a listing countdown",
  "components/admin/AdminBroadcasts.tsx": "admin broadcast expiry badge",
  "integrations/supabase/types.ts": "generated types",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "__tests__" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function expiryRenderViolations(code: string): string[] {
  const body = stripComments(code);
  const hits: string[] = [];
  if (/formatDistance(ToNow|Strict)?\(/.test(body)) hits.push("formatDistance* call");
  if (/["'`>]\s*Expired\s*["'`<]/.test(body)) hits.push('hand-written "Expired"');
  return hits;
}

describe("listing expiry is rendered only through formatTimeLeft", () => {
  const files = walk(ROOT)
    .map((p) => ({ rel: relative(ROOT, p).split("\\").join("/"), code: readFileSync(p, "utf8") }))
    .filter((f) => /(^|[^a-z_])expires_at\b|formatTimeLeft/.test(f.code))
    .filter((f) => !(f.rel in NOT_A_LISTING));

  it("inventory sees the known expiry surfaces", () => {
    const rels = files.map((f) => f.rel);
    for (const known of [
      "components/activity/JobCardMetaRow.tsx",
      "components/dashboard/JobCard.tsx",
      "components/dashboard/jobDetailDialog/JobStatTiles.tsx",
    ]) {
      expect(rels).toContain(known);
    }
  });

  it("no surface spells expiry its own way", () => {
    const bad = files
      .map((f) => ({ file: f.rel, hits: expiryRenderViolations(f.code) }))
      .filter((v) => v.hits.length > 0);
    expect(bad).toEqual([]);
  });

  it("the check can fail (the original bug's shapes)", () => {
    expect(expiryRenderViolations('const t = expired ? "Expired" : formatTimeLeft(e);')).not.toEqual([]);
    expect(expiryRenderViolations("value: formatDistanceToNow(new Date(job.expires_at), { addSuffix: false }),")).not.toEqual([]);
    expect(expiryRenderViolations('// used to print "Expired" here\nconst t = formatTimeLeft(e);')).toEqual([]);
  });
});
