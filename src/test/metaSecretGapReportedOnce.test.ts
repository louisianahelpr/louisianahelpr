/**
 * A missing Meta secret is ONE owner to-do, reported once, not a critical page.
 *
 * 2026-09-24 07:38Z: marketing-token-health paged #ops-alerts CRITICAL "Meta
 * token health check could not run" and answered 500 (ops ledger e1912d2c,
 * 2718d15a) because META_PAGE_ACCESS_TOKEN is not set while auto-publish is on
 * (a presser flipped it, docs/OPEN.md MORNING QUESTIONS 8). marketing-publish
 * already reports that exact gap as an owner action: one warning, once a day,
 * HTTP 200 (metaSecretGapAlert). The same missing secret must not come back as
 * a second, critical alert from the health check.
 *
 * CLASS, from the tree: every supabase/functions/marketing-* entry point that
 * reads the Meta env must not page (postSlackOpsAlert) or record a defect in
 * the branch that handles an UNSET page token.
 *
 * @mutate supabase/functions/marketing-token-health/index.ts | if (!env.pageAccessToken) {\n      // Not configured. With | if (!env.pageAccessToken && autoPublishEnabled !== true) {\n      // Not configured. With
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const FNS = join(process.cwd(), "supabase", "functions");
const entries = readdirSync(FNS)
  .filter((d) => d.startsWith("marketing-") && existsSync(join(FNS, d, "index.ts")))
  .map((d) => ({ name: d, src: blankComments(readFileSync(join(FNS, d, "index.ts"), "utf8")) }))
  .filter(({ src }) => /readMetaEnv\(/.test(src));

/**
 * The ALERT DECISION's unset-token branch: the `if (!env.pageAccessToken…)`
 * chained directly into `else if (tokenError)`. (An earlier
 * `if (!env.pageAccessToken)` only reads the token and decides nothing.)
 */
function unsetTokenDecision(src: string): { cond: string; body: string } | null {
  const elseAt = src.search(/\}\s*else\s+if\s*\(\s*tokenError\s*\)/);
  if (elseAt < 0) return null;
  const head = [...src.slice(0, elseAt).matchAll(/if\s*\(\s*(!env\.pageAccessToken\b[^)]*)\)\s*\{/g)].pop();
  if (!head || head.index === undefined) return null;
  return { cond: head[1].trim(), body: src.slice(head.index, elseAt + 1) };
}

describe("a missing Meta secret is reported once, as an owner action", () => {
  it("found the Meta-reading marketing functions", () => {
    expect(entries.map((e) => e.name)).toContain("marketing-token-health");
    expect(entries.length).toBeGreaterThan(0);
  });

  it("marketing-token-health's unset-token decision covers auto-publish ON too, and never pages", () => {
    const e = entries.find((x) => x.name === "marketing-token-health")!;
    const d = unsetTokenDecision(e.src);
    expect(d).not.toBeNull();
    // Unconditional on auto-publish: ON without a token is marketing-publish's owner to-do.
    expect(d!.cond).toBe("!env.pageAccessToken");
    expect(d!.body).not.toMatch(/postSlackOpsAlert\(|defects\.record\(/);
  });

  it("no Meta-reading marketing function pages or records a defect for an unset token", () => {
    const bad = entries
      .map((e) => ({ e, d: unsetTokenDecision(e.src) }))
      .filter(({ d }) => d && /postSlackOpsAlert\(|defects\.record\(/.test(d.body))
      .map(({ e }) => e.name);
    expect(bad).toEqual([]);
  });
});
