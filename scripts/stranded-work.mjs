#!/usr/bin/env node
/**
 * Every place work can sit outside main, checked by CONTENT (docs/OPEN.md Q1146;
 * owner 2026-10-03: "nothing should ever be left stranded", "nothing should
 * ever be closed without merging", "it wasn't just local only work, it was
 * cloud and other places also").
 *
 *   node scripts/stranded-work.mjs                 # local + remote, human summary
 *   node scripts/stranded-work.mjs --local         # branches, worktrees (committed, uncommitted, untracked), stash entries
 *   node scripts/stranded-work.mjs --remote        # origin branches, PRs closed without merging, PRs open > 3 days
 *   node scripts/stranded-work.mjs --remote --check   # CI: exit 1 on anything not on main and not accepted
 *   node scripts/stranded-work.mjs --local --report ~/.lh-hygiene/stranded.json   # the session-start banner reads this
 *
 * "On main" is decided by scripts/lib/strandedContent.mjs (every significant
 * added line exists on main; deletions landed), never by SHA, patch-id or
 * subject. Cloud sessions and routines push `claude/*` branches and open PRs,
 * so the remote half covers them; work that never left a cloud container
 * cannot be seen from here, which is why every cloud prompt must push.
 *
 * Remote items that are deliberately not landed go in
 * docs/audit/stranded-accepted.json with the reason and the open item that
 * carries the decision; the list is exact both ways (an entry whose ref is gone
 * or moved fails too). PRs closed before --since (default 2026-10-03, the day
 * the rule started) were triaged by hand: docs/audit/stranded-triage-2026-10-03.md.
 * Exit: 0 clean, 1 stranded or a stale acceptance (--check), 2 could not look.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildMainIndex, unlandedContent } from "./lib/strandedContent.mjs";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const MAIN = opt("--main", "origin/main");
const SINCE = opt("--since", "2026-10-03T00:00:00Z");
const STALE_OPEN_PR_HOURS = Number(opt("--stale-hours", "72"));
const ACCEPTED_PATH = join(ROOT, "docs/audit/stranded-accepted.json");
const doLocal = flag("--local") || !flag("--remote");
const doRemote = flag("--remote") || !flag("--local");
/** Untracked files that are evidence or build output, never work. */
const UNTRACKED_NOISE = [/\.(png|jpe?g|webp|log|trace|zip)$/i, /(^|\/)\.DS_Store$/, /^node_modules$/, /(^|\/)test-results\//, /(^|\/)playwright-report\//, /(^|\/)dist\//];

export function makeGit(cwd) {
  return (argv, o = {}) => execFileSync("git", argv, {
    cwd, encoding: "utf8", maxBuffer: 1 << 30, input: o.input, env: { ...process.env, ...(o.env ?? {}), GIT_OPTIONAL_LOCKS: "0" },
    stdio: [o.input ? "pipe" : "ignore", "pipe", "pipe"],
  });
}

/** Branches, worktrees and stash entries on this machine. */
export function localInventory(git, mainIndex, { cwdOf = defaultCwds } = {}) {
  const out = [];
  const check = (kind, id, ref, extra = {}) => {
    const r = unlandedContent(git, ref, MAIN_REF(), mainIndex);
    if (r.stranded) out.push({ kind, id, sha: git(["rev-parse", ref]).trim(), missing: r.missing, removedStill: r.removedStill, files: r.files.map((f) => f.file), ...extra });
  };
  const branchTips = new Set();
  for (const name of git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]).split("\n").filter(Boolean)) {
    if (name === "main" || name === "master") continue;
    branchTips.add(git(["rev-parse", name]).trim());
    if (Number(git(["rev-list", "--count", `${MAIN_REF()}..${name}`]).trim()) === 0) continue;
    check("branch", `branch:${name}`, name);
  }
  const active = cwdOf();
  for (const wt of parseWorktrees(git(["worktree", "list", "--porcelain"]))) {
    if (!existsSync(wt.path)) continue;
    const isActive = active.some((c) => c === wt.path || c.startsWith(wt.path + "/"));
    const wgit = makeGit(wt.path);
    if (wt.detached && !branchTips.has(wt.head) && Number(git(["rev-list", "--count", `${MAIN_REF()}..${wt.head}`]).trim()) > 0) {
      check("detached-head", `worktree:${wt.path}@HEAD`, wt.head, { active: isActive });
    }
    const status = wgit(["status", "--porcelain", "--untracked-files=all"]).split("\n").filter(Boolean);
    const untracked = status.filter((l) => l.startsWith("?? ")).map((l) => l.slice(3)).filter((f) => !UNTRACKED_NOISE.some((re) => re.test(f)));
    if (status.some((l) => !l.startsWith("?? "))) {
      const snap = snapshotTracked(wgit, wt.head);
      if (snap) check("uncommitted", `worktree:${wt.path}@uncommitted`, snap, { active: isActive });
    }
    if (untracked.length) out.push({ kind: "untracked", id: `worktree:${wt.path}@untracked`, sha: null, missing: untracked.length, removedStill: 0, files: untracked.slice(0, 20), active: isActive });
  }
  for (const line of git(["stash", "list", "--format=%H %gs"]).split("\n").filter(Boolean)) {
    const [sha, ...msg] = line.split(" ");
    check("stash", `stash:${sha.slice(0, 12)}`, sha, { note: msg.join(" ") });
  }
  return out;
}

/** origin branches, PRs closed without merging since SINCE, PRs open too long. */
export function remoteInventory(git, mainIndex, gh = defaultGh) {
  const out = [];
  const open = gh(["pr", "list", "--state", "open", "--limit", "200", "--json", "number,headRefOid,headRefName,createdAt,title,author"]);
  // A branch an open PR carries is tracked by that PR (and by the stale-PR check below).
  const openHeads = new Set(open.map((p) => `origin/${p.headRefName}`));
  for (const name of git(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"]).split("\n").filter(Boolean)) {
    if (/^origin(\/HEAD|\/main)?$/.test(name) || openHeads.has(name)) continue;
    if (Number(git(["rev-list", "--count", `${MAIN_REF()}..${name}`]).trim()) === 0) continue;
    const r = unlandedContent(git, name, MAIN_REF(), mainIndex);
    if (r.stranded) out.push({ kind: "remote-branch", id: `remote:${name}`, sha: git(["rev-parse", name]).trim(), missing: r.missing, removedStill: r.removedStill, files: r.files.map((f) => f.file) });
  }
  const closed = gh(["pr", "list", "--state", "closed", "--limit", "500", "--search", `closed:>=${SINCE.slice(0, 10)}`,
    "--json", "number,headRefOid,mergedAt,closedAt,author,title,headRefName"]);
  for (const pr of closed.filter((p) => !p.mergedAt && p.closedAt >= SINCE && !/dependabot/i.test(p.author?.login ?? ""))) {
    const ref = `refs/stranded/pr/${pr.number}`;
    try { git(["fetch", "-q", "origin", `+refs/pull/${pr.number}/head:${ref}`]); } catch { /* deleted fork head: checked below */ }
    let r;
    try { r = unlandedContent(git, ref, MAIN_REF(), mainIndex); } catch { r = { stranded: true, missing: -1, removedStill: 0, files: [] }; }
    if (r.stranded) out.push({ kind: "closed-unmerged-pr", id: `pr:${pr.number}`, sha: pr.headRefOid, missing: r.missing, removedStill: r.removedStill, files: r.files.map((f) => f.file), note: pr.title });
  }
  const now = Date.now();
  for (const pr of open) {
    const hours = (now - Date.parse(pr.createdAt)) / 3_600_000;
    if (hours > STALE_OPEN_PR_HOURS && !/dependabot/i.test(pr.author?.login ?? "")) {
      out.push({ kind: "stale-open-pr", id: `pr:${pr.number}`, sha: pr.headRefOid, missing: 0, removedStill: 0, files: [], note: `${pr.title} (open ${Math.round(hours)}h)` });
    }
  }
  return out;
}

/** Which remote items are not accepted, and which acceptances no longer match anything (exact both ways). */
export function judge(items, accepted) {
  const key = (x) => `${x.id}@${x.sha}`;
  const acceptedKeys = new Set(accepted.map(key));
  const itemKeys = new Set(items.map(key));
  return {
    unaccepted: items.filter((i) => !acceptedKeys.has(key(i))),
    stale: accepted.filter((a) => !itemKeys.has(key(a))),
  };
}

export function parseWorktrees(porcelain) {
  const wts = [];
  let cur = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) { cur = { path: line.slice(9), head: null, detached: false }; wts.push(cur); }
    else if (cur && line.startsWith("HEAD ")) cur.head = line.slice(5);
    else if (cur && line === "detached") cur.detached = true;
  }
  return wts;
}

/** A commit object holding the worktree's tracked files as they are now (a temp index; the real one is untouched). */
function snapshotTracked(wgit, head) {
  const dir = mkdtempSync(join(tmpdir(), "lh-stranded-"));
  const env = { GIT_INDEX_FILE: join(dir, "index") };
  try {
    wgit(["read-tree", head], { env });
    wgit(["add", "-u", "."], { env });
    const tree = wgit(["write-tree"], { env }).trim();
    const who = { GIT_AUTHOR_NAME: "stranded-work", GIT_AUTHOR_EMAIL: "stranded-work@localhost", GIT_COMMITTER_NAME: "stranded-work", GIT_COMMITTER_EMAIL: "stranded-work@localhost" };
    return wgit(["commit-tree", tree, "-p", head, "-m", "stranded-work snapshot (not on any ref)"], { env: { ...env, ...who } }).trim();
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function defaultCwds() {
  try {
    return execFileSync("lsof", ["-a", "-d", "cwd", "-Fn"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n").filter((l) => l.startsWith("n")).map((l) => l.slice(1));
  } catch {
    return [];
  }
}
function defaultGh(argv) {
  return JSON.parse(execFileSync("gh", argv, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] }));
}
let mainRefOverride = null;
const MAIN_REF = () => mainRefOverride ?? MAIN;
export function setMainRef(r) { mainRefOverride = r; }

function summarize(items) {
  return items.map((i) => `  ${i.kind.padEnd(19)} ${i.id}${i.active ? " (in use)" : ""}: ${i.kind === "untracked" ? `${i.missing} untracked file(s)` : i.kind === "stale-open-pr" ? i.note : `${i.missing} line(s) not on main${i.removedStill ? `, ${i.removedStill} deleted line(s) still there` : ""}`}${i.files.length ? ` [${i.files.slice(0, 4).join(", ")}${i.files.length > 4 ? ", …" : ""}]` : ""}`).join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const git = makeGit(ROOT);
  try {
    if (!flag("--no-fetch")) git(["fetch", "-q", "--prune", "origin"]);
    const index = buildMainIndex(git, MAIN);
    const local = doLocal ? localInventory(git, index) : [];
    const remote = doRemote ? remoteInventory(git, index) : [];
    const accepted = existsSync(ACCEPTED_PATH) ? JSON.parse(readFileSync(ACCEPTED_PATH, "utf8")).accepted ?? [] : [];
    const { unaccepted, stale } = judge(remote, accepted);
    const report = { checkedAt: new Date().toISOString(), main: git(["rev-parse", MAIN]).trim(), local, remote: unaccepted, acceptedRemote: remote.length - unaccepted.length, staleAcceptances: stale };
    const reportPath = opt("--report", null);
    if (reportPath) { mkdirSync(dirname(reportPath), { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n"); }
    if (flag("--json")) console.log(JSON.stringify(report, null, 2));
    else {
      const idle = local.filter((i) => !i.active);
      console.log(`Stranded work (not on ${MAIN} by content):`);
      if (doLocal) console.log(`local: ${idle.length} item(s)${local.length > idle.length ? ` (+${local.length - idle.length} in a worktree something is using now)` : ""}\n${summarize(local)}`);
      if (doRemote) console.log(`remote: ${unaccepted.length} not accepted, ${remote.length - unaccepted.length} accepted, ${stale.length} stale acceptance(s)\n${summarize(unaccepted)}${stale.length ? `\n  stale acceptances (ref gone or moved): ${stale.map((s) => s.id).join(", ")}` : ""}`);
    }
    if (flag("--check") && (unaccepted.length || stale.length || (doLocal && local.some((i) => !i.active)))) {
      console.log("::error title=Stranded work::work that is not on main and not landed or accepted; land it (bash scripts/land.sh), or record why in docs/audit/stranded-accepted.json with its open item");
      process.exit(1);
    }
  } catch (e) {
    console.error(`stranded-work could not look: ${e.message.split("\n")[0]}`);
    process.exit(2);
  }
}
