/**
 * Q1252 — no push registration is skipped silently.
 *
 * push_tokens' CHECK admitted 'web', the client could insert such a row, and
 * send-push-notification skipped it without counting it (it handles 'ios'
 * and 'android' only). 20261004191820 drops 'web' from the CHECK and the
 * sender counts any other platform under result.other. The class, three ways:
 *   1. Every platform the newest CHECK admits has its own branch in the sender.
 *   2. The sender counts whatever is left (result.other), so a future CHECK
 *      change cannot reopen a silent skip.
 *   3. Every platform the app registers is one the CHECK admits.
 * Behaviour, red then green: src/test/pglite/pushTokensNoWeb.pglite.mjs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "../helpers/trackedFiles";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "../helpers/blankNonCode";

const ROOT = join(__dirname, "../../..");
const MIG = join(ROOT, "supabase/migrations");

/** The CHECK text push_tokens' platform carries after the migrations up to `before` (exclusive). */
function checkText(before = "99999999999999"): string {
  let last = "";
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
    // The inline column CHECK, only inside push_tokens' own CREATE TABLE.
    for (const t of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?push_tokens\s*\(([\s\S]*?)\n\);/gi)) {
      const m = /platform\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*platform\s+IN\s*\(([^)]*)\)/i.exec(t[1]);
      if (m) last = m[1];
    }
    // A named re-add of the constraint.
    for (const m of sql.matchAll(/add\s+constraint\s+push_tokens_platform_check\s+check\s*\(([^;]*?)\)\s*(?:not\s+valid)?\s*;/gi)) last = m[1];
  }
  return last;
}
const checkPlatforms = (before?: string) => [...checkText(before).matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();

describe("Q1252: every push registration is sent or counted", () => {
  const sender = blankComments(readFileSync(join(ROOT, "supabase/functions/send-push-notification/index.ts"), "utf8"));
  const platforms = checkPlatforms();

  it("the CHECK admits exactly ios and android (web dropped)", () => {
    expect(platforms).toEqual(["android", "ios"]);
  });

  it.each(platforms)("the sender has a branch for '%s'", (p) => {
    expect(sender).toContain(`t.platform === '${p}'`);
  });

  it("the sender counts every other platform instead of dropping it", () => {
    expect(sender).toMatch(/const otherTokens = tokens\.filter\(\(t\) => t\.platform !== 'ios' && t\.platform !== 'android'\)/);
    expect(sender).toMatch(/if \(otherTokens\.length > 0\) \{\s*result\.other = \{/);
  });

  it("the app registers only platforms the CHECK admits", () => {
    const push = blankComments(readFileSync(join(ROOT, "src/lib/nativePush.ts"), "utf8"));
    const m = /async function persistPushToken\(userId: string, token: string, platform: ([^)]*)\)/.exec(push);
    expect(m, "persistPushToken's signature moved").toBeTruthy();
    const registered = [...(m?.[1] ?? "").matchAll(/"(\w+)"/g)].map((x) => x[1]).sort();
    expect(registered.length).toBeGreaterThan(0);
    for (const p of registered) expect(platforms).toContain(p);
  });

  it("the replay can fail: before 20261004191820 the CHECK admitted web", () => {
    expect(checkPlatforms("20261004191820")).toEqual(["android", "ios", "web"]);
  });
});

// @mutate supabase/migrations/20261004191820_push_tokens_no_web.sql | ARRAY['ios'::text, 'android'::text]) | ARRAY['ios'::text, 'android'::text, 'web'::text])
// @mutate supabase/functions/send-push-notification/index.ts |   if (otherTokens.length > 0) { |   if (false) {
