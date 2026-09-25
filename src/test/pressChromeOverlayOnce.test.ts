// @mutate scripts/audit/pressFailureClass.mjs |   if (!fromChrome \|\| !(depth > 0)) return null; |   if (!(depth > 0)) return null;
// @mutate scripts/audit/press-every-control.mjs |       inChrome: el.closest('header, nav, [role="banner"], [role="navigation"]') !== null, |       inChrome: false,
/**
 * press-every-control walks an overlay opened from the page header ONCE per
 * run and persona, not once per route.
 *
 * Run 36069319716 (2026-09-25) did not reach 32 rows (14 + 7 + 11 + 0) inside its 135-minute
 * budget. Every admin view found 54-85 controls whatever the view (export 63,
 * subscriptions 60, banreview 60, jobs 60) and took 12-17 minutes, because the
 * admin menu's sheet (AdminTopBar → AdminSidebar: 25 view rows, 25 pin buttons,
 * the footer) was re-walked through its opener on every one of the 25 views.
 *
 * What this pins:
 *   - only OVERLAY controls (depth > 0) whose opener chain starts in page
 *     chrome (<header>/<nav>) are deduplicated; page content never is;
 *   - a control is deduplicated only after it PASSED on an earlier row; a
 *     failed one is pressed again on every row;
 *   - the key is persona + opener chain + the control's signature;
 *   - the skip is documented and names the row where the control passed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { CHROME_SKIP, chromeDisposition, chromeKey } from "../../scripts/audit/pressFailureClass.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";

const ROOT = resolve(__dirname, "..", "..");
type Disp = (o: { fromChrome: boolean; depth: number; key: string; passedOn: Map<string, string> }) => string | null;
const disp = chromeDisposition as Disp;
const key = chromeKey as (o: { persona: string; chain: string[]; sig: string }) => string;

describe("header-chrome overlays are walked once per run", () => {
  const k = key({ persona: "admin", chain: ["Open the admin menu"], sig: "button\u0000\u0000\u0000Jobs" });
  const passed = new Map([[k, "/admin?view=people (admin)"]]);

  it("a chrome-overlay control that already passed is a documented skip", () => {
    expect(disp({ fromChrome: true, depth: 1, key: k, passedOn: passed })).toBe(CHROME_SKIP);
    expect((harness.DOCUMENTED_SKIPS as Set<string>).has(CHROME_SKIP)).toBe(true);
  });

  it("never for page content, a page-level chrome control, or a control not yet passed", () => {
    expect(disp({ fromChrome: false, depth: 1, key: k, passedOn: passed })).toBeNull();
    expect(disp({ fromChrome: true, depth: 0, key: k, passedOn: passed })).toBeNull();
    expect(disp({ fromChrome: true, depth: 1, key: k, passedOn: new Map() })).toBeNull();
  });

  it("the key separates persona, opener chain and control", () => {
    expect(key({ persona: "customer", chain: ["Open the admin menu"], sig: "button\u0000\u0000\u0000Jobs" })).not.toBe(k);
    expect(key({ persona: "admin", chain: ["Notifications"], sig: "button\u0000\u0000\u0000Jobs" })).not.toBe(k);
    expect(key({ persona: "admin", chain: ["Open the admin menu"], sig: "button\u0000\u0000\u0000People" })).not.toBe(k);
  });

  it("the harness marks chrome at enumeration, carries it into overlays, and records only PASSES", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    expect(src).toMatch(/inChrome: el\.closest\('header, nav, \[role="banner"\], \[role="navigation"\]'\) !== null/);
    expect(src).toMatch(/const fromChrome = item\.fromChrome \|\| \(item\.depth === 0 && !!meta\.inChrome\);/);
    expect(src).toMatch(/depth: item\.depth \+ 1, chainOwned, scopeKey, fromChrome \}/);
    const sets = [...src.matchAll(/chromePassedOn\.set\(/g)];
    expect(sets.length).toBe(1);
    const passBranch = src.slice(src.indexOf('entry.result = "PASS"; rec.passed++;'), src.indexOf('entry.result = "PASS"; rec.passed++;') + 300);
    expect(passBranch).toMatch(/chromePassedOn\.set\(ckey/);
    expect(src).toMatch(/chromeDisposition\(\{ fromChrome: item\.fromChrome, depth: item\.depth, key: ckey, passedOn: chromePassedOn \}\)/);
  });
});
