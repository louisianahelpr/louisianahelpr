/*
 * CLASS GUARD (nightly-red #2912, write-contract-refresh run 38304998110,
 * 2026-10-12): every `gh api` call in a workflow, composite action or script
 * uses a flag combination gh itself accepts.
 *
 * The train hold in .github/actions/refresh-pr/action.yml counted open
 * land-queue PRs with `gh api --paginate --slurp ... --jq '...'`. gh rejects
 * that at flag-parse time ("the `--slurp` option is not supported with `--jq`
 * or `--template`") and exits 1 before any request, so every refresh bot that
 * holds for trains (write-contract-refresh first) went red on its first run.
 * refreshBotsWaitForTrains.test.ts read the block's TEXT and stayed green:
 * nothing executed it.
 *
 * The rules are the ones gh 2.x enforces before it sends anything (measured
 * locally with gh 2.102.0, each one prints its error with no network call):
 *   1. `--slurp` with `--jq`/`-q`/`--template`/`-t`  -> "not supported"
 *   2. `--slurp` without `--paginate`                 -> "`--paginate` required"
 *   3. `--paginate` with `-X`/`--method` other than GET -> "not supported for non-GET"
 *
 * Inventory: every `gh api` shell command (workflows, actions, .sh, and the
 * template strings in scripts; a quoted word is one word, so a `-q` inside a jq
 * program is never read as a flag) plus every JS argument list that passes
 * "--slurp" (scripts/lib/landGh.mjs, scripts/owner-needed.mjs).
 */
// @mutate .github/actions/refresh-pr/action.yml | \| jq '[.[][] | --jq '[.[][]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankHashComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");

const files = execFileSync("git", ["ls-files", "-z", "--", ".github", "scripts"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter((f) => /\.(ya?ml|sh|bash|mjs|cjs|js|ts)$/.test(f));

const isJs = (f: string) => /\.(mjs|cjs|js|ts)$/.test(f);

/**
 * The shell command that starts at `start` (the `g` of `gh api`): read up to an
 * unquoted `|`, `;`, `&`, newline (a `\` continuation joins lines), a backtick,
 * or the `)` that closes the `$(` it sits in. Returns its words with the quotes
 * removed; a quoted span never splits a word.
 */
export function shellWords(text: string, start: number): string[] {
  const words: string[] = [];
  let cur = "";
  let q: string | null = null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === "\\" && q === '"') cur += text[++i] ?? "";
      else if (ch === q) q = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      continue;
    }
    if (ch === "\\" && text[i + 1] === "\n") {
      i++;
      if (cur) words.push(cur);
      cur = "";
      continue;
    }
    if (ch === "$" && text[i + 1] === "(") depth++;
    if (ch === ")") {
      if (depth === 0) break;
      depth--;
    }
    if (ch === "|" || ch === ";" || ch === "&" || ch === "\n" || ch === "`") break;
    if (/\s/.test(ch)) {
      if (cur) words.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words;
}

/** What gh would refuse about this flag list, or null. Each list starts after `gh api`. */
export function ghApiRefusal(words: readonly string[]): string | null {
  const has = (...names: string[]) => words.some((w) => names.some((n) => w === n || w.startsWith(`${n}=`)));
  const slurp = has("--slurp");
  const paginate = has("--paginate");
  if (slurp && has("--jq", "-q", "--template", "-t")) return "--slurp with --jq/--template";
  if (slurp && !paginate) return "--slurp without --paginate";
  if (paginate) {
    const i = words.findIndex((w) => w === "-X" || w === "--method");
    const inline = words.find((w) => /^(-X|--method=)./.test(w));
    const method = (i >= 0 ? words[i + 1] : inline?.replace(/^(-X|--method=)/, "")) ?? "GET";
    if (!/^["']?GET["']?$/i.test(method)) return `--paginate with -X ${method}`;
  }
  return null;
}

type Call = { file: string; line: number; words: string[] };

function shellCalls(): Call[] {
  const out: Call[] = [];
  for (const f of files) {
    const raw = readFileSync(join(ROOT, f), "utf8");
    const text = isJs(f) ? blankComments(raw) : blankHashComments(raw);
    for (const m of text.matchAll(/(^|[\s$(`"'])gh\s+api\b/g)) {
      const at = m.index + m[1].length;
      const after = at + m[0].length - m[1].length;
      out.push({ file: f, line: text.slice(0, at).split("\n").length, words: shellWords(text, after) });
    }
  }
  return out;
}

/** JS argument lists (the innermost `[...]` or `(...)`) that pass "--slurp" to gh. */
function jsSlurpCalls(): Call[] {
  const out: Call[] = [];
  for (const f of files.filter(isJs)) {
    const text = blankComments(readFileSync(join(ROOT, f), "utf8"));
    for (const m of text.matchAll(/["']--slurp["']/g)) {
      let lo = m.index;
      let depth = 0;
      for (; lo > 0; lo--) {
        const ch = text[lo - 1];
        if (ch === "]" || ch === ")") depth++;
        else if (ch === "[" || ch === "(") {
          if (depth === 0) break;
          depth--;
        }
      }
      const close = text[lo - 1] === "[" ? "]" : ")";
      const hi = text.indexOf(close, m.index);
      const args = [...text.slice(lo, hi).matchAll(/["'`]([^"'`]*)["'`]/g)].map((a) => a[1]);
      out.push({ file: f, line: text.slice(0, m.index).split("\n").length, words: args });
    }
  }
  return out;
}

describe("every gh api call uses a flag combination gh accepts (nightly-red #2912)", () => {
  const shell = shellCalls();
  const js = jsSlurpCalls();

  it("finds the gh api calls (inventory floor)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(shell.length).toBeGreaterThan(15);
    expect(shell.filter((c) => c.words.includes("--slurp")).length).toBeGreaterThan(0);
    expect(js.length).toBeGreaterThan(1);
  });

  it("the refusal rules match what gh 2.102.0 refuses", () => {
    expect(ghApiRefusal(["--paginate", "--slurp", "x", "--jq", "q"])).toMatch(/--jq/);
    expect(ghApiRefusal(["--paginate", "--slurp", "-q", "q", "x"])).toMatch(/--jq/);
    expect(ghApiRefusal(["--slurp", "x"])).toMatch(/without --paginate/);
    expect(ghApiRefusal(["--paginate", "-X", "POST", "x"])).toMatch(/POST/);
    expect(ghApiRefusal(["--paginate", "--slurp", "x"])).toBeNull();
    expect(ghApiRefusal(["--paginate", "x", "--jq", "q"])).toBeNull();
    expect(ghApiRefusal(["-X", "POST", "x", "-f", "a=b"])).toBeNull();
    // The parser stops at the pipe, so a `| jq` after the call is not a flag of it.
    const t = `T=$(gh api --paginate --slurp "repos/a" \\\n  | jq '.[][] | length')`;
    expect(shellWords(t, t.indexOf("gh api") + 6)).toEqual(["--paginate", "--slurp", "repos/a"]);
  });

  it.each([...shell, ...js].map((c) => [`${c.file}:${c.line}`, c] as const))("%s", (_where, c) => {
    expect(ghApiRefusal(c.words), c.words.join(" ")).toBeNull();
  });
});
