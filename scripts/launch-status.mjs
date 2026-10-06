#!/usr/bin/env node
/**
 * The launch list as it stands on origin/main, measured, never remembered
 * (owner, 2026-10-06: "this happens nearly every day" — a status report said
 * 26 items only needed a prod check when half were not built).
 *
 *   node scripts/launch-status.mjs              # table from origin/main (fetches first)
 *   node scripts/launch-status.mjs --file PATH  # table from a local OPEN.md, no git
 *   node scripts/launch-status.mjs --stale-hours 2
 *        exit 3 when the "Launch list: N left" count on main has not dropped
 *        for that long (the progress clock pings the owner on it)
 *
 * Every open launch item is printed under the ONE thing it waits on, read from
 * the <!-- launch-waits-on --> block in docs/OPEN.md. An open item with no
 * waits-on line, or a waits-on Q that is not on the list, exits 1.
 * Guard: src/test/launchWaitsOn.test.ts.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { launchListProgress, LAUNCH_LIST_START, LAUNCH_LIST_END } from "./scoreboard.mjs";

export const WAITS_ON_START = "<!-- launch-waits-on -->";
export const WAITS_ON_END = "<!-- /launch-waits-on -->";

/** Q numbers between the launch-list markers, in order. */
export function launchListIds(openText) {
  const i = openText.indexOf(LAUNCH_LIST_START), j = openText.indexOf(LAUNCH_LIST_END);
  if (i < 0 || j < i) return [];
  return [...new Set(openText.slice(i, j).match(/\bQ\d+\b/g) ?? [])];
}

/** `- <category>: Q1 Q2 ...` lines between the waits-on markers -> Map(Q -> category). */
export function parseWaitsOn(openText) {
  const i = openText.indexOf(WAITS_ON_START), j = openText.indexOf(WAITS_ON_END);
  const map = new Map(), dupes = [];
  if (i < 0 || j < i) return { map, dupes, present: false };
  for (const line of openText.slice(i + WAITS_ON_START.length, j).split("\n")) {
    const m = /^- \*\*([a-z-]+)\*\*[^:]*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    for (const q of m[2].match(/\bQ\d+\b/g) ?? []) {
      if (map.has(q)) dupes.push(q);
      map.set(q, m[1]);
    }
  }
  return { map, dupes, present: true };
}

/** State of each listed Q: " " to do, "~" partly, "done" when it has no open line. */
export function itemStates(openText, ids) {
  const out = new Map();
  for (const q of ids) {
    const m = new RegExp(`^- \\[(.)\\] \\*\\*${q}\\b`, "m").exec(openText);
    out.set(q, m ? m[1] : "done");
  }
  return out;
}

/** Problems that make the table untrustworthy (exit 1). */
export function waitsOnProblems(openText) {
  const ids = launchListIds(openText);
  const states = itemStates(openText, ids);
  const { map, dupes, present } = parseWaitsOn(openText);
  const problems = [];
  if (!present) problems.push(`no ${WAITS_ON_START} block in docs/OPEN.md`);
  for (const q of dupes) problems.push(`${q} is listed under two waits-on categories`);
  for (const q of ids) if (states.get(q) !== "done" && !map.has(q)) problems.push(`${q} is open on the launch list but has no waits-on line`);
  for (const q of map.keys()) if (!ids.includes(q)) problems.push(`${q} has a waits-on line but is not on the launch list`);
  return problems;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/** Newest commit on origin/main where "Launch list: N left" went DOWN, as {at, from, to, sha}. */
export function lastDrop(ref = "origin/main") {
  const log = git(["log", ref, "-n", "80", "-G", "Launch list: [0-9]+ left", "--format=%H %cI", "--", "docs/OPEN.md"]).trim().split("\n").filter(Boolean);
  const vals = log.map((l) => {
    const [sha, at] = l.split(" ");
    let n = null;
    try { n = Number(/Launch list: (\d+) left/.exec(git(["show", `${sha}:docs/OPEN.md`]))?.[1] ?? NaN); } catch { /* the file did not exist at that commit */ }
    return { sha, at, n };
  });
  for (let k = 0; k < vals.length - 1; k++) {
    if (Number.isFinite(vals[k].n) && Number.isFinite(vals[k + 1].n) && vals[k].n < vals[k + 1].n) {
      return { at: vals[k].at, from: vals[k + 1].n, to: vals[k].n, sha: vals[k].sha.slice(0, 9) };
    }
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  const fileArg = args.indexOf("--file");
  const staleArg = args.indexOf("--stale-hours");
  let text, source;
  if (fileArg >= 0) {
    text = readFileSync(args[fileArg + 1], "utf8");
    source = args[fileArg + 1];
  } else {
    try { execFileSync("git", ["fetch", "-q", "origin", "main"], { stdio: "ignore" }); } catch { /* offline: read the last fetched main */ }
    text = git(["show", "origin/main:docs/OPEN.md"]);
    source = `origin/main ${git(["rev-parse", "--short=9", "origin/main"]).trim()}`;
  }
  const p = launchListProgress(text);
  if (!p) { console.error("launch-status: no launch-list block in docs/OPEN.md"); process.exit(1); }
  const ids = launchListIds(text);
  const states = itemStates(text, ids);
  const { map } = parseWaitsOn(text);
  const groups = new Map();
  for (const q of ids) {
    const st = states.get(q);
    if (st === "done") continue;
    const cat = map.get(q) ?? "(no waits-on line)";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(`${q}${st === "~" ? " [~ built]" : " [ ]"}`);
  }
  const done = ids.filter((q) => states.get(q) === "done");
  console.log(`Launch list (${source}): ${p.left} left of ${p.total} (${p.todo} to do, ${p.partly} built awaiting proof)`);
  console.log(`  done (${done.length}): ${done.join(" ") || "-"}`);
  for (const [cat, qs] of groups) console.log(`  waits on ${cat} (${qs.length}): ${qs.join(", ")}`);
  let rc = 0;
  const problems = waitsOnProblems(text);
  for (const pr of problems) { console.log(`  PROBLEM: ${pr}`); rc = 1; }
  if (fileArg < 0) {
    const drop = lastDrop();
    const hours = drop ? (Date.now() - Date.parse(drop.at)) / 3.6e6 : Infinity;
    console.log(drop ? `  last drop: ${drop.from} -> ${drop.to} at ${drop.at} (${hours.toFixed(1)} h ago, ${drop.sha})` : "  last drop: none in the last 80 count changes");
    if (staleArg >= 0 && hours > Number(args[staleArg + 1])) {
      console.log(`  STALE: no drop in ${hours.toFixed(1)} h (limit ${args[staleArg + 1]} h)`);
      if (rc === 0) rc = 3;
    }
  }
  process.exit(rc);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
