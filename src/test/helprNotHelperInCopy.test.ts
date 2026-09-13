// The person who does a job is a "Helpr" in everything the user reads. The
// owner approved the rename on 2026-09-13 after "This helper hasn't set up…"
// (create-payment) and "…no helper assigned" (auto-expire-jobs, stored on the
// job row and shown back) reached users.
//
// This guard walks the TypeScript AST of every non-test source file in `src/`
// and `supabase/functions/` and inspects only STRING CONTENT: string literals,
// template-literal text and JSX text. Identifiers (`helperId`, `useHelpers`),
// comments, import specifiers and console.* arguments are never user-visible
// and are out of scope (a separate identifier rename is planned), as are
// arguments to log/ops-alert calls (INTERNAL_CALLEES) and object keys. Keys, column
// names and enum values are single tokens with no whitespace (`helper_id`,
// "saved_helpers", "helper"), so a literal must contain a space, or be the
// capitalised label "Helper"/"Helpers", to count as copy.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["src", "supabase/functions"];

// A standalone word "helper"/"helpers", not part of a path, identifier,
// hyphenated key or PostgREST embed (`helper:profiles!…`).
const WORD = /(^|[^A-Za-z0-9_$./\\-])helpers?(?![A-Za-z0-9_$/\\:(-])/i;

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "test" || name === "__tests__" || name === "tests") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
}

// Calls whose string arguments only ever reach a log, the ops Slack channel
// or a cron's internal result — never a user's screen, inbox or push.
const INTERNAL_CALLEES = new Set([
  "log", "logStep", "record", "markFailed", "releaseClaimForRetry",
  "postSlackOpsAlert", "scanAll", "scanAllIn", "scanDefect", "cronResult",
]);

function isInternalOnly(node: ts.Node): boolean {
  // An object key ("Helper ID": id) names a field, it is not a sentence.
  if (node.parent && ts.isPropertyAssignment(node.parent) && node.parent.name === node) return true;
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
      const callee = p.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        if (ts.isIdentifier(callee.expression) && callee.expression.text === "console") return true;
        if (INTERNAL_CALLEES.has(callee.name.text)) return true;
      } else if (ts.isIdentifier(callee) && INTERNAL_CALLEES.has(callee.text)) return true;
    }
    if (ts.isStatement(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

function findHelperCopy(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: string[] = [];
  const check = (node: ts.Node, text: string) => {
    if (!WORD.test(text)) return;
    const trimmed = text.trim();
    const isCopy = /\s/.test(trimmed) || /^Helpers?$/.test(trimmed);
    if (!isCopy) return;
    if (isInternalOnly(node)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push(`${path.relative(ROOT, fileName)}:${line + 1}: ${trimmed.slice(0, 120)}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) check(node, node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) check(node, node.text);
    else if (ts.isJsxText(node)) check(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe("user-visible copy says Helpr, never helper", () => {
  it("the scanner catches the original strings (can fail)", () => {
    const f = (name: string) => path.join(ROOT, name);
    expect(findHelperCopy(f("x.ts"), `const e = { error: "This helper hasn't set up their payout account yet" };`)).toHaveLength(1);
    expect(findHelperCopy(f("x.tsx"), `const a = <p>No helpers yet</p>;`)).toHaveLength(1);
    expect(findHelperCopy(f("x.ts"), "const r = `scheduled time passed with no helper assigned`;")).toHaveLength(1);
    // Identifiers, keys, comments and console output are not copy.
    expect(
      findHelperCopy(
        f("x.ts"),
        `// the helper\nconst helperId = row.helper_id; const t = "saved_helpers"; console.log("helper failed", helperId); postSlackOpsAlert({ message: "the helper is unpaid", fields: { "Helper ID": id } });`,
      ),
    ).toHaveLength(0);
  });

  it("no source file ships the word helper in a user-visible string", () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
    expect(files.length).toBeGreaterThan(500);
    const hits = files.flatMap((file) => findHelperCopy(file, readFileSync(file, "utf8")));
    expect(hits, `Use "Helpr" in copy:\n${hits.join("\n")}`).toEqual([]);
  });
});
