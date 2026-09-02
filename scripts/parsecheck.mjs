#!/usr/bin/env node
/**
 * Syntax-only parse check for one or more TS/TSX files.
 *
 *   node scripts/parsecheck.mjs src/components/Foo.tsx [more...]
 *   node scripts/parsecheck.mjs --all          # every .ts/.tsx under src, e2e, supabase/functions
 *
 * WHY THIS EXISTS. `tsc -b --noEmit` is the real gate, but it is slow and
 * several agents editing in parallel contend for it. This catches the one
 * failure mode that has broken this tree repeatedly and costs seconds:
 * a `{/* … *\/}` comment placed between JSX attributes, or leading inside
 * `cond && ( … )`. Those are hard syntax errors that white-screen the dev
 * server, and `tsc --noEmit -p tsconfig.json` did NOT surface them.
 *
 * WHAT IT DOES NOT DO — read this before trusting a clean result.
 * It only parses. It does NOT resolve symbols, so it cannot see a missing
 * import. `<Foo icon={Lock} />` with no lucide import parses perfectly and
 * silently resolves to the DOM global `Lock` (the Web Locks API). That one
 * reached main today. A clean parse means "this file is syntactically well
 * formed", never "this file is correct". Run `npx tsc -b --noEmit` before
 * committing.
 *
 * It also lives in scripts/ deliberately: it kept being written to the repo
 * root as a scratch file and deleted by whichever agent cleaned up next.
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src", "e2e", "supabase/functions"];

function collect(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|dist|\.git/.test(p)) collect(p, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const args = process.argv.slice(2);
const files = args.includes("--all")
  ? ROOTS.flatMap((r) => collect(r, []))
  : args;

if (files.length === 0) {
  console.error("usage: node scripts/parsecheck.mjs <file...> | --all");
  process.exit(2);
}

let bad = 0;
for (const p of files) {
  if (!fs.existsSync(p)) {
    console.log(`MISSING  ${p}`);
    bad++;
    continue;
  }
  const sf = ts.createSourceFile(
    p,
    fs.readFileSync(p, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    p.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const diags = sf.parseDiagnostics ?? [];
  if (diags.length) {
    bad++;
    console.log(`\nFAIL  ${p}`);
    for (const d of diags.slice(0, 5)) {
      const { line, character } = sf.getLineAndCharacterOfPosition(d.start);
      console.log(
        `  ${line + 1}:${character + 1}  ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`,
      );
    }
  }
}

if (bad === 0) {
  console.log(`parse OK — ${files.length} file(s)`);
} else {
  console.log(`\n${bad} of ${files.length} file(s) failed to parse`);
}
process.exit(bad === 0 ? 0 : 1);
