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
 * Divisor shapes (`/`, numeric `??`/`||` fallbacks, Math.max) count too.
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

const HN = "helpers_needed";
const GROUP = "is_group_job";

/** Does the node read `prop` — as `x.prop`, `x["prop"]`, or a destructured `prop` binding? */
function reads(n: ts.Node, prop: string): boolean {
  let hit = false;
  const v = (m: ts.Node) => {
    if (ts.isPropertyAccessExpression(m) && m.name.text === prop) hit = true;
    else if (ts.isElementAccessExpression(m) && ts.isStringLiteralLike(m.argumentExpression) && m.argumentExpression.text === prop) hit = true;
    else if (ts.isIdentifier(m) && m.text === prop && !(ts.isPropertyAccessExpression(m.parent) && m.parent.name === m)) hit = true;
    if (!hit) ts.forEachChild(m, v);
  };
  v(n);
  return hit;
}

/** `!x.is_group_job` (or `!(…is_group_job…)`) — a gate that selects the NON-group case. */
function negatedGate(cond: ts.Expression): boolean {
  let c: ts.Expression = cond;
  while (ts.isParenthesizedExpression(c)) c = c.expression;
  return ts.isPrefixUnaryExpression(c) && c.operator === ts.SyntaxKind.ExclamationToken && reads(c.operand, GROUP);
}

/**
 * Every shape that can turn helpers_needed into a divisor, with whether it is
 * gated on a positive is_group_job test:
 *   - `cond ? <hn> : …` / `cond ? … : <hn>` — gated when cond tests is_group_job
 *     with the polarity that picks the helpers_needed branch for group jobs;
 *   - `x / <hn…>` — gated only when the divisor itself tests is_group_job;
 *   - `<hn> ?? 1`, `<hn> || 2` (a numeric fallback), `Math.max(…<hn>…)` — the
 *     fallback shapes; gated only when they test is_group_job.
 * Any site sitting under an enclosing positive `is_group_job &&` / `? :` is
 * gated (e.g. JSX rendered only for group jobs).
 * Template literals (copy such as "3 helpers needed") are not divisors.
 */
export function helperSplits(source: string, fileName = "f.tsx"): { text: string; gated: boolean }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { text: string; gated: boolean }[] = [];
  // An enclosing `x.is_group_job && <site>` or `x.is_group_job ? <site> : …`
  // (JSX rendered only for group jobs) gates the site too.
  const underGate = (n: ts.Node): boolean => {
    for (let c: ts.Node = n, p = n.parent; p; c = p, p = p.parent) {
      if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && p.right === c && reads(p.left, GROUP) && !negatedGate(p.left)) return true;
      if (ts.isConditionalExpression(p) && p.whenTrue === c && reads(p.condition, GROUP) && !negatedGate(p.condition)) return true;
    }
    return false;
  };
  const push = (n: ts.Node, gated: boolean) => out.push({ text: n.getText(sf).replace(/\s+/g, " "), gated: gated || underGate(n) });
  const visit = (node: ts.Node) => {
    if (ts.isConditionalExpression(node)) {
      const t = reads(node.whenTrue, HN) && !ts.isTemplateExpression(node.whenTrue);
      const f = reads(node.whenFalse, HN) && !ts.isTemplateExpression(node.whenFalse);
      if (t || f) {
        const tests = reads(node.condition, GROUP);
        const neg = negatedGate(node.condition);
        push(node, tests && (t ? !neg : true) && (f ? neg : true));
        return; // the branches are this site; do not count them twice
      }
    } else if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.SlashToken || op === ts.SyntaxKind.SlashEqualsToken) {
        if (reads(node.right, HN)) {
          let r: ts.Expression = node.right;
          while (ts.isParenthesizedExpression(r)) r = r.expression;
          // A divisor that is itself a gated conditional is reported by that conditional.
          if (!ts.isConditionalExpression(r)) {
            push(node, reads(node.right, GROUP));
            return;
          }
        }
      } else if ((op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) && reads(node.left, HN) && !reads(node.left, GROUP) && ts.isNumericLiteral(node.right)) {
        push(node, false);
        return;
      }
    } else if (ts.isCallExpression(node) && node.expression.getText(sf) === "Math.max" && node.arguments.some((a) => reads(a, HN))) {
      push(node, node.arguments.some((a) => reads(a, GROUP)));
      return;
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
    // Exact, both ways: 12 split sites in src/ on 2026-09-27, all gated. A new
    // site or a removed one moves this number; update it in the same commit.
    expect(all.length).toBe(12);
  });

  // Every shape the reviewer of 37ba1c1d0 showed the first extractor missed
  // (lh-money-escrow, 2026-09-27): each is an ungated split and must be seen.
  it.each([
    "const e = b / j.helpers_needed;",
    "const e = b / (j.helpers_needed || 1);",
    "const h = j.helpers_needed ?? 1;",
    "const h = Math.max(1, j.helpers_needed);",
    "const h = c ? 1 : j.helpers_needed;",
    "const { helpers_needed } = j; const e = b / helpers_needed;",
    'const e = b / j["helpers_needed"];',
    "const h = !j.is_group_job ? j.helpers_needed : 1;",
  ])("sees an ungated split: %s", (code) => {
    const found = helperSplits(code);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => !f.gated)).toBe(true);
  });

  it.each([
    "const h = j.is_group_job ? j.helpers_needed : 1;",
    "const h = !j.is_group_job ? 1 : j.helpers_needed;",
    "const x = j.is_group_job && <G n={j.helpers_needed || 2} />;",
  ])("accepts a gated split: %s", (code) => {
    expect(helperSplits(code).every((f) => f.gated)).toBe(true);
  });

  it("ignores helpers_needed that is not a divisor", () => {
    expect(helperSplits("const row = { helpers_needed: j.helpers_needed ?? null };")).toEqual([]);
    expect(helperSplits("const s = `${j.helpers_needed} helpers needed`;")).toEqual([]);
  });

  it("every split tests is_group_job", () => {
    expect(all.filter((s) => !s.gated).map((s) => `${s.file}: ${s.text}`)).toEqual([]);
  });
});
