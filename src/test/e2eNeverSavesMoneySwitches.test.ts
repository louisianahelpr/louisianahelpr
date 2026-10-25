/**
 * NO BROWSER TEST SAVES A MONEY SWITCH ON PROD (2026-10-25). Auto-tip was found ON at 15% for a shared test account:
 * e2e/prod-audit/messyInputForms.ts's auto-tip `prepare` clicked "Tip automatically" to reveal the amount fields,
 * the switch saves the moment it flips (src/pages/profile/AutoTip.tsx, audit #41), and the prepare ran before the
 * sweep's write firewall, so every run left the poster account tipping on every job, with Stripe live.
 *
 * THE CLASS: every e2e file that presses a money switch (auto-tip, instant release) answers the profiles PATCH in
 * the browser (page.route ... fulfill) before the press, so the flip never reaches the database.
 *
 * @mutate e2e/prod-audit/messyInputForms.ts |           ? route.fulfill({ json: [{ user_id: "e2e-stub" }] }) |           ? route.continue()
 * @mutate e2e/prod-audit/messyInputForms.ts |       await page.route(/\/rest\/v1\/profiles\b/, (route) => |       await page.unroute(/\/rest\/v1\/profiles\b/, (route) =>
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
/** The money switches a member flips in "After a job" (AutoTip.tsx). */
const MONEY_SWITCH = /getByRole\(\s*["']switch["']\s*,\s*\{\s*name:\s*\/[^/]*(?:tip automatically|instant release)[^/]*\/i?/i;

function e2eFiles(dir = join(ROOT, "e2e")): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : e2eFiles(p);
    return /\.(ts|mjs|js)$/.test(n) ? [p] : [];
  });
}

/** The enclosing `prepare`/test body: from the nearest `async (` above the press. */
function enclosing(code: string, at: number): string {
  const start = code.lastIndexOf("async (", at);
  return code.slice(start < 0 ? 0 : start, at);
}

describe("no browser test saves a money switch on prod", () => {
  const presses = e2eFiles().flatMap((f) => {
    const code = blankComments(readFileSync(f, "utf8"));
    return [...code.matchAll(new RegExp(MONEY_SWITCH, "gi"))].map((m) => ({ file: relative(ROOT, f), before: enclosing(code, m.index!) }));
  });

  it("finds the presses (floor)", () => {
    expect(presses.length).toBeGreaterThan(0);
    expect(presses.map((p) => p.file)).toContain("e2e/prod-audit/messyInputForms.ts");
  });

  it("each press first answers the profiles PATCH in the browser", () => {
    const bad = presses.filter(
      (p) => !/page\.route\(\s*\/\\\/rest\\\/v1\\\/profiles/.test(p.before) || !/\.fulfill\(/.test(p.before) || !/["']PATCH["']/.test(p.before),
    );
    expect(bad.map((p) => p.file)).toEqual([]);
  });
});
