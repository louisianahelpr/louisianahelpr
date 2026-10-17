#!/usr/bin/env node
/**
 * Landing claims: which session is landing which branch (owner, 2026-10-17:
 * "how do we check everything so you don't keep missing stuff"; the 10-15
 * case: a branch two sessions both meant to land sat 20 h because each
 * thought the other had it).
 *
 * WHERE THE CLAIMS LIVE. A file ON MAIN cannot hold a live claim: writing it
 * would need a PR to main per claim, and every concurrent landing would edit
 * the same file and go DIRTY. So the claims file (CLAIMS_PATH inside the tree)
 * is committed on its own ref on origin, CLAIMS_REF (refs/lh/landing-claims),
 * and every write is a compare-and-swap push (--force-with-lease on the sha
 * that was read), retried on a lost race. GitHub accepts refs/lh/* pushes
 * (measured 2026-10-17: a probe ref pushed and deleted). Nothing that lists
 * branches reads refs/lh/* (stranded-work, prune-stale-branches and
 * prune-git-hygiene list refs/heads and refs/remotes/origin; the fetch below
 * writes refs/lh/landing-claims locally, never under refs/remotes/):
 * src/test/landClaims.test.ts proves it on a fixture.
 *
 * Shape: { version: 1, claims: { <branch>: { owner_session, since, updated,
 * pr, contenders?: [{ session, at }], overridden?: { from, from_since,
 * reason, at } } } }. A missing ref means "no claims".
 *
 *   node scripts/lib/landClaims.mjs claim <branch> [--override "<reason>"]   # land.sh, on start
 *   node scripts/lib/landClaims.mjs check <branch>                           # land.sh --dry-run
 *   node scripts/lib/landClaims.mjs set-pr <branch> <pr>                     # land.sh, once the PR exists
 *   node scripts/lib/landClaims.mjs release <branch>                         # land.sh, merged or closed
 *   node scripts/lib/landClaims.mjs list [--json]                            # anyone
 *
 * The owner session is $CLAUDE_SESSION, else $CLAUDE_CODE_BRIDGE_SESSION_ID,
 * else the newest Claude-Session trailer on origin/main..HEAD, else
 * local:<host>:<worktree>. Exit: 0 done (or the store could not be reached:
 * warned loudly, carries on, so no landing breaks on it), 1 refused (another
 * session holds the claim), 3 usage.
 *
 * Self-contained (node built-ins only): land.sh runs it from its frozen copy.
 */
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { resolve } from "node:path";

export const CLAIMS_REF = "refs/lh/landing-claims";
export const CLAIMS_PATH = "docs/audit/landing-claims.json";
const REMOTE = "origin";
const MAX_TRIES = 5;

export function emptyClaims() {
  return { version: 1, claims: {} };
}

/** Tolerant read of the claims file: absent or empty = no claims; anything else must be the right shape. */
export function parseClaims(text) {
  if (text == null || !String(text).trim()) return emptyClaims();
  const j = JSON.parse(text);
  if (!j || typeof j !== "object" || typeof j.claims !== "object" || j.claims === null || Array.isArray(j.claims)) {
    throw new Error(`${CLAIMS_PATH} is not { claims: { <branch>: {...} } }`);
  }
  return { version: 1, ...j, claims: { ...j.claims } };
}

/** `https://claude.ai/code/session_ABC` and `session_ABC` are the same session. */
export function sessionId(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const m = /\b(session_[A-Za-z0-9]+)\b/.exec(s);
  return m ? m[1] : s;
}

export function resolveSession({ env = process.env, trailers = [], cwd = process.cwd(), host = hostname() } = {}) {
  return sessionId(env.CLAUDE_SESSION) || sessionId(env.CLAUDE_CODE_BRIDGE_SESSION_ID) ||
    sessionId(trailers.find((t) => sessionId(t))) || `local:${host}:${cwd}`;
}

/**
 * Pure: what a claim attempt does to the state.
 * verdict: claimed (new) | renewed (same session again) | overridden (another
 * session's claim taken, with a reason) | refused (another session holds it;
 * this session is recorded as a contender so the sweep can flag it).
 */
export function decide(state, branch, session, { override = "", now = new Date().toISOString() } = {}) {
  const next = { ...state, claims: { ...state.claims } };
  const held = state.claims[branch];
  if (!held) {
    next.claims[branch] = { owner_session: session, since: now, updated: now, pr: null };
    return { verdict: "claimed", state: next, holder: next.claims[branch] };
  }
  if (held.owner_session === session) {
    next.claims[branch] = { ...held, updated: now };
    return { verdict: "renewed", state: next, holder: next.claims[branch] };
  }
  if (String(override).trim()) {
    next.claims[branch] = {
      owner_session: session, since: now, updated: now, pr: null,
      overridden: { from: held.owner_session, from_since: held.since, reason: String(override).trim(), at: now },
    };
    return { verdict: "overridden", state: next, holder: next.claims[branch], previous: held };
  }
  const contenders = (held.contenders ?? []).filter((c) => c.session !== session);
  contenders.push({ session, at: now });
  next.claims[branch] = { ...held, contenders };
  return { verdict: "refused", state: next, holder: held };
}

/** Pure: record the PR on this session's claim (a claim the start could not write is made here). */
export function withPr(state, branch, pr, session, now = new Date().toISOString()) {
  const held = state.claims[branch];
  if (held && held.owner_session !== session) return { changed: false, state };
  const base = held ?? { owner_session: session, since: now, pr: null };
  return { changed: true, state: { ...state, claims: { ...state.claims, [branch]: { ...base, pr: Number(pr), updated: now } } } };
}

/** Pure: drop this session's claim (never another session's). */
export function withoutClaim(state, branch, session) {
  const held = state.claims[branch];
  if (!held || held.owner_session !== session) return { changed: false, state };
  const claims = { ...state.claims };
  delete claims[branch];
  return { changed: true, state: { ...state, claims } };
}

export function makeGit(cwd) {
  return (argv, o = {}) => execFileSync("git", argv, {
    cwd, encoding: "utf8", input: o.input, maxBuffer: 1 << 26,
    stdio: [o.input != null ? "pipe" : "ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...(o.env ?? {}) },
  });
}

/** Read the claims ref from origin. Missing ref = no claims. Throws when origin cannot be asked. */
export function readStore(git) {
  const line = git(["ls-remote", REMOTE, CLAIMS_REF]).trim();
  if (!line) return { sha: null, state: emptyClaims() };
  const sha = line.split(/\s+/)[0];
  git(["fetch", "-q", "--no-tags", REMOTE, `+${CLAIMS_REF}:${CLAIMS_REF}`]);
  let text = null;
  try { text = git(["show", `${sha}:${CLAIMS_PATH}`]); } catch { text = null; /* a ref without the file: no claims */ }
  return { sha, state: parseClaims(text) };
}

/** Commit the state on CLAIMS_REF (parent: the sha read) and push it only if origin still has that sha. */
export function writeStore(git, state, oldSha, message) {
  const blob = git(["hash-object", "-w", "--stdin"], { input: JSON.stringify(state, null, 2) + "\n" }).trim();
  const audit = git(["mktree"], { input: `100644 blob ${blob}\tlanding-claims.json\n` }).trim();
  const docs = git(["mktree"], { input: `040000 tree ${audit}\taudit\n` }).trim();
  const root = git(["mktree"], { input: `040000 tree ${docs}\tdocs\n` }).trim();
  const who = { GIT_AUTHOR_NAME: "land-claims", GIT_AUTHOR_EMAIL: "land-claims@localhost", GIT_COMMITTER_NAME: "land-claims", GIT_COMMITTER_EMAIL: "land-claims@localhost" };
  const commit = git(["commit-tree", root, ...(oldSha ? ["-p", oldSha] : []), "-m", message], { env: who }).trim();
  git(["-c", "core.hooksPath=/dev/null", "push", "-q", "--no-verify", `--force-with-lease=${CLAIMS_REF}:${oldSha ?? ""}`, REMOTE, `${commit}:${CLAIMS_REF}`]);
  return commit;
}

/** Read, change, compare-and-swap; a lost race is read again (MAX_TRIES). */
export function mutate(git, change, message) {
  let lastErr = null;
  for (let i = 0; i < MAX_TRIES; i++) {
    const { sha, state } = readStore(git);
    const r = change(state);
    if (!r.changed) return r;
    try {
      writeStore(git, r.state, sha, message);
      return r;
    } catch (e) {
      lastErr = e; // stale lease: someone wrote between our read and push; read again
    }
  }
  throw lastErr ?? new Error("landing claims: write failed");
}

function hoursSince(iso, now = Date.now()) {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? Math.round(((now - t) / 3_600_000) * 10) / 10 : null;
}

/** The plain table every session sees (land.sh refusals and `npm run sweep`). */
export function formatClaims(state, now = Date.now()) {
  const rows = Object.entries(state.claims).sort(([a], [b]) => a.localeCompare(b));
  if (!rows.length) return "landing claims: none";
  return ["landing claims:", ...rows.map(([b, c]) =>
    `  ${b}  owner ${c.owner_session}  since ${c.since} (${hoursSince(c.since, now)} h)  ${c.pr ? `PR #${c.pr}` : "no PR yet"}` +
    `${c.contenders?.length ? `  ALSO TRIED BY ${c.contenders.map((x) => x.session).join(", ")}` : ""}` +
    `${c.overridden ? `  (taken over from ${c.overridden.from}: ${c.overridden.reason})` : ""}`)].join("\n");
}

function trailersOnRange(git) {
  try {
    return git(["log", "--format=%(trailers:key=Claude-Session,valueonly,separator=%x0a)", "origin/main..HEAD"])
      .split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function warn(what, e) {
  console.error(`land: WARNING: the landing claims (${CLAIMS_REF}) could not be ${what}: ${String(e?.message ?? e).split("\n")[0]}`);
  console.error("land: WARNING: carrying on WITHOUT a claim; another session will not see that this branch is being landed.");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [cmd, branch, ...rest] = process.argv.slice(2);
  const git = makeGit(process.cwd());
  const session = resolveSession({ trailers: trailersOnRange(git) });
  const oi = rest.indexOf("--override");
  const override = oi >= 0 ? rest[oi + 1] ?? "" : "";
  if (oi >= 0 && !String(override).trim()) {
    console.error("land: --claim-override needs a reason (--claim-override=\"<why this session takes the branch>\").");
    process.exit(3);
  }
  const refusal = (holder) => {
    console.error(`land: REFUSED: ${branch} is being landed by another session: ${holder.owner_session}, since ${holder.since}${holder.pr ? `, PR #${holder.pr}` : ""} (this session: ${session}).`);
    console.error("land: leave it to that session, or, if it has stopped, re-run with --claim-override=\"<reason>\" (recorded on the claim).");
  };
  if (cmd === "list") {
    try {
      const { state } = readStore(git);
      console.log(rest.includes("--json") || branch === "--json" ? JSON.stringify(state, null, 2) : formatClaims(state));
    } catch (e) {
      console.error(`landing claims could not be read: ${String(e?.message ?? e).split("\n")[0]}`);
      process.exit(2);
    }
    process.exit(0);
  }
  if (!branch || !["claim", "check", "set-pr", "release"].includes(cmd)) {
    console.error("usage: landClaims.mjs claim|check|set-pr|release|list <branch> [--override <reason>] [<pr>]");
    process.exit(3);
  }
  if (cmd === "check") {
    let r;
    try { r = decide(readStore(git).state, branch, session, { override }); } catch (e) { warn("read", e); process.exit(0); }
    if (r.verdict === "refused") { refusal(r.holder); process.exit(1); }
    console.log(`land: claim check: ${branch} is free for this session (${session}); --dry-run writes no claim.`);
    process.exit(0);
  }
  if (cmd === "claim") {
    let r;
    try {
      r = mutate(git, (state) => { const d = decide(state, branch, session, { override }); return { ...d, changed: true }; }, `claim ${branch} for ${session}`);
    } catch (e) { warn("written", e); process.exit(0); }
    if (r.verdict === "refused") { refusal(r.holder); process.exit(1); }
    if (r.verdict === "overridden") console.log(`land: took the claim on ${branch} from ${r.previous.owner_session} (reason: ${override}).`);
    else console.log(`land: ${r.verdict} ${branch} for ${session} (${CLAIMS_REF}).`);
    process.exit(0);
  }
  if (cmd === "set-pr") {
    const pr = rest[0];
    try { mutate(git, (s) => withPr(s, branch, pr, session), `PR #${pr} for ${branch}`); } catch (e) { warn("written", e); }
    process.exit(0);
  }
  if (cmd === "release") {
    try { mutate(git, (s) => withoutClaim(s, branch, session), `release ${branch}`); console.log(`land: released the claim on ${branch}.`); } catch (e) { warn("written", e); }
    process.exit(0);
  }
}
