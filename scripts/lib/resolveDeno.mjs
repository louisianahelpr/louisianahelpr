/**
 * Which Deno the edge type check runs.
 *
 * A Deno on PATH wins (developer Macs, CI's denoland/setup-deno). Without one,
 * the official npm build of Deno (`deno` on npm, published by denoland, one
 * binary per platform as optional dependencies) is run through npx at a
 * pinned version. Claude Code cloud sessions do not install Deno, so before
 * this `npm run typecheck` was red in every one of them (found 2026-10-12)
 * and the cloud lanes could not run the pre-push typecheck at all.
 *
 * Returns null only when neither works; the caller then fails loudly (the
 * edge check never skips silently).
 *
 * Guard: src/test/edgeTypecheckFindsDeno.test.ts.
 */
import { execFileSync } from "node:child_process";

/** The npm build used when no Deno is on PATH. CI pins setup-deno to v2.x. */
export const PINNED_NPM_DENO = "2.9.6";

/**
 * @param {{ exec?: typeof execFileSync, platform?: string }} [deps]
 * @returns {{ cmd: string, pre: string[], via: "path" | "npm" } | null}
 */
export function resolveDeno(deps = {}) {
  const exec = deps.exec ?? execFileSync;
  const platform = deps.platform ?? process.platform;
  try {
    exec("deno", ["--version"], { stdio: "ignore" });
    return { cmd: "deno", pre: [], via: "path" };
  } catch {
    // No Deno on PATH: fall through to the pinned npm build.
  }
  const npx = platform === "win32" ? "npx.cmd" : "npx";
  const pre = ["--yes", `deno@${PINNED_NPM_DENO}`];
  try {
    // First use downloads the platform binary (one time, then npx's cache).
    exec(npx, [...pre, "--version"], { stdio: "ignore", timeout: 600_000 });
    return { cmd: npx, pre, via: "npm" };
  } catch {
    // Neither works (offline, or a platform the npm build does not ship): the caller fails loudly.
    return null;
  }
}
