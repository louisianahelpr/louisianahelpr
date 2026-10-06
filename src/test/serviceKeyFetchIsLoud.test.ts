/**
 * CLASS GUARD (nightly-red #2353, press-every-control 37403674178): no workflow
 * fetches the service-role key with the CLI's stderr thrown away.
 *
 * `KEY=$(supabase projects api-keys ... 2>/dev/null | jq ...)` under
 * `set -euo pipefail`: when the CLI call failed (legs 3, 4 and 6 of that run,
 * 07:30-07:46Z, while leg 2 at 06:37Z had fetched the same key), pipefail
 * ended the step with exit 1 and NOT ONE line saying why: the step's own
 * "service_role key not returned" error never ran. Built from the workflow
 * files: every `projects api-keys` invocation must keep its stderr (to the log
 * or to a file the step prints), never /dev/null.
 */
// @mutate .github/workflows/loading-states-refresh.yml | -o json 2>api-keys.err); then | -o json 2>/dev/null); then
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const WF = resolve(__dirname, "../../.github/workflows");

/** Each `projects api-keys` command with its continuation lines joined, per file:line. */
export function apiKeyCalls(text: string): { line: number; cmd: string }[] {
  const lines = text.split("\n");
  const out: { line: number; cmd: string }[] = [];
  lines.forEach((l, i) => {
    if (/^\s*#/.test(l) || !/projects api-keys/.test(l)) return;
    let cmd = l;
    for (let j = i; /\\\s*$/.test(lines[j]) && j + 1 < lines.length; j++) cmd += "\n" + lines[j + 1];
    out.push({ line: i + 1, cmd });
  });
  return out;
}

const files = readdirSync(WF).filter((f) => /\.ya?ml$/.test(f));
const calls = files.flatMap((f) => apiKeyCalls(readFileSync(join(WF, f), "utf8")).map((c) => ({ ...c, file: f })));

describe("service-role key fetches are loud (#2353)", () => {
  it("finds the key fetches it guards", () => {
    expect(calls.length).toBeGreaterThan(15);
  });

  it("no key fetch throws its stderr away", () => {
    const silent = calls.filter((c) => /2>\s*\/dev\/null/.test(c.cmd)).map((c) => `${c.file}:${c.line}`);
    expect(silent, "keep the CLI's stderr: under pipefail a failed fetch otherwise ends the step with no message").toEqual([]);
  });

  it("reads a continued command whole", () => {
    expect(apiKeyCalls('KEY=$(supabase projects api-keys -o json \\\n  2>/dev/null | jq .)')[0].cmd).toMatch(/2>\/dev\/null/);
  });
});
