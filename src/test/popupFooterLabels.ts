/**
 * EVERY footer action label in the app, derived FROM THE CALL SITES.
 *
 * WHY THIS IS A MODULE AND NOT A LIST.
 * `popupFooterFit.spec.ts` measures whether a real label fits the box the
 * footer gives it. A hand-written array of labels cannot answer that question,
 * because it is both the test's input AND its definition of correctness — add a
 * dialog with a longer label and the test keeps passing, having never seen it.
 * That exact shape produced eight wrong results in the 2026-09-02 audit (see
 * `registries-checked-against-themselves`). So the set is DERIVED: walk the
 * TypeScript AST of every tracked .tsx under `src/`, find the real
 * Dialog/Sheet action elements, and read the text they actually render.
 *
 * WHY THE AST AND NOT A REGEX.
 * `popupShellInventory.test.ts` documents two failed attempts at lexing TSX —
 * a regex that ate a `<DialogFooter>` block whole because `accept="image/*"`
 * opened a comment, and a raw `ts.createScanner` that read the apostrophe in
 * ordinary JSX prose as a string literal and went blind for the rest of the
 * file. `ts.createSourceFile` is the parser, not a lexer, and gets JSX children
 * right by construction.
 *
 * WHAT COUNTS AS A LABEL. A label is any string the button can render:
 *   - literal JSX text            <DialogPrimaryAction>Save Changes</…>
 *   - both arms of a ternary      {saving ? "Saving…" : "Save Changes"}
 *   - a template literal, with each `${…}` replaced by SUBSTITUTION_SAMPLE
 * Every arm is a separate label, because a dialog renders exactly one of them
 * and it only takes one to overflow. Interpolations are sampled rather than
 * skipped: `Cash Out ${fmt(amount)}` is one of the longest labels in the app
 * and dropping it is how the class was missed the first time.
 */
import ts from "typescript";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * NOT `resolve(__dirname, "../..")`, which is what every other test in `src/`
 * uses. This module is imported by BOTH a vitest test and a Playwright spec, and
 * Playwright loads specs as ESM where `__dirname` is not defined — it threw
 * `ReferenceError: __dirname is not defined in ES module scope` before the spec
 * had collected a single test. `git rev-parse` is exact in both runtimes and in
 * a worktree, and this file already shells out to git for the file list.
 */
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

/**
 * Stand-in for a `${…}` this analysis cannot evaluate.
 *
 * Every interpolation in a real footer label is one of: a count (`Mark ${n}
 * Resolved`, `Upload ${n} File`), a money amount whose `$` is ALREADY in the
 * template (`Cancel · pay $${fee}`, `Boost for $${price}`), or a short name
 * (`Set to ${status}`, `See ${tier} Plans`). Eight digits-and-separators is the
 * widest of those — `formatCurrency` output for this marketplace — and it
 * deliberately carries NO `$`, because the templates that render money supply
 * their own and a sample containing one would double it.
 *
 * It is a bound, not a prediction. That is sound here because the assertions
 * below are about GRACEFUL DEGRADATION (nothing overlaps, nothing escapes the
 * card) rather than about fitting on one line — so an over-wide sample
 * exercises the wrap path harder instead of producing a false failure. The one
 * way it could fail wrongly is if `min-w-max` pushed a button past the card at
 * this width but not at the real one; that is a genuine finding either way,
 * because it means the footer's safety margin is thinner than one money label.
 */
export const SUBSTITUTION_SAMPLE = "1,240.00";

/** The footer action components. Dialog and Sheet share popupFooter.ts, so they share this test. */
export const COMMIT_TAGS = [
  "DialogPrimaryAction",
  "DialogDestructiveAction",
  "SheetPrimaryAction",
] as const;
export const DISMISS_TAGS = ["DialogSecondaryAction", "SheetSecondaryAction"] as const;

export interface FooterLabel {
  /** The exact string the button renders, with interpolations sampled. */
  label: string;
  /** Repo-relative path of the call site, so a failure names the file to fix. */
  file: string;
  line: number;
  role: "commit" | "dismiss";
}

/**
 * JSX text is HTML-escaped at the source level: `Dismiss &amp; Lift` renders as
 * `Dismiss & Lift`, which is one glyph narrower and four characters shorter.
 * Measuring the escaped form measures a string no user ever sees.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, "\u00a0");
}

/** Every tracked, existing, non-test TSX file under `src/`. */
function tsxFiles(): string[] {
  return execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".tsx") && !/\.test\./.test(f))
    // Tracked but deleted in the working tree — reading it would ENOENT the suite.
    .filter((f) => existsSync(resolve(ROOT, f)));
}

/**
 * Collect every string this JSX subtree can render.
 *
 * Returns one entry per RENDERABLE ALTERNATIVE, not one per node: a ternary
 * yields two, nested ternaries yield one per leaf. Static text around the
 * expression is carried into every alternative, so
 * `<>{n} Files{plural}</>` composes rather than fragmenting.
 */
function labelsOf(node: ts.Node): string[] {
  // A conditional renders exactly one arm — so it MULTIPLIES the alternatives.
  if (ts.isConditionalExpression(node)) {
    return [...labelsOf(node.whenTrue), ...labelsOf(node.whenFalse)];
  }
  if (ts.isParenthesizedExpression(node)) return labelsOf(node.expression);
  if (ts.isJsxExpression(node)) return node.expression ? labelsOf(node.expression) : [""];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  // `{cond ? <Spinner/> : null}` — null/undefined/false render nothing. Without
  // this they fell to the opaque fallback below and every spinner-guarded commit
  // label was reported 8 characters longer than it can ever be.
  if (
    node.kind === ts.SyntaxKind.NullKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isIdentifier(node) && node.text === "undefined")
  ) {
    return [""];
  }
  if (ts.isJsxText(node)) {
    // JSX collapses runs of whitespace, and a newline-only run renders as nothing.
    const t = node.text.replace(/\s+/g, " ");
    return [/^\s*$/.test(node.text) && node.text.includes("\n") ? "" : t];
  }
  if (ts.isTemplateExpression(node)) {
    // RECURSE into each span rather than stamping the sample on it. The spans
    // are frequently literal themselves — `File${n === 1 ? "" : "s"}` is a
    // ternary of two short strings, and treating it as opaque both inflated the
    // label and lost the singular/plural pair that is the whole point of testing it.
    let out = [node.head.text];
    for (const span of node.templateSpans) {
      const parts = labelsOf(span.expression);
      out = out.flatMap((prefix) => parts.map((p) => prefix + p + span.literal.text));
    }
    return out;
  }
  // `a && b` renders b or nothing; `a ?? b` / `a || b` render either side.
  if (ts.isBinaryExpression(node)) {
    const k = node.operatorToken.kind;
    if (k === ts.SyntaxKind.AmpersandAmpersandToken) return ["", ...labelsOf(node.right)];
    if (k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken) {
      return [...labelsOf(node.left), ...labelsOf(node.right)];
    }
  }
  if (ts.isJsxFragment(node) || ts.isJsxElement(node)) {
    // An icon child (<Star/>) contributes no text but does occupy width; that is
    // the Button's own `gap-2` + 18px, accounted for by the caller, not here.
    let out = [""];
    for (const child of node.children) {
      const parts = labelsOf(child);
      out = out.flatMap((prefix) => parts.map((p) => prefix + p));
    }
    return out;
  }
  // Anything else (a call, an identifier, a member access) is an opaque runtime
  // string. Sampling it is the honest move: skipping it hides a long label.
  if (ts.isJsxSelfClosingElement(node)) return [""];
  return [SUBSTITUTION_SAMPLE];
}

/** Every footer action label in the app, one entry per renderable alternative. */
export function collectFooterLabels(): FooterLabel[] {
  const out: FooterLabel[] = [];
  for (const file of tsxFiles()) {
    const abs = resolve(ROOT, file);
    const src = ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node)) {
        const tag = node.openingElement.tagName.getText(src);
        const role = (COMMIT_TAGS as readonly string[]).includes(tag)
          ? "commit"
          : (DISMISS_TAGS as readonly string[]).includes(tag)
            ? "dismiss"
            : null;
        if (role) {
          const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
          const seen = new Set<string>();
          for (const raw of labelsOf(node)) {
            const label = decodeEntities(raw).replace(/\s+/g, " ").trim();
            if (!label || seen.has(label)) continue;
            seen.add(label);
            out.push({ label, file, line, role });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(src, visit);
  }
  return out;
}
