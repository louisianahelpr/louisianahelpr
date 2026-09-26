/**
 * BR-024: the per-function build stamp, computed from the repo.
 *
 * A function's stamp is `<fn>@<16 hex>`: a sha256 over every file under
 * supabase/functions/<fn>/ and supabase/functions/_shared/, except the stamp
 * file itself. Those are exactly the paths .github/workflows/functions-deploy.yml
 * deploys a function for (its own directory; `_shared` promotes to deploy-all),
 * so whenever this hash changes the workflow deploys that function, and a
 * function whose served stamp differs from this value is running some other
 * build than HEAD's.
 *
 * Pure except for reading and writing files under `root`. Tested in
 * src/test/edgeBuildStamp.test.ts.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const FUNCTIONS_DIR = "supabase/functions";
export const SHARED_DIR = "_shared";
/** The one file the deploy rewrites. Excluded from the hash for that reason. */
export const STAMP_FILE = `${FUNCTIONS_DIR}/${SHARED_DIR}/buildStamp.ts`;
export const PLACEHOLDER = "unstamped";
export const BUILD_HEADER = "x-lh-build";
export const BUILD_PROBE_HEADER = "x-lh-build-probe";

const STAMP_LINE = /^const BUILD_STAMP = "[^"\n]*";$/m;

/** Every deployable function: each directory under supabase/functions except `_shared`. */
export function listFunctions(root) {
  const dir = join(root, FUNCTIONS_DIR);
  return readdirSync(dir)
    .filter((name) => name !== SHARED_DIR && !name.startsWith(".") && statSync(join(dir, name)).isDirectory())
    .sort();
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** The repo-relative files a function's stamp covers, sorted, with `/` separators. */
export function stampedFiles(root, fn) {
  const fnDir = join(root, FUNCTIONS_DIR, fn);
  if (!existsSync(fnDir)) throw new Error(`${FUNCTIONS_DIR}/${fn} does not exist`);
  const files = [...walk(fnDir), ...walk(join(root, FUNCTIONS_DIR, SHARED_DIR))]
    .map((p) => relative(root, p).split(sep).join("/"))
    .filter((p) => p !== STAMP_FILE);
  return files.sort();
}

/**
 * The `[functions.<fn>]` block of supabase/config.toml (its deploy-time
 * settings, e.g. verify_jwt), or "" when the function has none. The workflow
 * deploys every function when config.toml changes, so a config-only change
 * must move the stamp too.
 */
export function configBlock(configToml, fn) {
  const lines = configToml.split("\n");
  const start = lines.findIndex((l) => l.trim() === `[functions.${fn}]`);
  if (start < 0) return "";
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("[")) break;
    if (t === "" || t.startsWith("#")) continue;
    out.push(t);
  }
  return out.join("\n");
}

/**
 * `<fn>@<first 16 hex of sha256>` over the files `stampedFiles` names, the
 * stamp file with its literal reset to the placeholder (so a change to the
 * wrapper's LOGIC moves every stamp, while writing a stamp moves none), and the
 * function's config.toml block.
 */
export function expectedStamp(root, fn) {
  const h = createHash("sha256");
  const add = (label, content) => {
    h.update(label);
    h.update("\0");
    h.update(createHash("sha256").update(content).digest("hex"));
    h.update("\n");
  };
  for (const rel of stampedFiles(root, fn)) add(rel, readFileSync(join(root, rel)));
  add(STAMP_FILE, withStamp(readFileSync(join(root, STAMP_FILE), "utf8"), PLACEHOLDER));
  const config = join(root, "supabase/config.toml");
  add("supabase/config.toml#" + fn, existsSync(config) ? configBlock(readFileSync(config, "utf8"), fn) : "");
  return `${fn}@${h.digest("hex").slice(0, 16)}`;
}

/** Rewrite the BUILD_STAMP literal in `source` to `stamp`. Throws unless the line occurs exactly once. */
export function withStamp(source, stamp) {
  if (!/^[A-Za-z0-9_.@-]+$/.test(stamp)) throw new Error(`refusing to write an unsafe stamp: ${JSON.stringify(stamp)}`);
  const hits = source.match(new RegExp(STAMP_LINE.source, "gm")) ?? [];
  if (hits.length !== 1) throw new Error(`${STAMP_FILE} must contain exactly one BUILD_STAMP line; found ${hits.length}`);
  return source.replace(STAMP_LINE, `const BUILD_STAMP = "${stamp}";`);
}

/** Write `stamp` (default: the function's expected stamp) into the stamp file. Returns the stamp. */
export function writeStamp(root, fn, stamp = expectedStamp(root, fn)) {
  const file = join(root, STAMP_FILE);
  writeFileSync(file, withStamp(readFileSync(file, "utf8"), stamp));
  return stamp;
}

/**
 * Grade what prod answered against what HEAD says.
 * `expected`: { fn: stamp }. `observed`: { fn: stamp | null } (null = no header / probe failed).
 * Every expected function must be observed with the identical stamp.
 */
export function compareStamps(expected, observed) {
  const ok = [];
  const mismatched = [];
  for (const fn of Object.keys(expected).sort()) {
    const got = Object.prototype.hasOwnProperty.call(observed, fn) ? observed[fn] : null;
    if (got === expected[fn]) ok.push(fn);
    else mismatched.push({ fn, expected: expected[fn], observed: got ?? null });
  }
  return { ok, mismatched };
}
