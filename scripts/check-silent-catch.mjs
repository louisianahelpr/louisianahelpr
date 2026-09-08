#!/usr/bin/env node
/**
 * Sweep src/ with the `no-silent-catch` rule ALONE.
 *
 * WHY THIS EXISTS SEPARATELY FROM ESLINT
 * The rule ships in eslint.config.js and blocks via lint-staged, which is the
 * enforcement path. But this repo runs many agent lanes against one worktree,
 * and the house rule is that only one of them may run the full `npm run lint`
 * gate at a time. A lane that wants to check ONLY this rule — before a commit,
 * or while sweeping — should not have to queue behind a whole-repo lint. This
 * runner loads the single rule through ESLint's Linter API, so the verdict is
 * identical to the gate's without the contention.
 *
 *   node scripts/check-silent-catch.mjs                # sweep src/
 *   node scripts/check-silent-catch.mjs <file> [...]   # specific files
 *   node scripts/check-silent-catch.mjs --list         # paths only, for piping
 *
 * Exits non-zero when anything is reported.
 */
import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import rule from "./eslint-rules/no-silent-catch.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Tests are exempt for the same reason eslint.config.js exempts them: a spec
    that swallows on purpose is asserting the swallow, not committing one. */
const EXEMPT = /\.test\.tsx?$|\.spec\.tsx?$|[\\/]__mocks__[\\/]|[\\/]src[\\/]test[\\/]/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !EXEMPT.test(p)) {
      out.push(p);
    }
  }
  return out;
}

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const explicit = args.filter((a) => !a.startsWith("--"));
const targets = explicit.length
  ? explicit.map((f) => join(repoRoot, f)).filter((f) => !EXEMPT.test(f))
  : walk(join(repoRoot, "src"));

const linter = new Linter({ configType: "flat" });
const config = {
  // Flat config matches by glob; without `files` the Linter reports
  // "No matching configuration found" at line 0 and silently checks nothing.
  files: ["**/*.{ts,tsx}"],
  languageOptions:{ parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { local: { rules: { "no-silent-catch": rule } } },
  rules: { "local/no-silent-catch": "error" },
};

let count = 0;
const perFile = new Map();
for (const file of targets) {
  const messages = linter.verify(readFileSync(file, "utf8"), config, file);
  if (!messages.length) continue;
  const rel = relative(repoRoot, file);
  perFile.set(rel, messages.map((m) => m.line));
  count += messages.length;
}

if (listOnly) {
  for (const [file, lines] of perFile) for (const l of lines) console.log(`${file}:${l}`);
} else {
  for (const [file, lines] of perFile) {
    console.log(`${file}  →  ${lines.length} silent catch${lines.length === 1 ? "" : "es"} at line${lines.length === 1 ? "" : "s"} ${lines.join(", ")}`);
  }
  console.log(
    `\n${count} silent catch${count === 1 ? "" : "es"} across ${perFile.size} file${perFile.size === 1 ? "" : "s"} ` +
      `(${targets.length} scanned).`,
  );
  if (count) {
    console.log(
      "\nEach one must either leave a trace — report() from @/lib/errorLogger, a rethrow,\n" +
        "a toast — or carry a comment INSIDE the catch saying why silence is correct here.",
    );
  }
}

process.exit(count ? 1 : 0);
