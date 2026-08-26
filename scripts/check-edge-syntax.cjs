#!/usr/bin/env node
/**
 * Syntax-only parse of every Supabase edge function.
 *
 * Why this exists: Deno's bundler aborts the WHOLE deploy on one parse error,
 * and nothing in the local gate looks at these files. tsconfig.app.json covers
 * `src/` only (edge functions are Deno, with https:// imports tsc cannot
 * resolve), and vitest never imports them — the parity tests read them as
 * TEXT. So a stray `*x/` sequence inside a JSDoc block, which silently ends the
 * comment and turns the rest of the file into garbage, passed typecheck, passed
 * lint, passed 1825 tests, and only surfaced as "failed to create the graph"
 * in the Supabase Edge Functions Deploy job after it had already reached main.
 *
 * This parses each file with the TypeScript parser and reports syntax
 * diagnostics only — no type checking, so unresolved Deno imports are fine.
 * Runs in about a second.
 */
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const ROOT = 'supabase/functions';
const SKIP = new Set(['node_modules', '.git']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

if (!fs.existsSync(ROOT)) {
  console.error(`${ROOT} not found — run from the repo root`);
  process.exit(1);
}

let bad = 0;
const files = walk(ROOT);
for (const file of files) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    // Must match the extension: the email templates are .tsx, and parsing JSX
    // as plain TS reports a cascade of bogus "'>' expected" errors.
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const diagnostics = source.parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    bad++;
    for (const d of diagnostics.slice(0, 3)) {
      const { line, character } = source.getLineAndCharacterOfPosition(d.start ?? 0);
      console.error(
        `${file}:${line + 1}:${character + 1}  ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`,
      );
    }
  }
}

console.log(`edge-syntax: parsed ${files.length} files, ${bad} with syntax errors`);
process.exit(bad > 0 ? 1 : 0);
