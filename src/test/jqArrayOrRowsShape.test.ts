/**
 * Q60 (2026-10-06): the load test's cleanup proof read `supabase db query -o json`
 * with `jq -r '.rows[0].n // .[0].n'`. The CLI printed a bare array, and jq
 * raises on `.rows` of an array BEFORE `//` can fall back, so the step died
 * (exit 5) although the cleanup had worked (0 tagged rows, measured live).
 *
 * The class: any jq program in a workflow, composite action or script that
 * tries `.rows...` with a `//` fallback. Branch on `type` instead:
 *   if type == "array" then .[0].n else .rows[0].n end
 *
 * @mutate .github/workflows/load-test.yml | jq -r 'if type == "array" then .[0].n else .rows[0].n end' | jq -r '.rows[0].n // .[0].n'
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const files = execFileSync("git", ["ls-files", ".github", "scripts"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ya?ml|sh|mjs|js)$/.test(f));

const BROKEN = /\.rows\b[^'"\n]*\/\/\s*\.\[/;

describe("jq never falls back from .rows with // (it raises on an array first)", () => {
  it("scans the workflows, actions and scripts", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(".github/workflows/load-test.yml");
  });

  it("no jq program tries .rows with a // fallback", () => {
    const hits = files.filter((f) => BROKEN.test(readFileSync(join(ROOT, f), "utf8")));
    expect(hits, 'use: if type == "array" then .[0].n else .rows[0].n end').toEqual([]);
  });

  it("the load test's cleanup proof branches on the output's type", () => {
    expect(readFileSync(join(ROOT, ".github/workflows/load-test.yml"), "utf8")).toContain(`jq -r 'if type == "array" then .[0].n else .rows[0].n end'`);
  });
});
