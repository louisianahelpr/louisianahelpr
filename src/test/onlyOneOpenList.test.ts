// @mutate docs/GUARD-BURNDOWN.md | - every registered guard carries a real `@mutate`. | - [ ] every registered guard carries a real `@mutate`.
/*
 * ONE open-work list: docs/OPEN.md (owner, 2026-09-23, Q58e: "all tracked in 1
 * place so new sessions can easily pick up and leave").
 *
 * That night open work lived in five places — OPEN.md, docs/audit/OPEN_ITEMS.md
 * (935 commits stale), the audit bus, the alert ledger, nightly-red issues —
 * plus a 2026-08-31 TODO.md nobody had read since. A new list starts the same
 * way every time: a doc that calls itself a todo / open-items / backlog list,
 * or grows `- [ ]` lines. This fails on either, anywhere in the repo except
 * docs/OPEN.md and docs/archive/ (history, never read as open work).
 *
 * The allowlist is TWO-WAY: each entry needs a reason, must exist, and must
 * still trigger — an entry that no longer carries an open list fails too, so
 * it cannot outlive what it excused.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const THE_LIST = "docs/OPEN.md";

/** Docs allowed to carry unchecked boxes or an open-list title, each with why. */
// @two-way src/test/onlyOneOpenList.test.ts:allowlisted but no longer an open list
export const ALLOWED: Record<string, string> = {
  "TODO.md":
    "legacy backlog last touched 2026-08-31, predates the one-list rule; its live rows are not yet folded into docs/OPEN.md — queue item Q84 reconciles it and retires the file to a pointer",
  "docs/audit/OPEN_ITEMS.md":
    "retired to a 3-line pointer by Q16 (2026-09-23); its H1 still reads 'Open items — retired' so readers of old links land on the pointer",
  "docs/audit/launch-2026-09/SURFACE.md":
    "GENERATED coverage checklist (scripts/audit-surface.mjs): one box per surface an audit lane must visit; findings go to the audit bus, not here",
  "docs/APP_STORE_REVIEW_SUBMISSION.md":
    "per-submission run-sheet for App Store review, re-ticked for each build; the submission itself is tracked in docs/OPEN.md",
  "docs/CICD_AND_ASO.md":
    "release checklist template, re-run for every release; not a list of open work",
  "docs/SUPABASE_NEW_TABLE.md":
    "per-table procedure checklist (grants, RLS, policies) followed whenever a table is added",
  "docs/qa/ACCESSIBILITY_AUDIT.md":
    "device-only accessibility test plan, re-run by a human per release",
  "docs/qa/CRASH_RECOVERY.md":
    "force-quit test plan, re-run on a device per release",
  "docs/qa/TESTFLIGHT_SMOKE_TEST.md":
    "TestFlight smoke checklist, walked for every build before promotion",
};

const UNCHECKED = /^\s*[-*+] \[ \]/gm;
/** A title that declares the doc a list of open work. */
const DECLARES = /^#\s+.*\b(to-?do|todos?|open[- ](items?|work|list|tasks?)|backlog|punch[- ]?list)\b/im;

export function openListSignals(text: string): string[] {
  const out: string[] = [];
  const n = (text.match(UNCHECKED) ?? []).length;
  if (n) out.push(`${n} unchecked "- [ ]" line(s)`);
  const h1 = text.split("\n").find((l) => /^#\s/.test(l)) ?? "";
  if (DECLARES.test(h1)) out.push(`title declares an open list: "${h1.trim()}"`);
  return out;
}

function trackedMarkdown(): string[] {
  return execFileSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.startsWith("docs/archive/") && !f.startsWith("node_modules/"));
}

describe("docs/OPEN.md is the only open-work list (Q58e)", () => {
  const files = trackedMarkdown();
  const hits = new Map<string, string[]>();
  for (const f of files) {
    if (f === THE_LIST) continue;
    let text: string;
    try { text = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    const s = openListSignals(text);
    if (s.length) hits.set(f, s);
  }

  it("scanned the repo's markdown (cannot pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(openListSignals(readFileSync(join(ROOT, THE_LIST), "utf8")).length).toBeGreaterThan(0);
  });

  it("no other doc declares itself an open list or carries unchecked boxes", () => {
    const rogue = [...hits].filter(([f]) => !(f in ALLOWED)).map(([f, s]) => `${f}: ${s.join("; ")}`);
    expect(
      rogue,
      "Open work goes in docs/OPEN.md (a queue line), findings on the audit bus. Move these items there " +
        "(or tick them with evidence), or — for a procedure checklist that is re-run, not open work — " +
        "allowlist the file in src/test/onlyOneOpenList.test.ts with the reason.",
    ).toEqual([]);
  });

  it("the allowlist does not rot (two-way)", () => {
    const stale = Object.keys(ALLOWED).filter((f) => !existsSync(join(ROOT, f)) || !hits.has(f));
    expect(stale, "allowlisted but no longer an open list (or gone) — remove the entry").toEqual([]);
    for (const [f, why] of Object.entries(ALLOWED)) expect(why.length, `${f} needs a real reason`).toBeGreaterThan(40);
  });

  it("is RED on a planted list", () => {
    expect(openListSignals("# Notes\n\n- [ ] ship it\n")).toHaveLength(1);
    expect(openListSignals("# TODO\n\nnothing yet\n")).toHaveLength(1);
    expect(openListSignals("# Launch backlog\n")).toHaveLength(1);
    expect(openListSignals("# Guide\n\n- [x] done\n")).toHaveLength(0);
  });
});
