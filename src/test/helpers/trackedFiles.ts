// The ONE way a test lists what is under src/ (docs/OPEN.md Q1142).
//
// A test that walks src/ with the filesystem's own readdirSync sees whatever
// happens to be on disk at that instant. vacuityGate.test.ts writes
// src/test/fixtures/q136Control-*.ts for a few milliseconds (it has to sit in an
// ordinary src/ folder to prove Tailwind scans it), and a test that listed the
// tree in another worker, then read what it listed, threw ENOENT when the file
// vanished: retiredApprovalReads.test.ts, 2026-10-03, a local 2-thread run. The
// edge harness's transient `*.gen.ts` modules (see walkSource.ts) are the same
// hazard. Raising a timeout does not help, the file is gone.
//
// Source that a guard should read is source git tracks. So a directory under
// src/ is listed from the git index (`git ls-files`), never from the disk: a
// transient fixture, a build artifact or an editor's scratch file is not in it,
// and nothing in it can vanish between the listing and the read. A directory
// outside src/ (supabase/migrations, .github/workflows, scripts) passes through
// to the real readdirSync untouched.
//
// What that costs: a brand-new file is listed only once it is `git add`ed (the
// index counts), so a guard run before staging does not see it. CI and every
// commit hook run after staging.
//
// Guard: src/test/noSrcDirectoryWalksInTests.test.ts fails on a new raw
// readdirSync of src/ in a test or helper.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { relative, resolve, sep } from "node:path";

const REPO = resolve(__dirname, "../../..");

let index: { files: Set<string>; dirs: Set<string> } | null = null;

/** Every tracked path under src/ (files and their directories), from the git index, once per module load. */
function trackedIndex() {
  if (index) return index;
  const out = execFileSync("git", ["ls-files", "-z", "--", "src"], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 });
  const files = new Set(out.split("\0").filter(Boolean));
  const dirs = new Set<string>();
  for (const f of files) for (let i = f.indexOf("/"); i !== -1; i = f.indexOf("/", i + 1)) dirs.add(f.slice(0, i));
  if (files.size === 0) throw new Error("git ls-files found nothing under src/: not a git checkout, or the index is empty");
  return (index = { files, dirs });
}

/** Tracked files under `dir` (repo-relative, default src), as repo-relative POSIX paths, sorted, that exist on disk. */
export function trackedFiles(dir = "src"): string[] {
  const { files } = trackedIndex();
  const prefix = dir.replace(/\/+$/, "") + "/";
  return [...files].filter((f) => f.startsWith(prefix) && fs.existsSync(resolve(REPO, f))).sort();
}

type Dirent = fs.Dirent;
type Options = { encoding?: BufferEncoding | null; withFileTypes?: boolean; recursive?: boolean } | BufferEncoding | null;

/**
 * Drop-in for node:fs readdirSync. Under src/ it returns only what git tracks;
 * elsewhere it is the real thing. A directory that does not exist still throws.
 */
export function readdirSync(path: fs.PathLike, options?: { encoding?: BufferEncoding | null; withFileTypes?: false; recursive?: boolean } | BufferEncoding | null): string[];
export function readdirSync(path: fs.PathLike, options: { encoding?: BufferEncoding | null; withFileTypes: true; recursive?: boolean }): Dirent[];
export function readdirSync(path: fs.PathLike, options?: Options): string[] | Dirent[] {
  const real = fs.readdirSync(path, options as never) as unknown as (string | Dirent)[];
  const rel = relative(REPO, resolve(String(path))).split(sep).join("/");
  if (rel !== "src" && !rel.startsWith("src/")) return real as string[] | Dirent[];
  const { files, dirs } = trackedIndex();
  const nameOf = (e: string | Dirent) => (typeof e === "string" ? e : e.name);
  // recursive: true lists nested entries as relative paths, withFileTypes keeps the bare name + parentPath.
  const keep = (e: string | Dirent) => {
    const child = typeof e === "string" ? `${rel}/${e.split(sep).join("/")}` : `${relative(REPO, resolve(String(e.parentPath ?? path))).split(sep).join("/")}/${nameOf(e)}`;
    return files.has(child) || dirs.has(child);
  };
  return real.filter(keep) as string[] | Dirent[];
}
