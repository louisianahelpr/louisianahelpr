/**
 * #1582 (press-every-control runs 35976390920 and 36069319716): as admin the
 * sweep pressed /admin?view=reports "Investigating" UNGATED, on whatever
 * report was in the queue, because no word of its label is in DESTRUCTIVE_RX.
 * It is updateStatus(report.id, "investigating"), a write; the card left the
 * pending queue and its "Message Seed", "Message Perry" and "Dismiss" were
 * reported "not found". "Assign to Me", "Dismiss" (Reports and Support) and
 * "Add" (grant admin) were the same: writes the sweep would press on real
 * users' records. Same class as Q166 (it flipped marketing auto-publish).
 *
 * CLASS, from the app's own source: every admin button whose click handler is
 * a function in the same file that writes (supabase update / insert / delete /
 * upsert / rpc, functions.invoke) carries at least one label the harness
 * treats as mutating for the admin persona (DESTRUCTIVE_RX or ADMIN_WRITE_RX).
 * A new writing admin button with a fresh verb turns this red.
 *
 * Also: a control whose own record left the list after this run's mutating
 * press on that record is a documented skip (ROW_CONSUMED_SKIP), with proof;
 * any other missing page control still fails.
 *
 * @mutate scripts/audit/pressProdSafety.mjs | dismiss\|investigat\w*\|assign\w*\| | 
 * @mutate scripts/audit/press-every-control.mjs | isAdminWrite({ persona, label }) \|\| isAccountSettingToggle | isAccountSettingToggle
 * @mutate scripts/audit/press-every-control.mjs |   if (rowConsumed) return ROW_CONSUMED_SKIP; | 
 * @mutate scripts/audit/press-every-control.mjs |   return !(now ?? []).some((c) => c.rowText === rowText); |   return true;
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";

const ROOT = resolve(__dirname, "..", "..");
const WRITE = /\.(update|insert|delete|upsert|rpc)\(|functions\.invoke\(/;

/** Every `const name = [useCallback(]async ... => {` in a file whose body writes. */
function writersIn(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/const (\w+) = (?:useCallback\()?async\b[^\n]*?=>\s*\{/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    let depth = 0, end = open;
    for (; end < src.length; end++) {
      if (src[end] === "{") depth++;
      else if (src[end] === "}" && --depth === 0) break;
    }
    if (WRITE.test(src.slice(open, end))) out.add(m[1]);
  }
  return out;
}

/** Admin buttons whose onClick calls a writer: [file, handler, label candidates]. */
function writerButtons(): { file: string; fn: string; labels: string[] }[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx$/.test(f) && !/\.test\.tsx$/.test(f)) files.push(p);
    }
  };
  walk(resolve(ROOT, "src/components/admin"));
  walk(resolve(ROOT, "src/pages/admin"));
  const out: { file: string; fn: string; labels: string[] }[] = [];
  for (const f of files) {
    const src = blankComments(readFileSync(f, "utf8"));
    const writers = writersIn(src);
    if (!writers.size) continue;
    for (const m of src.matchAll(/<(?:Button|button)\b[^>]*?onClick=\{(?:\(\) => (?:void )?(\w+)\(|(\w+)\})[\s\S]*?>([\s\S]*?)<\/(?:Button|button)>/g)) {
      const fn = m[1] ?? m[2];
      if (!writers.has(fn)) continue;
      // Every piece of text the button can render: JSX text (inside fragments
      // and ternaries too), string literals and template literals, with the
      // attributes (className="…") taken out first.
      const children = m[3].replace(/\s[\w-]+="[^"]*"/g, " ");
      const literals = [...children.matchAll(/"([^"]+)"|`([^`]+)`/g)].map((x) => (x[1] ?? x[2]).replace(/\$\{[^}]*\}/g, " ").trim());
      const jsxText = children.replace(/<[^>]*>/g, "\n").split(/[{}()\n]/).map((t) => t.trim()).filter((t) => /^[A-Za-z][\w '’…-]*$/.test(t));
      out.push({ file: f.replace(ROOT + "/", ""), fn, labels: [...jsxText, ...literals].filter((l) => /[a-z]/i.test(l)) });
    }
  }
  return out;
}

describe("the press gates every admin write (#1582)", () => {
  const mutating = (label: string) =>
    (harness.DESTRUCTIVE_RX as RegExp).test(label) || safety.isAdminWrite({ persona: "admin", label });

  it("every admin button that writes is pressed as a mutating control", () => {
    const buttons = writerButtons();
    // Inventory floor, measured 2026-09-25 (9 found; 6 of them ungated before this fix).
    expect(buttons.length).toBeGreaterThanOrEqual(9);
    const ungated = buttons.filter((b) => !b.labels.some(mutating)).map((b) => `${b.file}: ${b.fn} ${JSON.stringify(b.labels)}`);
    expect(ungated).toEqual([]);
  });

  it("the run's own ungated presses: Investigating, Assign to Me, Dismiss, Add", () => {
    for (const label of ["Investigating", "Assign to Me", "Dismiss", "Add"]) expect(mutating(label), label).toBe(true);
    // Admin-only: the same word on a customer's screen keeps its old disposition.
    expect(safety.isAdminWrite({ persona: "customer", label: "Dismiss" })).toBe(false);
  });

  it("a missing control whose record this run wrote to, and which left the list, is ROW_CONSUMED_SKIP", () => {
    const row = "Report · Seed Poster reported Perry Helper · Spam";
    const mutatedRows = new Set([row]);
    const gone = harness.rowGoneAfterOwnWrite({ rowText: row, mutatedRows, now: [{ rowText: "another report" }] });
    expect(gone).toBe(true);
    expect(harness.missingControlDisposition({ scope: "page", onSameScreen: true, consumed: false, rowConsumed: gone })).toBe(harness.ROW_CONSUMED_SKIP);
    expect((harness.DOCUMENTED_SKIPS as Set<string>).has(harness.ROW_CONSUMED_SKIP)).toBe(true);
  });

  it("the record still on screen, or never written by this run, still fails", () => {
    const row = "Report · Seed Poster reported Perry Helper · Spam";
    expect(harness.rowGoneAfterOwnWrite({ rowText: row, mutatedRows: new Set([row]), now: [{ rowText: row }] })).toBe(false);
    expect(harness.rowGoneAfterOwnWrite({ rowText: row, mutatedRows: new Set(), now: [] })).toBe(false);
    expect(harness.rowGoneAfterOwnWrite({ rowText: "", mutatedRows: new Set([""]), now: [] })).toBe(false);
    expect(harness.missingControlDisposition({ scope: "page", onSameScreen: true, consumed: false, rowConsumed: false })).toBe(null);
  });

  it("the harness gates admin writes, records a mutating press's record, and passes the proof at both missing-control sites", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    expect(src).toMatch(/if \(entry\.mutating && meta\.rowText\) mutatedRows\.add\(meta\.rowText\);/);
    // The mutating-control test the gate runs behind includes the admin write vocabulary.
    const cond = src.match(/if \(DESTRUCTIVE_RX\.test\(label\)[^\n]*\{\n\s*const why = await gate\(/)?.[0] ?? "";
    expect(cond).toMatch(/isAdminWrite\(\{ persona, label \}\)/);
    expect(src.match(/rowConsumed: rowGoneAfterOwnWrite\(\{ rowText: meta\.rowText, mutatedRows, now \}\)/g)?.length).toBe(2);
  });
});
