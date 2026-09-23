#!/usr/bin/env node
/**
 * THE MORNING PAGE (docs/OPEN.md Q67). Owner, 2026-09-23: "The owner should
 * never have to ask 'what happened overnight'."
 *
 * One short, plain page for one date, docs/morning/YYYY-MM-DD.md:
 *   - What shipped      commits on main in the last 24h, grouped by the queue
 *                       item their subject names (Q<n>), with that item's title;
 *   - What's red        the scoreboard's FAIL rows (incl. the Q66 targets), the
 *                       open nightly-red issues, the ops alert ledger counts;
 *   - New alerts        ops alert ledger items first seen in the last 24h;
 *   - Waiting on you    open OPEN.md items marked OWNER.
 * Anything it could not read says "Could not check: <why>" — never an empty
 * list that reads as "nothing", never a zero it did not measure.
 *
 * .github/workflows/morning-page.yml writes it daily at 12:05 UTC (07:05
 * Central) with its existing secrets, reading the newest scoreboard.yml
 * artifact for the scoreboard rows, and publishes it as the job summary + an
 * artifact until GitHub Actions may commit (Q57).
 *
 * Usage:
 *   node scripts/morning-page.mjs                       # today, write docs/morning/<date>.md
 *   node scripts/morning-page.mjs --scoreboard <path>   # read the scoreboard from <path> (default docs/SCOREBOARD.md)
 *   node scripts/morning-page.mjs --stdout              # print, write nothing
 *
 * renderMorningPage() is pure; src/test/morningPage.test.ts drives it with a
 * fixture repo state.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPO = resolve(import.meta.dirname, "..");
export const SECTIONS = ["In one line", "What shipped", "What's red", "New alerts", "Waiting on you"];
const MAX_LIST = 10;

const errMsg = (e) => String(e?.stderr || e?.message || e).split("\n").find((l) => l.trim())?.slice(0, 160) ?? "error";
const clip = (s, n = 110) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plain = (s) => s.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
const more = (n) => (n > MAX_LIST ? [`- …and ${n - MAX_LIST} more.`] : []);

// ── parsers (pure) ──────────────────────────────────────────────────────────

/** Queue item titles from OPEN.md: "Q66" -> "Targets ("SLOs") on the scoreboard." */
export function queueTitles(openText) {
  const t = new Map();
  for (const m of openText.matchAll(/^- \[[ x~]\] \*\*(Q\d+)\b\s*([^*]*)\*\*/gm)) {
    if (!t.has(m[1])) t.set(m[1], plain(m[2]).replace(/^(DONE|OWNER)\b[^:]*:\s*/, ""));
  }
  return t;
}

/**
 * Open items waiting on the owner: unticked `- [ ]` lines that carry the word
 * OWNER (upper case, as OPEN.md marks them).
 */
export function ownerItems(openText) {
  return openText.split("\n").filter((l) => /^- \[ \] /.test(l) && /\bOWNER\b/.test(l)).map((l) => {
    const q = /\*\*(Q\d+)\b/.exec(l)?.[1] ?? null;
    return { q, text: clip(plain(l.replace(/^- \[ \] /, "")), 140) };
  });
}

/** Rows the page reports on their own line (fresher), so the scoreboard list skips them. */
export const OWN_LINE = [/^open nightly-red issues$/, /^ops alert ledger/];

/** Scoreboard rows with status FAIL, from the rendered SCOREBOARD.md. */
export function scoreboardReds(sbText) {
  const measured = /\*\*Live rows measured at (\S+?)\.\*\*/.exec(sbText)?.[1] ?? null;
  const rows = sbText.split("\n").filter((l) => /^\| (?!group \||---)/.test(l)).map((l) => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim()));
  if (rows.length < 5) throw new Error("scoreboard has no table");
  const reds = rows.filter((c) => c[2] === "**FAIL**" && !OWN_LINE.some((re) => re.test(c[1]))).map((c) => ({ group: c[0], signal: c[1], note: c[9] === "—" ? "" : c[9] }));
  const unknown = rows.filter((c) => c[2] === "**UNKNOWN**").length;
  return { measured, reds, unknown, rows: rows.length };
}

/** Commits grouped by the first queue item their subject names. */
export function groupCommits(commits) {
  const groups = new Map();
  for (const c of commits) {
    const key = /\bQ(\d+)\b/.exec(c.subject)?.[0] ?? "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === "other" ? 1 : b === "other" ? -1 : Number(a.slice(1)) - Number(b.slice(1))));
}

// ── the page (pure) ─────────────────────────────────────────────────────────

/**
 * @param {{ date:string, generatedAt:string, openText:string,
 *   commits: {sha:string, subject:string}[] | {error:string},
 *   scoreboard: string | {error:string},
 *   nightlyRed: {number:number, title:string, createdAt:string}[] | {error:string},
 *   ledger: {open:number, verifying:number, bySeverity:string} | {error:string},
 *   newAlerts: {title:string, severity:string, source:string, first_seen:string}[] | {error:string} }} s
 */
export function renderMorningPage(s) {
  const now = new Date(s.generatedAt);
  const failed = (x) => x && typeof x === "object" && !Array.isArray(x) && "error" in x;
  const couldNot = (x) => `- Could not check: ${x.error}.`;
  const L = [];
  const summary = [];

  // What shipped
  const shipped = [];
  if (failed(s.commits)) { shipped.push(couldNot(s.commits)); summary.push("shipped: unknown"); } else if (!s.commits.length) {
    shipped.push("- Nothing landed on main."); summary.push("nothing shipped");
  } else {
    const titles = queueTitles(s.openText);
    const groups = groupCommits(s.commits);
    summary.push(`${s.commits.length} change${s.commits.length === 1 ? "" : "s"} shipped`);
    for (const [key, cs] of groups.slice(0, MAX_LIST)) {
      const head = key === "other" ? "Not tied to a queue item" : `${key}${titles.has(key) ? ` ${clip(titles.get(key), 60)}` : ""}`;
      shipped.push(`- **${head}** (${cs.length}): ${cs.slice(0, 3).map((c) => clip(c.subject, 90)).join("; ")}${cs.length > 3 ? `; +${cs.length - 3} more` : ""}`);
    }
    shipped.push(...more(groups.length));
  }

  // What's red
  const red = [];
  const redBits = [];
  if (typeof s.scoreboard === "string") {
    try {
      const b = scoreboardReds(s.scoreboard);
      const age = b.measured ? Math.round((now - new Date(b.measured)) / 36e5) : null;
      red.push(`**Scoreboard** (live rows measured ${b.measured ?? "never"}${age !== null ? `, ${age}h ago` : ""}): ${b.reds.length} red, ${b.unknown} not measured.`);
      if (age === null || age > 36) red.push(`- The scoreboard is ${age === null ? "not measured" : "over 36h old"}: these reds may be out of date.`);
      for (const r of b.reds.slice(0, MAX_LIST)) red.push(`- ${plain(r.signal)}${r.note ? ` — ${clip(plain(r.note), 90)}` : ""}`);
      red.push(...more(b.reds.length));
      redBits.push(`${b.reds.length} red on the scoreboard`);
    } catch (e) { red.push(`**Scoreboard:** could not check: ${errMsg(e)}.`); redBits.push("scoreboard unknown"); }
  } else { red.push(`**Scoreboard:** could not check: ${s.scoreboard.error}.`); redBits.push("scoreboard unknown"); }
  if (failed(s.nightlyRed)) { red.push(`**Nightly suites red:** could not check: ${s.nightlyRed.error}.`); redBits.push("nightly suites unknown"); } else {
    redBits.push(`${s.nightlyRed.length} nightly suite${s.nightlyRed.length === 1 ? "" : "s"} red`);
    red.push(`**Nightly suites red:** ${s.nightlyRed.length} open nightly-red issue${s.nightlyRed.length === 1 ? "" : "s"}.`);
    for (const i of s.nightlyRed.slice(0, MAX_LIST)) red.push(`- #${i.number} ${clip(i.title.replace(/^nightly-red:\s*/, ""), 80)} (${Math.max(0, (now - new Date(i.createdAt)) / 864e5).toFixed(1)} days)`);
    red.push(...more(s.nightlyRed.length));
  }
  if (failed(s.ledger)) { red.push(`**Alert ledger:** could not check: ${s.ledger.error}.`); redBits.push("alert ledger unknown"); } else {
    redBits.push(`${s.ledger.open} open alert${s.ledger.open === 1 ? "" : "s"}`);
    red.push(`**Alert ledger:** ${s.ledger.open} open (${s.ledger.bySeverity}), ${s.ledger.verifying} being verified.`);
  }
  summary.push(...redBits);

  // New alerts
  const alerts = [];
  if (failed(s.newAlerts)) { alerts.push(couldNot(s.newAlerts)); summary.push("new alerts: unknown"); } else if (!s.newAlerts.length) {
    alerts.push("- No new alerts in the last 24 hours."); summary.push("no new alerts");
  } else {
    summary.push(`${s.newAlerts.length} new alert${s.newAlerts.length === 1 ? "" : "s"}`);
    for (const a of s.newAlerts.slice(0, MAX_LIST)) alerts.push(`- **${a.severity}** ${clip(plain(a.title), 90)} (from ${a.source}, first seen ${String(a.first_seen).slice(11, 16)}Z)`);
    alerts.push(...more(s.newAlerts.length));
  }

  // Waiting on you
  const owner = ownerItems(s.openText);
  summary.push(`${owner.length} decision${owner.length === 1 ? "" : "s"} waiting on you`);
  const waiting = owner.length ? owner.slice(0, MAX_LIST).map((o) => `- ${o.text}`).concat(more(owner.length)) : ["- Nothing is waiting on you."];

  L.push(`# Morning page — ${s.date}`, "",
    `_Made ${s.generatedAt.replace(/:\d\d(\.\d+)?Z$/, "Z")} by scripts/morning-page.mjs; covers the 24 hours before that. Open work: docs/OPEN.md. Every number: docs/SCOREBOARD.md._`, "",
    `## ${SECTIONS[0]}`, "", `${summary.join(" · ")}.`, "",
    `## ${SECTIONS[1]}`, "", ...shipped, "",
    `## ${SECTIONS[2]}`, "", ...red.flatMap((l, i) => (i && l.startsWith("**") ? ["", l] : [l])), "",
    `## ${SECTIONS[3]}`, "", ...alerts, "",
    `## ${SECTIONS[4]}`, "", ...waiting, "");
  return L.join("\n");
}

// ── gathering (IO) ──────────────────────────────────────────────────────────

const sh = (cmd, args, timeout = 60000) => execFileSync(cmd, args, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 26, timeout, stdio: ["ignore", "pipe", "pipe"] });

async function gather({ now, scoreboardPath }) {
  const since = new Date(now - 864e5).toISOString();
  const attempt = async (fn) => { try { return await fn(); } catch (e) { return { error: errMsg(e) }; } };
  const commits = await attempt(() => sh("git", ["log", "HEAD", `--since=${since}`, "--no-merges", "--format=%H%x09%s"])
    .split("\n").filter(Boolean).map((l) => { const [sha, ...rest] = l.split("\t"); return { sha, subject: rest.join("\t") }; }));
  const scoreboard = await attempt(() => readFileSync(scoreboardPath, "utf8"));
  const nightlyRed = await attempt(() => JSON.parse(sh("gh", ["issue", "list", "--label", "nightly-red", "--state", "open", "--limit", "100", "--json", "number,title,createdAt"])));
  let sqlFn = null;
  const sql = async (q) => {
    if (!sqlFn) sqlFn = (await import("./lib/opsAlertLedger.mjs")).sql;
    return sqlFn(q, { readOnly: true, timeoutMs: 20000 });
  };
  const ledger = await attempt(async () => {
    const rows = await sql("SELECT status, severity, count(*)::int AS n FROM public.ops_alert_ledger WHERE status IN ('open', 'verifying') GROUP BY 1, 2");
    const sum = (st) => rows.filter((r) => r.status === st).reduce((t, r) => t + Number(r.n), 0);
    const bySeverity = ["fatal", "critical", "error", "warning", "info"]
      .map((sv) => [sv, rows.filter((r) => r.status === "open" && r.severity === sv).reduce((t, r) => t + Number(r.n), 0)])
      .filter(([, n]) => n).map(([sv, n]) => `${n} ${sv}`).join(", ") || "none";
    return { open: sum("open"), verifying: sum("verifying"), bySeverity };
  });
  const newAlerts = await attempt(() => sql(
    // A user-report title is text a person (or an unauthenticated guest) typed
    // (docs/OPEN.md Q64); this page is published to the job summary and docs/,
    // outside the ledger's admin-only read. Its title is replaced here, in SQL,
    // so the words never leave the database.
    "SELECT CASE WHEN source_kind = 'user-report' THEN 'a user report (read it on /admin?view=health)' ELSE title END AS title, " +
    "severity, source, first_seen FROM public.ops_alert_ledger WHERE first_seen > now() - interval '24 hours' ORDER BY first_seen DESC LIMIT 50"));
  return { commits, scoreboard, nightlyRed, ledger, newAlerts };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const scoreboardPath = resolve(arg("--scoreboard") ?? join(REPO, "docs", "SCOREBOARD.md"));
  const page = renderMorningPage({
    date, generatedAt: now.toISOString(), openText: readFileSync(join(REPO, "docs", "OPEN.md"), "utf8"),
    ...(await gather({ now, scoreboardPath: existsSync(scoreboardPath) ? scoreboardPath : join(REPO, "docs", "SCOREBOARD.md") })),
  });
  if (argv.includes("--stdout")) { process.stdout.write(page); return; }
  const dir = join(REPO, "docs", "morning");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${date}.md`), page);
  console.log(`morning page → docs/morning/${date}.md`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
