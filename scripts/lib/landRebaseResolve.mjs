/**
 * Resolve the conflicts a land.sh rebase stops on, so seven lanes landing at
 * once do not each stop and loop (owner, 2026-10-07: "how do we stop the
 * land.sh failed loops"). During a stopped rebase, for every conflicted file:
 *
 *   1. docs/OPEN.md and docs/archive/OPEN-done-*.md: an item-level merge
 *      (./openItemMerge.mjs) that keeps BOTH sides' items, takes a side's
 *      text for an item only it changed, keeps a tick when either side
 *      ticked, and appends notes. Archive files first; a note on an item the
 *      other side archived is appended to its archived line.
 *   2. A GENERATED file (scripts/check-generated-current.mjs GENERATED
 *      outputs): main's copy; land.sh regenerates every one after the rebase.
 *   3. An exact-count constant (`const NAME = 123;` in a test, the hunk made
 *      of that line and comments): main's value with both sides' comments, and
 *      the file is recorded; ./landRecount.mjs measures the real value on the
 *      rebased tree and writes it.
 * Anything else is left for a person: exit 1, naming the file.
 *
 *   node scripts/lib/landRebaseResolve.mjs   # exit 0 = every conflicted file resolved and staged
 *
 * Guard: src/test/landRebaseResolve.test.ts (a real git rebase in a sandbox).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appendArchiveNotes, mergeQueueText } from "./openItemMerge.mjs";

const git = (args, opts = {}) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });

export const ARCHIVE = /^docs\/archive\/OPEN-done-[^/]+\.md$/;
const COUNT_LINE = /^\s*(?:export\s+)?const ([A-Z][A-Z0-9_]*) = (\d+);\s*$/;
const COMMENT = /^\s*(?:\/\/|\/\*|\*|$)/;

function stage(n, file, cwd) {
  try {
    return git(["show", `:${n}:${file}`], { cwd, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null; // no such stage: the file is new or deleted on that side
  }
}

/**
 * Resolve a file's conflict hunks when every hunk is one exact-count constant
 * (the same NAME on both sides) plus comment lines. Returns the resolved text
 * and the constants touched, or null when any hunk is something else.
 */
export function resolveCountHunks(text) {
  const lines = text.split("\n");
  const out = [];
  const names = [];
  let any = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("<<<<<<< ")) {
      out.push(lines[i]);
      continue;
    }
    any = true;
    const sec = { ours: [], base: [], theirs: [] };
    let cur = "ours";
    for (i++; i < lines.length && !lines[i].startsWith(">>>>>>> "); i++) {
      if (lines[i].startsWith("||||||| ")) cur = "base";
      else if (lines[i] === "=======") cur = "theirs";
      else sec[cur].push(lines[i]);
    }
    const constOf = (ls) => ls.filter((l) => !COMMENT.test(l));
    const co = constOf(sec.ours), ct = constOf(sec.theirs);
    if (co.length !== 1 || ct.length !== 1) return null;
    const mo = COUNT_LINE.exec(co[0]), mt = COUNT_LINE.exec(ct[0]);
    if (!mo || !mt || mo[1] !== mt[1]) return null;
    const keep = new Set(sec.ours);
    const comments = [...sec.ours.filter((l) => COMMENT.test(l)), ...sec.theirs.filter((l) => COMMENT.test(l) && !keep.has(l) && l.trim() !== "")];
    out.push(...comments, co[0]);
    names.push(mo[1]);
  }
  return any ? { text: out.join("\n"), names } : null;
}

/** Read a file, or `fallback` when it is not there: one call, no exists-then-read race. */
function readOr(path, fallback) {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return fallback;
    throw e;
  }
}
const readJsonOr = (path, fallback) => {
  const text = readOr(path, null);
  return text === null ? fallback : JSON.parse(text);
};

export function generatedOutputs(generated) {
  const set = new Set();
  for (const g of generated) for (const o of g.outputs ?? []) if (o !== "docs/OPEN.md" && !ARCHIVE.test(o)) set.add(o);
  return set;
}

export async function resolveAll({ cwd = process.cwd(), log = console.log } = {}) {
  const unmerged = git(["diff", "--name-only", "--diff-filter=U"], { cwd }).split("\n").filter(Boolean);
  if (!unmerged.length) return { resolved: [], left: [] };
  // From the tree being rebased when it has one (land.sh runs a frozen copy
  // of this script from a temp dir), else the one beside this file.
  const inTree = join(cwd, "scripts", "check-generated-current.mjs");
  const { GENERATED } = existsSync(inTree)
    ? await import(/* @vite-ignore */ pathToFileURL(inTree).href)
    : await import("../check-generated-current.mjs");
  const generated = generatedOutputs(GENERATED);
  const gitPath = git(["rev-parse", "--git-path", "land-recount.json"], { cwd }).trim();
  const recordPath = isAbsolute(gitPath) ? gitPath : join(cwd, gitPath);
  const record = readJsonOr(recordPath, []);
  const resolved = [];
  const left = [];
  const notes = [];
  // archives before OPEN.md, so notes for items OPEN.md drops have their line
  const order = [...unmerged].sort((a, b) => (ARCHIVE.test(b) ? 1 : 0) - (ARCHIVE.test(a) ? 1 : 0) || (a === "docs/OPEN.md" ? 1 : 0) - (b === "docs/OPEN.md" ? 1 : 0));
  for (const file of order) {
    if (file === "docs/OPEN.md" || ARCHIVE.test(file)) {
      const r = mergeQueueText({ base: stage(1, file, cwd) ?? "", ours: stage(2, file, cwd) ?? "", theirs: stage(3, file, cwd) ?? "" });
      if (!r) {
        left.push(file);
        continue;
      }
      writeFileSync(`${cwd}/${file}`, r.text);
      notes.push(...r.archiveNotes);
      git(["add", "--", file], { cwd });
      resolved.push(`${file} (items merged)`);
    } else if (generated.has(file)) {
      if (stage(2, file, cwd) === null) git(["rm", "-q", "--", file], { cwd });
      else {
        git(["checkout", "--ours", "--", file], { cwd });
        git(["add", "--", file], { cwd });
      }
      resolved.push(`${file} (generated: main's copy, regenerated after the rebase)`);
    } else if (/\.(ts|tsx|mjs|js)$/.test(file) && readOr(`${cwd}/${file}`, null) !== null) {
      const r = resolveCountHunks(readOr(`${cwd}/${file}`, ""));
      if (!r) {
        left.push(file);
        continue;
      }
      writeFileSync(`${cwd}/${file}`, r.text);
      git(["add", "--", file], { cwd });
      for (const name of r.names) if (!record.some((x) => x.file === file && x.name === name)) record.push({ file, name });
      resolved.push(`${file} (count ${r.names.join(", ")}: main's value now, measured after the rebase)`);
    } else left.push(file);
  }
  if (notes.length) {
    const archives = git(["ls-files", "docs/archive"], { cwd }).split("\n").filter((f) => ARCHIVE.test(f));
    let pending = notes;
    for (const a of archives) {
      if (!pending.length) break;
      const r = appendArchiveNotes(readFileSync(`${cwd}/${a}`, "utf8"), pending);
      if (r.unplaced.length !== pending.length) {
        writeFileSync(`${cwd}/${a}`, r.text);
        git(["add", "--", a], { cwd });
      }
      pending = r.unplaced;
    }
    if (pending.length) {
      log(`landRebaseResolve: ${pending.length} note(s) for archived items found no archived line: ${pending.map((p) => `${p.q}: ${p.note}`).join(" | ")}`);
      left.push("docs/OPEN.md (a note for an archived item could not be placed)");
    }
  }
  if (record.length) writeFileSync(recordPath, JSON.stringify(record, null, 1));
  for (const r of resolved) log(`landRebaseResolve: ${r}`);
  for (const f of left) log(`landRebaseResolve: NOT resolved, needs a person: ${f}`);
  return { resolved, left };
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const { left } = await resolveAll();
  process.exit(left.length ? 1 : 0);
}
