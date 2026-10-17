/**
 * A filesystem walk that cannot be killed by one bad entry.
 *
 * The review tooling walks ~/.lh-shots and test-results/, which hold copied
 * Xcode DerivedData (relative symlinks that point nowhere once moved) and
 * leftovers like ~/.lh-shots/stale-bundle/current (a link to a deleted dist).
 * `statSync()` follows links, so one dangling link threw ENOENT and crashed
 * `npm run review:report` (2026-10-17). This walk:
 *   - reports a dangling link in `broken` instead of throwing;
 *   - reports an unreadable directory in `broken` instead of throwing;
 *   - follows a symlinked directory once, and reports a cycle in `cycles`
 *     instead of recursing forever (directories are keyed by realpath).
 *
 * Every walk in the review tooling must go through here
 * (src/test/reviewToolingToleratesBrokenLinks.test.ts).
 */
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {string} root
 * @param {(path: string) => boolean} [keep]  which files to return (default: all)
 * @returns {{ files: string[], broken: { path: string, reason: string }[], cycles: string[] }}
 */
export function walkFiles(root, keep = () => true) {
  const files = [];
  const broken = [];
  const cycles = [];
  const seen = new Set();
  const visit = (dir) => {
    let real;
    try { real = realpathSync.native(dir); } catch (e) { broken.push({ path: dir, reason: e.code || String(e) }); return; }
    if (seen.has(real)) { cycles.push(dir); return; }
    seen.add(real);
    let names;
    try { names = readdirSync(dir); } catch (e) { broken.push({ path: dir, reason: e.code || String(e) }); return; }
    for (const name of names) {
      const p = join(dir, name);
      let st;
      try { st = statSync(p); } catch (e) { broken.push({ path: p, reason: e.code || String(e) }); continue; }
      if (st.isDirectory()) visit(p);
      else if (keep(p)) files.push(p);
    }
  };
  if (existsSync(root)) visit(root);
  return { files, broken, cycles };
}
