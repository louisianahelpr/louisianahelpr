// @mutate supabase/functions/stalled-completion-reminder/index.ts | return cronError("stalled-completion-reminder", caughtMessage(e), corsHeaders); | return cronError("stalled-completion-reminder", (e as Error).message ?? String(e), corsHeaders);
/*
 * RATCHET: a caught value is never turned into text with String(err) in an
 * edge function; it goes through caughtMessage() (_shared/caughtMessage.ts).
 *
 * WHY. CodeQL's js/stack-trace-exposure treats every catch parameter as a
 * possible stack trace, and String(err) hands that value itself to whatever
 * comes next. Where the next thing is a response body (cronError, a JSON
 * error), CodeQL raises an alert. #2178 added caughtMessage() and cleared
 * alerts 85 and 88, but alert 73 survived: four more cron functions
 * (marketing-token-health, money-reconciliation, payment-confirm-reminder,
 * stalled-completion-reminder) still wrote
 * `err instanceof Error ? err.message : String(err)` into cronError (paths
 * read from main's SARIF, analysis 1885093517, 2026-10-03).
 *
 * The same spelling is harmless while the text only reaches a log, and
 * nothing here can tell which sink each site reaches, so the count may only
 * SHRINK: a new catch uses caughtMessage(), and converting an old one lowers
 * BASELINE in the same commit. Two-way and exact, so a stale baseline cannot
 * hide the next one. Inventory: every tracked .ts under supabase/functions
 * (git ls-files, so files other tests write mid-run are not read).
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
/** Sites left on 2026-10-03, after the four that reached a response were converted. */
const BASELINE = 62;

/** `x instanceof Error ? x.message : String(x)` and `(x as Error).message ?? String(x)`. */
const SHAPES = [
  /instanceof Error \? (\w+)\.message : String\(\1\)/g,
  /\((\w+) as Error\)\.message \?\? String\(\1\)/g,
];

export function stringifiedCatches(src: string): number {
  const body = blankComments(src);
  return SHAPES.reduce((n, re) => n + [...body.matchAll(re)].length, 0);
}

const FILES = execFileSync("git", ["ls-files", "supabase/functions"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.ts$/.test(f));

describe("edge functions turn a caught value into text with caughtMessage(), never String(err)", () => {
  it("the inventory is real", () => {
    expect(FILES.length, "git ls-files found no edge function source").toBeGreaterThan(150);
  });

  it("the matcher catches both spellings and not caughtMessage", () => {
    expect(stringifiedCatches("const m = err instanceof Error ? err.message : String(err);")).toBe(1);
    expect(stringifiedCatches("cronError(FN, (e as Error).message ?? String(e), h);")).toBe(1);
    expect(stringifiedCatches("const m = caughtMessage(err);")).toBe(0);
    expect(stringifiedCatches("// err instanceof Error ? err.message : String(err)\nx();")).toBe(0);
  });

  it("the count only shrinks, and the baseline is exact", () => {
    const perFile = FILES.map((f) => [f, stringifiedCatches(readFileSync(resolve(ROOT, f), "utf8"))] as const)
      .filter(([, n]) => n > 0);
    const total = perFile.reduce((n, [, c]) => n + c, 0);
    expect(
      total,
      total > BASELINE
        ? `a catch was turned into text with String(err): use caughtMessage(err) from _shared/caughtMessage.ts.\n  ${perFile.map(([f, n]) => `${f}: ${n}`).join("\n  ")}`
        : `${BASELINE - total} more converted: lower BASELINE to ${total} in this commit`,
    ).toBe(BASELINE);
  });
});
