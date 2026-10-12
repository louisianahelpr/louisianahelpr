/**
 * Which `deno` binary `npm run typecheck:edge` runs (docs/OPEN.md Q1718).
 *
 * The edge half of `npm run typecheck` needs Deno. A Mac with Deno and CI
 * (denoland/setup-deno in test.yml) have it on PATH; a Claude Code cloud
 * session does not, so every cloud lane's pre-push typecheck went red on
 * "Deno is not installed" (found 2026-10-12 landing the land.sh REST change).
 *
 * So: PATH first; otherwise the PINNED `deno` npm package (denoland's own,
 * which ships the native binary as a per-platform optional dependency) is
 * installed once into a cache directory OUTSIDE the repo and used from there.
 * Nothing is skipped: when neither works this returns null and the caller
 * fails, as it always has. The npm registry is reachable wherever `npm ci`
 * ran, which is every place this script runs.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** deno@<this> from npm. CI's setup-deno takes the newest v2.x; keep this a 2.x too. */
export const PINNED_DENO = "2.9.6";

/** Where the npm fallback lives: $LH_DENO_CACHE, else ~/.cache/lh-deno/<version>. */
export function denoCacheDir(env = process.env, home = homedir()) {
  return env.LH_DENO_CACHE || path.join(home, ".cache", "lh-deno", PINNED_DENO);
}

const defaultRuns = (bin) => {
  try {
    execFileSync(bin, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    // Not runnable (absent, wrong platform, broken install): the caller tries the next source.
    return false;
  }
};

const defaultInstall = (dir) =>
  spawnSync(
    "npm",
    ["install", "--no-save", "--no-audit", "--no-fund", "--no-package-lock", "--prefix", dir, `deno@${PINNED_DENO}`],
    { stdio: ["ignore", "inherit", "inherit"] },
  ).status === 0;

/**
 * Returns `{ bin, source }` (source "path" or "npm"), or null when no Deno can
 * be run. `runs`, `install` and `exists` are injectable for the unit test.
 */
export function resolveDeno({
  env = process.env,
  home = homedir(),
  runs = defaultRuns,
  install = defaultInstall,
  exists = existsSync,
  log = (m) => console.error(m),
} = {}) {
  if (runs("deno")) return { bin: "deno", source: "path" };
  const dir = denoCacheDir(env, home);
  const bin = path.join(dir, "node_modules", ".bin", process.platform === "win32" ? "deno.cmd" : "deno");
  if (!exists(bin)) {
    log(`Deno is not on PATH: installing the pinned deno@${PINNED_DENO} from npm into ${dir} (once).`);
    if (!install(dir)) return null;
  }
  return runs(bin) ? { bin, source: "npm" } : null;
}
