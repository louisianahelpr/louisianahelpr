/**
 * CLASS CHECK: a job's budget is split by `helpers_needed` only on a real
 * group job (2026-09-27).
 *
 * The rule is release-payout's (`job.is_group_job && job.helpers_needed ?
 * job.helpers_needed : 1`) and helperShareCount's in src/lib/helperEarnings.ts.
 * A non-group job carrying helpers_needed > 1 pays its one helper the whole
 * budget; a reader that divides anyway shows a third of the real figure.
 *
 * FOUND 2026-09-27 in review of cf781739d (Q759): the admin user Jobs tab
 * computed `Number(j.helpers_needed) > 0 ? Number(j.helpers_needed) : 1`
 * with no is_group_job gate. Nothing in prod's data triggered it yet (every
 * non-group job had helpers_needed = 1, read-only SQL) and no CHECK
 * constraint prevents the mismatch.
 *
 * THE CHECK: in every src/ file, a conditional expression that yields
 * `helpers_needed` (the split divisor shape) must test `is_group_job` in its
 * condition. helperShareCount itself is the canonical gate and is skipped.
 * Shown red on the pre-fix JobsTab.
 *
 * @mutate src/components/admin/userDetail/JobsTab.tsx | const helpers = helperShareCount(j); | const helpers = Number(j.helpers_needed) > 0 ? Number(j.helpers_needed) : 1;
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const SRC = resolve(__dirname, "..");
const CANONICAL = join(SRC, "lib", "helperEarnings.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "integrations") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

/** Every `cond ? <reads helpers_needed> : …` in a file, with whether cond tests is_group_job. */
export function helperSplits(source: string, fileName = "f.tsx"): { text: string; gated: boolean }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { text: string; gated: boolean }[] = [];
  const reads = (n: ts.Node, prop: string): boolean => {
    let hit = false;
    const v = (m: ts.Node) => {
      if (ts.isPropertyAccessExpression(m) && m.name.text === prop) hit = true;
      if (!hit) ts.forEachChild(m, v);
    };
    v(n);
    return hit;
  };
  const visit = (node: ts.Node) => {
    if (ts.isConditionalExpression(node) && reads(node.whenTrue, "helpers_needed") && !ts.isTemplateExpression(node.whenTrue)) {
      out.push({ text: node.getText(sf).replace(/\s+/g, " "), gated: reads(node.condition, "is_group_job") });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("a budget is split by helpers_needed only on a group job", () => {
  const all = walk(SRC)
    .filter((f) => f !== CANONICAL)
    .flatMap((f) => helperSplits(readFileSync(f, "utf8"), f).map((s) => ({ ...s, file: relative(SRC, f) })));

  it("finds the split sites it claims to read (not vacuous)", () => {
    expect(helperSplits("const h = j.is_group_job && j.helpers_needed ? j.helpers_needed : 1;")).toEqual([
      { text: "j.is_group_job && j.helpers_needed ? j.helpers_needed : 1", gated: true },
    ]);
    expect(helperSplits("const h = Number(j.helpers_needed) > 0 ? Number(j.helpers_needed) : 1;")[0].gated).toBe(false);
    // Exact, both ways: 11 split sites in src/ on 2026-09-27, all gated. A new
    // site or a removed one moves this number; update it in the same commit.
    expect(all.length).toBe(11);
  });

  it("every split tests is_group_job", () => {
    expect(all.filter((s) => !s.gated).map((s) => `${s.file}: ${s.text}`)).toEqual([]);
  });
});
