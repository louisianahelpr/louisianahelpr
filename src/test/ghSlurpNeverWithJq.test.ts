/**
 * CLASS GUARD: no `gh api` call combines `--slurp` with `--jq` / `--template`.
 *
 * gh refuses the pair outright ("the `--slurp` option is not supported with
 * `--jq` or `--template`", exit 1). On 2026-10-12 the refresh-pr action's
 * train hold (#2902, merged 19:28Z) used `gh api --paginate --slurp ... --jq`,
 * so every refresh bot with a regenerated diff went red from then on
 * (Staleness watch push runs 38297929266 .. 38317156646, Write contract
 * snapshot refresh 38304998110), and nothing it measured could land (Q1507).
 * The fix pipes the slurped pages to jq instead.
 *
 * Inventory: every `gh api` command in .github/ workflow and action YAML and
 * in tracked shell scripts, with `\`-continued lines joined and `#` comments
 * blanked (blankHashComments).
 *
 * @mutate .github/actions/refresh-pr/action.yml |               \| jq '[.[][] \| select((.head.ref |               --jq '[.[][] \| select((.head.ref
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankHashComments } from "./helpers/blankNonCode";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const files = execFileSync("git", ["ls-files", "-z", "--", ".github", "scripts"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter((f) => /^\.github\/.*\.ya?ml$/.test(f) || /^scripts\/.*\.sh$/.test(f));

/** Each `gh api` command, continuation lines joined, ending at the line end or a pipe. */
function ghApiCommands(src: string): string[] {
  const joined = blankHashComments(src).replace(/\\\n/g, " ");
  const out: string[] = [];
  const re = /\bgh\s+api\b[^\n|]*/g;
  for (let m = re.exec(joined); m; m = re.exec(joined)) out.push(m[0]);
  return out;
}

const commands = files.flatMap((f) => ghApiCommands(readFileSync(join(ROOT, f), "utf8")).map((cmd) => ({ f, cmd })));

describe("gh api: --slurp is never combined with --jq or --template", () => {
  it("inventory floor: the YAML and shell scripts hold gh api calls to read", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(commands.length).toBeGreaterThan(10);
    expect(commands.filter((c) => /\s--slurp\b/.test(c.cmd)).length).toBeGreaterThan(0);
  });

  it("no gh api command passes --slurp together with --jq/-q/--template/-t", () => {
    const bad = commands.filter((c) => /\s--slurp\b/.test(c.cmd) && /\s(--jq|-q|--template|-t)\b/.test(c.cmd));
    expect(bad.map((c) => `${c.f}: ${c.cmd.trim().slice(0, 160)}`)).toEqual([]);
  });
});
