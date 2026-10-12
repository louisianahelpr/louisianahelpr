#!/usr/bin/env node
/**
 * The ONE inbox for owner decisions (owner order 2026-10-12). An agent that
 * needs the owner files a GitHub issue labelled `owner-needed` instead of only
 * writing "OWNER NEEDED" in its report.
 *
 *   node scripts/owner-needed.mjs file --q Q123 --title "<one plain question>" \
 *        --option "<recommended option>" --option "<other>" [--option "<third>"]
 *       Title = one plain-English question. Body = 2-3 options, the recommended
 *       one first, plus the Q number. Refuses jargon (see JARGON) and refuses to
 *       file the same Q number twice (open OR closed: an answered question is
 *       not asked again).
 *   node scripts/owner-needed.mjs list      open owner-needed issues as JSON
 *   node scripts/owner-needed.mjs answer <issue> <choice>   comment + close
 *
 * REST only (`gh api`); the cloud sandbox 403s GraphQL. Repo comes from
 * GITHUB_REPOSITORY or the origin remote.
 */
import { execFileSync } from "node:child_process";

export const LABEL = "owner-needed";

/** Words the owner does not know. Allowed only when explained in brackets right after. */
export const JARGON = [
  "RLS", "RPC", "migration", "idempotent", "webhook", "digest", "schema", "payload",
  "cron", "edge function", "endpoint", "regression", "race condition", "SHA", "CI",
  "enum", "trigger", "backfill", "ledger", "ratchet", "baseline",
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Jargon terms in `text` that are not followed by a bracketed explanation. */
export function jargonIn(text) {
  const found = [];
  for (const term of JARGON) {
    // Whole word only; a bracketed explanation of 6+ characters right after excuses it.
    const flags = term === term.toUpperCase() ? "" : "i";
    const re = new RegExp(`(?<![A-Za-z])${esc(term)}(?![A-Za-z])(?!\\s*\\([^)]{6,}\\))`, flags);
    if (re.test(text)) found.push(term);
  }
  return found;
}

export function normalizeQ(q) {
  const m = /^Q?(\d+)$/i.exec(String(q ?? "").trim());
  return m ? `Q${m[1]}` : null;
}

export const marker = (q) => `<!-- owner-needed:${q} -->`;

/** Validate a request; returns an error string or null. */
export function checkQuestion({ q, title, options }) {
  if (!normalizeQ(q)) return "--q must be a Q number such as Q123";
  if (!title || title.trim().length < 10) return "--title must be one plain question";
  if (!title.trim().endsWith("?")) return "--title must be a question ending in ?";
  if (!Array.isArray(options) || options.length < 2 || options.length > 3) return "give 2 or 3 --option values, recommended first";
  const bad = jargonIn([title, ...options].join("\n"));
  if (bad.length) return `plain words only; explain or replace: ${bad.join(", ")}`;
  return null;
}

export function buildBody({ q, options }) {
  const nq = normalizeQ(q);
  const lines = options.map((o, i) => `${i + 1}. ${i === 0 ? "**Recommended:** " : ""}${o}`);
  return `${marker(nq)}\n**Open item:** ${nq}\n\n${lines.join("\n")}\n\nAnswer with: \`node scripts/owner-needed.mjs answer <issue> <number>\`\n`;
}

/** The existing issue (any state) already carrying this Q's marker, or undefined. */
export function findDuplicate(issues, q) {
  const m = marker(normalizeQ(q));
  return issues.find((i) => (i.body ?? "").includes(m));
}

function gh(args, input) {
  return execFileSync("gh", ["api", ...args], { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
}
function repo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  const m = /github\.com[:/]+([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url) ?? /([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  return m[1];
}
function ensureLabel(r) {
  try {
    gh([`repos/${r}/labels/${LABEL}`]);
  } catch {
    gh(["-X", "POST", `repos/${r}/labels`, "-f", `name=${LABEL}`, "-f", "color=d93f0b", "-f", "description=A decision only the owner can make"]);
  }
}
function issues(r, state) {
  const out = gh([`repos/${r}/issues?labels=${LABEL}&state=${state}&per_page=100`, "--paginate", "--slurp"]);
  return JSON.parse(out).flat().filter((i) => !i.pull_request);
}

function parse(argv) {
  const o = { options: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--option") o.options.push(argv[++i]);
    else if (argv[i].startsWith("--")) o[argv[i].slice(2)] = argv[++i];
    else (o._ ??= []).push(argv[i]);
  }
  return o;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parse(rest);
  if (cmd === "file") {
    const err = checkQuestion(a);
    if (err) { console.error(`owner-needed: ${err}`); process.exit(2); }
    const r = repo();
    const dup = findDuplicate(issues(r, "all"), a.q);
    if (dup) { console.log(`already filed: #${dup.number} (${dup.state}) for ${normalizeQ(a.q)}`); return; }
    ensureLabel(r);
    const created = JSON.parse(gh(["-X", "POST", `repos/${r}/issues`, "--input", "-"], JSON.stringify({ title: a.title.trim(), body: buildBody(a), labels: [LABEL] })));
    console.log(`filed #${created.number}: ${created.html_url}`);
  } else if (cmd === "list") {
    console.log(JSON.stringify(issues(repo(), "open").map((i) => ({ number: i.number, title: i.title, url: i.html_url, body: i.body })), null, 2));
  } else if (cmd === "answer") {
    const [num, ...choice] = a._ ?? [];
    if (!/^\d+$/.test(num ?? "") || !choice.length) { console.error("usage: answer <issue> <choice>"); process.exit(2); }
    const r = repo();
    gh(["-X", "POST", `repos/${r}/issues/${num}/comments`, "-f", `body=Owner answer: ${choice.join(" ")}`]);
    gh(["-X", "PATCH", `repos/${r}/issues/${num}`, "-f", "state=closed", "-f", "state_reason=completed"]);
    console.log(`answered and closed #${num}`);
  } else {
    console.error("usage: owner-needed.mjs file|list|answer"); process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
