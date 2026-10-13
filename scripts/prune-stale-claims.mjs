#!/usr/bin/env node
/**
 * Delete stale `claim/*` branches (owner, 2026-10-12: "make sure nothing can
 * be messed up so we can finish the open list smoothly").
 *
 * A lane claims queue item Q<n> by pushing `claim/Q<n>` (a ref at a main
 * commit, no work of its own) so a second lane leaves the item alone. A lane
 * that dies or finishes without deleting it leaves the item claimed for good,
 * and nobody picks it up. prune-stale-branches.mjs only reaches a branch after
 * 24 h; a claim is meant to live for one working session.
 *
 * Decision, per `claim/<token>` branch:
 *   - claimed (newest of: the tip commit's date, the ref's newest push or
 *     creation in the repository activity API) less than STALE_CLAIM_HOURS
 *     ago                                          -> KEEP (fresh)
 *   - an open PR mentions <token> (title, body or head branch; Q12 never
 *     matches Q123)                                -> KEEP (work in flight)
 *   - the tip carries commits main does not have  -> KEEP (that is work, not
 *     a claim: stranded-work.mjs and prune-stale-branches.mjs own it)
 *   - otherwise                                   -> DELETE (logged)
 *
 * Fails closed: any read that fails exits 2 BEFORE anything is deleted; a
 * claim re-pushed between the read and the delete is left alone (its tip is
 * read again just before the delete).
 *
 * READ COST, BOUNDED (lane B2, 2026-10-13): it used to make three REST calls
 * PER CLAIM (commits/<sha>, activity?ref=, compare/main...<sha>). About 130
 * claims made a run ~390 calls, and a local `until ... sleep 120` waiter on
 * it spent ~100 calls a minute of the owner's shared 5000/h (measured with
 * X-RateLimit-Used: 441 -> 779 between 01:52:39Z and 01:55:40Z), which is how
 * the budget ran out at 01:44Z. Now the tip date and the commits ahead of main
 * come from local git (the claims are fetched first), and the newest push per
 * ref from ONE paginated read of the last day's repository activity: a claim
 * with no activity in the last day was claimed over 6 h ago anyway. A run is a
 * handful of calls whatever the number of claims.
 * Guard: src/test/ghCallsNotPerItem.test.ts.
 *
 * Usage: node scripts/prune-stale-claims.mjs            # dry run, prints the table
 *        node scripts/prune-stale-claims.mjs --apply    # deletes DELETE rows
 * Runs in .github/workflows/branch-prune.yml. Guard: src/test/pruneStaleClaims.test.ts.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CLAIM_PREFIX = "claim/";
export const STALE_CLAIM_HOURS = 6;

/** True when `text` names `token` as a whole word (Q12 is not Q123, case-insensitive). */
export function mentions(text, token) {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${esc}(?![A-Za-z0-9])`, "i").test(String(text ?? ""));
}

/**
 * Pure decision.
 * @param {{name: string, sha: string, tipDate: string, lastActivity: string|null, aheadBy: number}[]} claims
 * @param {{number: number, title: string, body: string|null, head: string}[]} openPrs
 * @param {number} nowMs
 * @returns {{name: string, sha: string, decision: "DELETE"|"KEEP", reason: string}[]}
 */
export function decideClaims(claims, openPrs, nowMs) {
  return claims.map((c) => {
    const token = c.name.slice(CLAIM_PREFIX.length);
    const claimedMs = Math.max(Date.parse(c.tipDate) || 0, Date.parse(c.lastActivity ?? "") || 0);
    const ageH = (nowMs - claimedMs) / 3_600_000;
    const row = (decision, reason) => ({ name: c.name, sha: c.sha, decision, reason });
    if (!claimedMs) return row("KEEP", "claim time unreadable");
    if (!(ageH >= STALE_CLAIM_HOURS)) return row("KEEP", `fresh (${ageH.toFixed(1)} h old)`);
    const pr = openPrs.find((p) => mentions(p.title, token) || mentions(p.body, token) || mentions(p.head, token));
    if (pr) return row("KEEP", `open PR #${pr.number} mentions ${token}`);
    if (c.aheadBy > 0) return row("KEEP", `${c.aheadBy} commit(s) not on main: work, not a claim`);
    return row("DELETE", `${ageH.toFixed(1)} h old, no open PR mentions ${token}, nothing beyond main`);
  });
}

const api = (path, jq) => execFileSync("gh", ["api", ...(jq ? ["--jq", jq] : []), path], { encoding: "utf8" }).trim();
const apiPaged = (path, jq) => execFileSync("gh", ["api", "--paginate", "--jq", jq, path], { encoding: "utf8" }).trim();

const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** ref -> newest push / creation timestamp in the last day, from ONE paginated activity read. */
export function newestActivityByRef(tsv) {
  const out = new Map();
  for (const line of String(tsv).split("\n").filter(Boolean)) {
    const [ref, ts] = line.split("\t");
    if (!ref || !ts) continue;
    if (!out.has(ref) || Date.parse(ts) > Date.parse(out.get(ref))) out.set(ref, ts);
  }
  return out;
}

function readClaims() {
  // The API refuses a trailing slash; "heads/claim" also matches claimX, so filter.
  const refs = apiPaged(`repos/{owner}/{repo}/git/matching-refs/heads/${CLAIM_PREFIX.replace(/\/$/, "")}`, '.[] | [.ref, .object.sha] | @tsv');
  const claims = refs.split("\n").filter((l) => l.startsWith(`refs/heads/${CLAIM_PREFIX}`)).map((line) => {
    const [ref, sha] = line.split("\t");
    return { name: ref.replace(/^refs\/heads\//, ""), sha };
  });
  // Local git answers the tip date and the commits ahead of main (no API call
  // per claim). One fetch brings every claim tip and main.
  git(["fetch", "-q", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main", `+refs/heads/${CLAIM_PREFIX}*:refs/remotes/origin/${CLAIM_PREFIX}*`]);
  // Newest push per ref over the last day: anything older is past STALE_CLAIM_HOURS by itself.
  const activity = newestActivityByRef(apiPaged("repos/{owner}/{repo}/activity?time_period=day&per_page=100", '.[] | [.ref, .timestamp] | @tsv'));
  return claims.map(({ name, sha }) => ({
    name,
    sha,
    tipDate: git(["show", "-s", "--format=%cI", sha]),
    lastActivity: activity.get(`refs/heads/${name}`) ?? null,
    aheadBy: Number(git(["rev-list", "--count", `refs/remotes/origin/main..${sha}`])),
  }));
}

function readOpenPrs() {
  const out = apiPaged("repos/{owner}/{repo}/pulls?state=open&per_page=100", "[.[] | {number, title, body, head: .head.ref}] | .[] | @json");
  return out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function main() {
  const apply = process.argv.includes("--apply");
  let claims, prs;
  try {
    claims = readClaims();
    prs = readOpenPrs();
    for (const c of claims) if (!Number.isFinite(c.aheadBy)) throw new Error(`${c.name}: compare with main unreadable`);
  } catch (e) {
    console.log(`::error title=stale claims::could not read the claims or the open PRs; nothing deleted: ${String(e?.message ?? e).split("\n")[0]}`);
    process.exit(2);
  }
  const rows = decideClaims(claims, prs, Date.now());
  const log = [`### Stale claim/* branches (${STALE_CLAIM_HOURS} h, ${apply ? "apply" : "dry run"})`, "", "| branch | decision | why |", "|---|---|---|"];
  let failed = 0;
  for (const r of rows) {
    let decision = r.decision;
    if (decision === "DELETE" && apply) {
      try {
        const now = api(`repos/{owner}/{repo}/git/ref/heads/${r.name}`, ".object.sha");
        if (now !== r.sha) decision = "KEEP (re-pushed since the read)";
        else {
          execFileSync("gh", ["api", "-X", "DELETE", `repos/{owner}/{repo}/git/refs/heads/${r.name}`], { encoding: "utf8" });
          decision = "DELETED";
        }
      } catch (e) {
        failed++;
        decision = `DELETE FAILED: ${String(e?.message ?? e).split("\n")[0]}`;
      }
    }
    console.log(`${decision.padEnd(8)} ${r.name} @ ${r.sha.slice(0, 9)}: ${r.reason}`);
    log.push(`| ${r.name} | ${decision} | ${r.reason} |`);
  }
  console.log(`${rows.length} claim branch(es), ${rows.filter((r) => r.decision === "DELETE").length} stale.`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, log.join("\n") + "\n");
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
