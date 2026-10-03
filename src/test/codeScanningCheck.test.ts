/*
 * GUARD (docs/OPEN.md Q1143): code scanning is a check, and a scan that stops
 * running cannot read as "zero alerts".
 *
 * 2026-10-02: 70 CodeQL alerts sat open on main because nothing read the list.
 * The ledger feed (Q1141) now reports open alerts, but it cannot see a scan that
 * went silent: no analysis means no alerts means green. scripts/code-scanning-
 * check.mjs (daily, .github/workflows/code-scanning-alerts.yml) fails on any
 * open alert AND on a missing, stale or unlisted analysis category.
 */
// @mutate scripts/code-scanning-check.mjs |     if (days > maxAgeDays) { |     if (false) {
// @mutate scripts/code-scanning-check.mjs |     if (!newest.has(cat)) { |     if (false) {
// @mutate scripts/code-scanning-check.mjs |     if (!expected.includes(cat)) { |     if (false) {
// @mutate scripts/code-scanning-check.mjs |   for (const a of [...alerts].sort((x, y) => x.number - y.number)) { |   for (const a of []) {
// @mutate .github/workflows/code-scanning-alerts.yml |         run: node scripts/code-scanning-check.mjs |         run: echo skipped
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no declaration file
import { judge, EXPECTED_CATEGORIES, MAX_AGE_DAYS } from "../../scripts/code-scanning-check.mjs";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const fresh = (category: string, daysAgo = 1) => ({ category, created_at: new Date(NOW - daysAgo * 86_400_000).toISOString() });
const allFresh = () => (EXPECTED_CATEGORIES as string[]).map((c) => fresh(c));
const alert = { number: 73, rule: "js/xss-through-dom", severity: "high", path: "src/x.ts", line: 9 };

describe("code-scanning gate (Q1143)", () => {
  it("passes with no open alert and every expected category freshly analysed", () => {
    expect(judge({ alerts: [], analyses: allFresh(), now: NOW })).toEqual({ ok: true, lines: [] });
  });

  it("fails on an open alert and names it", () => {
    const r = judge({ alerts: [alert], analyses: allFresh(), now: NOW });
    expect(r.ok).toBe(false);
    expect(r.lines).toEqual(["open alert #73 js/xss-through-dom (high) src/x.ts:9"]);
  });

  it("fails when a category's scan stopped (older than the limit) or never ran", () => {
    const stale = [...allFresh().slice(1), fresh((EXPECTED_CATEGORIES as string[])[0], MAX_AGE_DAYS + 1)];
    expect(judge({ alerts: [], analyses: stale, now: NOW }).ok).toBe(false);
    expect(judge({ alerts: [], analyses: allFresh().slice(1), now: NOW }).ok).toBe(false);
  });

  it("fails when main is analysed under a category the list does not name", () => {
    const r = judge({ alerts: [], analyses: [...allFresh(), fresh("/language:python")], now: NOW });
    expect(r.ok).toBe(false);
    expect(r.lines[0]).toContain("/language:python");
  });

  it("the list covers CodeQL's two languages and the ESLint upload", () => {
    expect(EXPECTED_CATEGORIES).toEqual(["/language:actions", "/language:javascript-typescript", "eslint"]);
  });

  it("runs daily, and its red files a nightly-red issue", () => {
    const wf = readFileSync(join(__dirname, "..", "..", ".github/workflows/code-scanning-alerts.yml"), "utf8");
    expect(wf).toMatch(/schedule:\s*\n\s*- cron: "\d+ \d+ \* \* \*"/);
    expect(wf).toContain("run: node scripts/code-scanning-check.mjs");
    expect(wf).toContain("uses: ./.github/actions/nightly-issue-sync");
    expect(wf).toMatch(/security-events: read/);
  });
});
