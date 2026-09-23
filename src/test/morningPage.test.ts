// @mutate scripts/morning-page.mjs | .filter((l) => /^- \[ \] /.test(l) && /\bOWNER\b/.test(l)) | .filter((l) => /\bOWNER\b/.test(l))
// @mutate scripts/morning-page.mjs | const reds = rows.filter((c) => c[2] === "**FAIL**" && | const reds = rows.filter((c) => c[2] !== "**FAIL**" &&
// @mutate scripts/morning-page.mjs | const couldNot = (x) => `- Could not check: ${x.error}.`; | const couldNot = (x) => "- None.";
// @mutate scripts/morning-page.mjs | const key = /\bQ(\d+)\b/.exec(c.subject)?.[0] ?? "other"; | const key = "other";
// @mutate scripts/morning-page.mjs | if (age === null \|\| age > 36) red.push( | if (false) red.push(
/*
 * Q67: the morning page. A fixture repo state (OPEN.md, commits, a rendered
 * scoreboard, nightly-red issues, the alert ledger) must produce the expected
 * sections, and every source it could not read must say "Could not check" —
 * an unread source rendered as an empty list reads to the owner as "nothing
 * happened", which is the false green this repo keeps paying for.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no declaration file
import * as mp from "../../scripts/morning-page.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import * as sb from "../../scripts/scoreboard.mjs";

const ROOT = join(__dirname, "..", "..");

const OPEN = [
  "# Open",
  "- [x] **Q1 DONE 2026-09-20: old thing fixed.** GUARD: a.test.ts",
  "- [ ] **Q2 Faster browse page.** Make it fast.",
  "- [ ] **Q3 OWNER (Stripe dashboard): turn on tax filing.** Needs the owner.",
  "- [x] **Q4 OWNER DECISION taken: keep dark mode.** Done.",
  "- [ ] OWNER: add the SLACK_WEBHOOK_URL secret — owner only.",
  "- [ ] **Q5 Ordinary open work.** Nobody needs to decide.",
].join("\n");

const row = (signal: string, status: string, note = "") => ({ group: "g", signal, status, at: "2026-09-24T00:00Z", source: "s", note });
const SCOREBOARD = (measured: string) => sb.renderScoreboard(
  [row("queue", "WARN"), row("audit bus", "INFO")],
  `**Live rows measured at ${measured}.**\n\n${[
    "| group | signal | status | pass | fail | skipped | total | measured at | source | note |", "|---|---|---|---|---|---|---|---|---|---|",
    sb.renderRow(row("uptime (share of uptime.yml probes that found prod up)", "FAIL", "98.90% vs target ≥ 99.5% over 7d")),
    sb.renderRow(row("workflow db-backup.yml", "FAIL", "red since 2026-09-22")),
    sb.renderRow(row("workflow test.yml", "PASS")),
    sb.renderRow(row("open nightly-red issues", "FAIL", "#9 x")),
    sb.renderRow({ ...row("payment success rate", "UNKNOWN"), note: "UNKNOWN: no events" }),
  ].join("\n")}`);

const FIXTURE = {
  date: "2026-09-24", generatedAt: "2026-09-24T12:05:00Z", openText: OPEN,
  commits: [
    { sha: "a", subject: "fix(Q2): cache the browse query" },
    { sha: "b", subject: "test(Q2): browse budget" },
    { sha: "c", subject: "docs(Q3): note the tax setting" },
    { sha: "d", subject: "chore: bump deps" },
  ],
  scoreboard: SCOREBOARD("2026-09-23T19:20Z"),
  nightlyRed: [{ number: 1700, title: "nightly-red: e2e-journeys", createdAt: "2026-09-23T12:05:00Z" }],
  ledger: { open: 3, verifying: 1, bySeverity: "1 critical, 2 error" },
  newAlerts: [{ title: "Louisiana Helpr is DOWN", severity: "critical", source: "uptime", first_seen: "2026-09-24T03:10:00Z" }],
};

const section = (page: string, name: string) => {
  const i = page.indexOf(`## ${name}\n`);
  if (i < 0) throw new Error(`no section ${name}`);
  const j = page.indexOf("\n## ", i + 3);
  return page.slice(i, j < 0 ? undefined : j);
};

describe("the morning page from a fixture repo state", () => {
  const page: string = mp.renderMorningPage(FIXTURE);

  it("has exactly the five sections, in order", () => {
    expect(page.startsWith("# Morning page — 2026-09-24\n")).toBe(true);
    expect([...page.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(mp.SECTIONS);
    expect(mp.SECTIONS.length).toBeGreaterThan(4);
  });

  it("one line: counts of each part", () => {
    expect(section(page, "In one line")).toContain("4 changes shipped · 2 red on the scoreboard · 1 nightly suite red · 3 open alerts · 1 new alert · 2 decisions waiting on you.");
  });

  it("what shipped: grouped by queue item with its title, the rest under 'not tied'", () => {
    const s = section(page, "What shipped");
    expect(s).toContain("- **Q2 Faster browse page.** (2): fix(Q2): cache the browse query; test(Q2): browse budget");
    expect(s).toContain("- **Q3 turn on tax filing.** (1): docs(Q3): note the tax setting");
    expect(s).toContain("- **Not tied to a queue item** (1): chore: bump deps");
    expect(s.indexOf("Q2")).toBeLessThan(s.indexOf("Q3"));
    expect(s.indexOf("Q3")).toBeLessThan(s.indexOf("Not tied"));
  });

  it("what's red: the scoreboard's FAIL rows only, nightly-red issues, ledger counts", () => {
    const s = section(page, "What's red");
    expect(s).toContain("**Scoreboard** (live rows measured 2026-09-23T19:20Z, 17h ago): 2 red, 1 not measured.");
    expect(s).toContain("- uptime (share of uptime.yml probes that found prod up) — 98.90% vs target ≥ 99.5% over 7d");
    expect(s).toContain("- workflow db-backup.yml — red since 2026-09-22");
    expect(s).not.toContain("workflow test.yml");
    expect(s).not.toContain("- open nightly-red issues");
    expect(s).not.toContain("may be out of date");
    expect(s).toContain("**Nightly suites red:** 1 open nightly-red issue.\n- #1700 e2e-journeys (1.0 days)");
    expect(s).toContain("**Alert ledger:** 3 open (1 critical, 2 error), 1 being verified.");
  });

  it("new alerts and the decisions waiting on the owner (open OWNER items only)", () => {
    expect(section(page, "New alerts")).toContain("- **critical** Louisiana Helpr is DOWN (from uptime, first seen 03:10Z)");
    const w = section(page, "Waiting on you");
    expect(w).toContain("- Q3 OWNER (Stripe dashboard): turn on tax filing. Needs the owner.");
    expect(w).toContain("- OWNER: add the SLACK_WEBHOOK_URL secret — owner only.");
    expect(w).not.toContain("Q4");
    expect(w).not.toContain("Q5");
  });

  it("an old scoreboard is flagged, not presented as current", () => {
    const old: string = mp.renderMorningPage({ ...FIXTURE, scoreboard: SCOREBOARD("2026-09-21T19:20Z") });
    expect(section(old, "What's red")).toContain("over 36h old: these reds may be out of date");
  });

  it("every source it could not read says 'Could not check', never an empty or zero answer", () => {
    const err = { error: "spawnSync gh ENOENT" };
    const page2: string = mp.renderMorningPage({ ...FIXTURE, commits: err, scoreboard: err, nightlyRed: err, ledger: err, newAlerts: err });
    expect(section(page2, "What shipped")).toContain("- Could not check: spawnSync gh ENOENT.");
    expect(section(page2, "What's red")).toContain("**Scoreboard:** could not check: spawnSync gh ENOENT.");
    expect(section(page2, "What's red")).toContain("**Nightly suites red:** could not check");
    expect(section(page2, "What's red")).toContain("**Alert ledger:** could not check");
    expect(section(page2, "New alerts")).toContain("- Could not check: spawnSync gh ENOENT.");
    expect(section(page2, "In one line")).toContain("shipped: unknown · scoreboard unknown · nightly suites unknown · alert ledger unknown · new alerts: unknown");
    expect(page2).not.toMatch(/\b0 (red|nightly|open alert|new alert)/);
    expect(page2).not.toContain("No new alerts");
    expect(page2).not.toContain("Nothing landed");
  });

  it("a genuinely quiet day says so plainly", () => {
    const quiet: string = mp.renderMorningPage({ ...FIXTURE, commits: [], newAlerts: [], openText: "- [ ] **Q5 Ordinary.** x" });
    expect(section(quiet, "What shipped")).toContain("- Nothing landed on main.");
    expect(section(quiet, "New alerts")).toContain("- No new alerts in the last 24 hours.");
    expect(section(quiet, "Waiting on you")).toContain("- Nothing is waiting on you.");
  });
});

describe("the real docs/OPEN.md", () => {
  const open = readFileSync(join(ROOT, "docs", "OPEN.md"), "utf8");
  it("yields the open OWNER items and no ticked ones", () => {
    const items: { text: string }[] = mp.ownerItems(open);
    expect(items.length).toBeGreaterThan(3);
    const openOwnerLines = open.split("\n").filter((l) => l.startsWith("- [ ] ") && l.includes("OWNER"));
    expect(items.length).toBe(openOwnerLines.filter((l) => /\bOWNER\b/.test(l)).length);
    const ticked = open.split("\n").filter((l) => /^- \[[x~]\] /.test(l) && /\bOWNER\b/.test(l)).map((l) => l.slice(6, 60));
    expect(ticked.length).toBeGreaterThan(0);
    for (const t of ticked) expect(items.some((i) => i.text.startsWith(t.replace(/\*\*/g, "").trim().slice(0, 30)))).toBe(false);
  });
  it("names queue titles for commit groups", () => {
    expect(mp.queueTitles(open).size).toBeGreaterThan(100);
  });
});
