/**
 * A `gh pr list` / `gh issue list` read as a whole set is read whole (Q1693).
 *
 * gh lists newest first and stops at `--limit` (default 30). The land queue
 * read its PRs with `--limit 50` while 94 were queued (2026-10-12), so the
 * oldest were invisible and the "head" was the oldest of the newest 50: it
 * moved every time a new PR joined, no head kept its runners long enough to
 * merge, and main went 3 h without a merge. The same cap sat on the stranded
 * check (open PRs, 200 of 142 and climbing), the alert feeds and land.sh's
 * superseded-PR sweep (no limit at all: 30).
 *
 * Rule: every pr/issue list call in scripts/ and .github/workflows/ passes a
 * limit of at least 1000, unless it is an exact-title lookup (`in:title`),
 * where one match is the whole answer.
 *
 * @mutate scripts/land-queue.mjs | export const GH_LIST_LIMIT = 1000; | export const GH_LIST_LIMIT = 50;
 * @mutate scripts/lib/landGh.mjs | api("pulls?state=open&per_page=100", "--paginate", "--slurp").flat() | api("pulls?state=open&per_page=100")
 * @mutate scripts/stranded-work.mjs | "pr", "list", "--state", "open", "--limit", "1000" | "pr", "list", "--state", "open", "--limit", "200"
 * @mutate .github/workflows/nightly-red-age.yml | --limit 1000 \ | --limit 100 \
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments, blankHashComments } from "./helpers/blankNonCode";
// @ts-expect-error — plain .mjs script, no declaration file
import { GH_LIST_LIMIT } from "../../scripts/land-queue.mjs";

const ROOT = join(__dirname, "..", "..");
const MIN = 1000;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(rel));
    else if (/\.(mjs|cjs|js|ts|sh|ya?ml)$/.test(e.name)) out.push(rel);
  }
  return out;
}

type Call = { file: string; line: number; text: string };

/** Every pr/issue list call with the text of its arguments. */
function listCalls(file: string, src: string): Call[] {
  const shell = /\.(sh|ya?ml)$/.test(file);
  const code = shell ? blankHashComments(src) : blankComments(src);
  const calls: Call[] = [];
  const re = shell ? /\bgh\s+(?:pr|issue)\s+list\b/g : /["'](?:pr|issue)["']\s*,\s*["']list["']/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    let end: number;
    if (shell) {
      // The command runs to the first line that does not end in a backslash.
      end = m.index;
      for (;;) {
        const nl = code.indexOf("\n", end);
        if (nl < 0) { end = code.length; break; }
        if (!/\\\s*$/.test(code.slice(end, nl))) { end = nl; break; }
        end = nl + 1;
      }
    } else {
      end = code.indexOf("]", m.index);
      if (end < 0) end = code.length;
    }
    calls.push({ file, line: code.slice(0, m.index).split("\n").length, text: code.slice(m.index, end) });
  }
  return calls;
}

function limitOf(text: string): number | null {
  const m = /(?:--limit|-L)["']?\s*(?:[=,]\s*)?["']?(?:String\()?\s*([A-Z_0-9]+)/.exec(text);
  if (!m) return null;
  if (m[1] === "GH_LIST_LIMIT") return GH_LIST_LIMIT;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : null;
}

const files = [...walk("scripts"), ...walk(".github/workflows")];
const calls = files.flatMap((f) => listCalls(f, readFileSync(join(ROOT, f), "utf8")));

describe("pr/issue list reads are whole (Q1693)", () => {
  it("finds the list calls it guards", () => {
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.some((c) => c.file === "scripts/land-queue.mjs")).toBe(true);
    expect(calls.some((c) => c.file === "scripts/land-queue.mjs")).toBe(true);
  });

  // land.sh reads its open land/** PRs through scripts/lib/landGh.mjs (REST,
  // so it also runs in a cloud session): that read takes every page.
  it("land.sh's open-PR read through landGh.mjs takes every page", () => {
    const land = blankHashComments(readFileSync(join(ROOT, "scripts/land.sh"), "utf8"));
    expect(land).toContain('node "$LAND_FROZEN_DIR/landGh.mjs" open-land-prs');
    const gh = blankComments(readFileSync(join(ROOT, "scripts/lib/landGh.mjs"), "utf8"));
    expect(gh).toMatch(/api\("pulls\?state=open&per_page=100", "--paginate", "--slurp"\)\.flat\(\)/);
  });

  it("every set read passes --limit >= 1000 (exact-title lookups excepted)", () => {
    const short = calls
      .filter((c) => !/in:title/.test(c.text))
      .filter((c) => (limitOf(c.text) ?? 30) < MIN)
      .map((c) => `${c.file}:${c.line} limit ${limitOf(c.text) ?? "none (gh default 30)"}`);
    expect(short).toEqual([]);
  });

  it("the land queue refuses a partial read rather than pick a head from it", () => {
    expect(GH_LIST_LIMIT).toBeGreaterThanOrEqual(MIN);
    const src = blankComments(readFileSync(join(ROOT, "scripts/land-queue.mjs"), "utf8"));
    expect(src).toMatch(/list\.length >= GH_LIST_LIMIT\) throw/);
  });

  it("the parser reads limits the way gh does", () => {
    expect(limitOf('"pr", "list", "--limit", "50"')).toBe(50);
    expect(limitOf("gh pr list --state open -L 30")).toBe(30);
    expect(limitOf("gh pr list --limit=1000")).toBe(1000);
    expect(limitOf("gh pr list --state open --json number")).toBeNull();
    expect(listCalls("x.sh", "gh pr list \\\n  --limit 5 \\\n  --json n\necho done").map((c) => limitOf(c.text))).toEqual([5]);
  });
});
