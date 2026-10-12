/**
 * The edge type check runs where no Deno is installed (found 2026-10-12:
 * `npm run typecheck` was red in every Claude Code cloud session because
 * typecheck:edge refused without a `deno` on PATH, so the cloud lanes could
 * not run the brief's pre-push typecheck).
 *
 * (a) resolveDeno: a Deno on PATH wins; without one, the official npm build at
 *     the pinned version runs through npx; with neither, null (the caller
 *     fails loudly, never skips).
 * (b) scripts/typecheck-edge.mjs runs EVERY deno command through the resolver:
 *     no bare "deno" spawn is left to fail in a cloud session.
 *
 * Proven end to end on 2026-10-12: with PATH stripped of both Deno installs,
 * `node scripts/typecheck-edge.mjs` ran the npm build and checked every edge
 * file (the run's numbers are in the commit message).
 *
 * @mutate scripts/lib/resolveDeno.mjs |     return { cmd: npx, pre, via: "npm" }; |     return null;
 * @mutate scripts/typecheck-edge.mjs | const run = deno(["check", "--config", CONFIG, ...files], { | const run = spawnSync("deno", ["check", "--config", CONFIG, ...files], {
 * @mutate scripts/typecheck-edge.mjs |     const probe = deno(["check", "--config", CONFIG, canary], { |     const probe = spawnSync("deno", ["check", "--config", CONFIG, canary], {
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { resolveDeno, PINNED_NPM_DENO } from "../../scripts/lib/resolveDeno.mjs";

const ROOT = resolve(__dirname, "..", "..");

/** A fake execFileSync: `ok` names the commands that succeed; records every call. */
function fakeExec(ok: string[]) {
  const calls: Array<[string, string[]]> = [];
  const exec = (cmd: string, args: string[]) => {
    calls.push([cmd, args]);
    if (!ok.includes(cmd)) throw new Error(`${cmd}: not found`);
    return "";
  };
  return { exec, calls };
}

describe("(a) resolveDeno", () => {
  it("a Deno on PATH wins, and npx is never tried", () => {
    const f = fakeExec(["deno", "npx"]);
    expect(resolveDeno({ exec: f.exec, platform: "darwin" })).toEqual({ cmd: "deno", pre: [], via: "path" });
    expect(f.calls.map((c) => c[0])).toEqual(["deno"]);
  });

  it("no Deno on PATH: the pinned npm build through npx", () => {
    const f = fakeExec(["npx"]);
    const d = resolveDeno({ exec: f.exec, platform: "linux" });
    expect(d).toEqual({ cmd: "npx", pre: ["--yes", `deno@${PINNED_NPM_DENO}`], via: "npm" });
    expect(f.calls[1]).toEqual(["npx", ["--yes", `deno@${PINNED_NPM_DENO}`, "--version"]]);
  });

  it("the pin is an exact version (a range would let a new Deno change what type-checks)", () => {
    expect(PINNED_NPM_DENO).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Number(PINNED_NPM_DENO.split(".")[0])).toBeGreaterThanOrEqual(2);
  });

  it("neither works: null, so the caller fails loudly", () => {
    const f = fakeExec([]);
    expect(resolveDeno({ exec: f.exec, platform: "linux" })).toBeNull();
    expect(f.calls.length).toBe(2);
  });
});

describe("(b) typecheck-edge runs every deno command through the resolver", () => {
  const src = blankComments(readFileSync(join(ROOT, "scripts", "typecheck-edge.mjs"), "utf8"));

  it("no bare deno spawn or exec is left", () => {
    expect(src).not.toMatch(/(spawnSync|execFileSync|execSync|spawn)\(\s*["'`]deno["'`]/);
  });

  it("both deno check runs (the Stripe canary and the full check) go through it", () => {
    const checks = src.match(/\bdeno\(\["check"/g) ?? [];
    expect(checks.length).toBe(2);
    expect(src).toMatch(/const DENO = resolveDeno\(\);/);
    expect(src).toMatch(/spawnSync\(DENO\.cmd, \[\.\.\.DENO\.pre, \.\.\.args\]/);
  });
});
