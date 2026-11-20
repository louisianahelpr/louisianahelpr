#!/usr/bin/env node
/**
 * Manual drift check: does the public 25 Days lineup (src/content/sponsorPage.ts -> lineup.days) match the
 * owner's tracker (~/Desktop/25 Days Sponsor Tracker.html, `const S` sponsors and `const D` calendar)?
 *
 *   node scripts/check-25days-lineup.mjs            # diff; exits 1 on any drift
 *   node scripts/check-25days-lineup.mjs --print    # print the expected lineup.days block (paste into sponsorPage.ts)
 *   node scripts/check-25days-lineup.mjs --tracker <path>
 *
 * Manual only: CI never runs this (the tracker lives on the owner's Desktop, not in the repo).
 * Public page rule: brand names and prizes only. The tracker's contact field (`c`) and notes are never read.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const trackerArg = args.indexOf("--tracker");
const TRACKER = trackerArg >= 0 ? args[trackerArg + 1] : path.join(os.homedir(), "Desktop", "25 Days Sponsor Tracker.html");

/** Parenthetical notes that are internal, never public (a contact's name, a planning note). */
const NOTE_PARENS = [
  /\s*\(split from same sponsor\)/gi,
  /\s*\(suggested, not (?:confirmed|final)[^)]*\)/gi,
  /\s*\(her choice\)/gi,
  /\s*\(contents TBD\)/gi,
  /\s*\(details pending\)/gi,
  /\s*\(will call, winner name\)/gi,
  /\s*\(\d+ days\)/gi,
  /\s*\(conditional\)/gi,
  /\s*\(picked [^)]*\)/gi,
  /\s*\([^)]*\basked\)/gi, // e.g. ("a bundle or two"; contents asked)
  // Owner 2026-11-19 (public list is undated, one card per brand): "(2 of 4, split from same sponsor)" and
  // "(1 of 4; Ripley's is in Duson, LA)" are planning notes, as is any note with a time stamp or "not given".
  /\s*\(\d+ of \d+[^)]*\)/gi,
  /\s*\([^)]*\b\d{1,2}:\d{2}\s*[AP]M[^)]*\)/gi,
  /\s*\([^)]*\bnot given\)/gi,
  /\s*\([^)]*sign-up form\)/gi,
];
/**
 * Owner 2026-11-19: the public lineup shows business names, except these three sponsors, who show by their own name
 * as the owner chose ("David Rabalais"; "Tevin Lewis, District 2 Alderman"; Haylie has no business name on file, so
 * "Haylie Rudisill · Custom wreath sashes"). Any other person's name stays out (PERSON_PARENS, TRAILING_NOTE).
 * The same list is the guard's allowlist (src/test/sponsor25daysPublicNoDates.test.tsx, NAMED_SPONSORS).
 */
const PUBLIC_NAMES = new Map([
  ["David Rabalais (The Fois)", "David Rabalais"],
  ["Tevin Lewis, District 2 Alderman", "Tevin Lewis, District 2 Alderman"],
  ["Haylie Rudisill (custom wreath sashes)", "Haylie Rudisill · Custom wreath sashes"],
]);
/** Brand-name parentheticals that are a person (the sponsor's contact), keyed by tracker key. */
const PERSON_PARENS = [/\s*\(Holli M\. Landry\)/g, /\s*\(Brandi\)/g];
/**
 * Anything after a " · " in a brand name is not the brand: an internal note ("· DATE TOLD: Dec 25 (owner OK'd)")
 * or the seller's own name ("Mary Kay · Crystal Fakier").
 */
const TRAILING_NOTE = /\s*·.*$/;
/** One tracker prize that names two days' prizes: split it by day. */
const PER_DAY_PRIZE = /^Dec \d+:/;

function publicBrand(n) {
  let s = n.replace(TRAILING_NOTE, "");
  if (PUBLIC_NAMES.has(s.trim())) return PUBLIC_NAMES.get(s.trim());
  for (const re of [...PERSON_PARENS, ...NOTE_PARENS]) s = s.replace(re, "");
  return s.trim();
}

function publicPrize(prize, day) {
  let s = prize;
  if (PER_DAY_PRIZE.test(s)) {
    const part = s.split(/\s*·\s*/).find((p) => p.startsWith(`Dec ${day}:`));
    if (!part) throw new Error(`prize "${prize}" has no part for Dec ${day}`);
    s = part.replace(/^Dec \d+:\s*/, "");
  }
  for (const re of NOTE_PARENS) s = s.replace(re, "");
  s = s.trim();
  if (/^TBD\b/i.test(s)) return "Prize to be announced";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Reads `const S={...}` and `const D={...}` out of the tracker's script and evaluates them as plain data. */
function readTracker(html) {
  const grab = (name) => {
    const start = html.indexOf(`const ${name}=`);
    if (start < 0) throw new Error(`tracker has no const ${name}`);
    let i = html.indexOf("{", start);
    let depth = 0;
    let q = null;
    for (let j = i; j < html.length; j++) {
      const ch = html[j];
      if (q) {
        if (ch === "\\") j++;
        else if (ch === q) q = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") q = ch;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return vm.runInNewContext(`(${html.slice(i, j + 1)})`, {}, { timeout: 1000 });
    }
    throw new Error(`const ${name} never closes`);
  };
  return { S: grab("S"), D: grab("D") };
}

function expectedLineup({ S, D }) {
  const days = [];
  for (let day = 1; day <= 25; day++) {
    const keys = D[day] ?? [];
    days.push({
      day,
      partners: keys.map((k) => {
        const s = S[k];
        if (!s) throw new Error(`Dec ${day}: calendar key "${k}" has no sponsor`);
        return { brand: publicBrand(s.n), prize: publicPrize(s.prize, day) };
      }),
    });
  }
  return days;
}

const q = (s) => JSON.stringify(s);
function printBlock(days) {
  const lines = ["    days: ["];
  for (const d of days) {
    lines.push("      {", `        day: ${d.day},`, "        partners: [");
    for (const p of d.partners) lines.push(`          { brand: ${q(p.brand)}, prize: ${q(p.prize)} },`);
    lines.push("        ],", "      },");
  }
  lines.push("    ],");
  return lines.join("\n");
}

async function main() {
  if (!fs.existsSync(TRACKER)) {
    console.error(`Tracker not found: ${TRACKER}`);
    process.exit(2);
  }
  const want = expectedLineup(readTracker(fs.readFileSync(TRACKER, "utf8")));
  if (args.includes("--print")) {
    console.log(printBlock(want));
    return;
  }
  const { sponsorPage } = await import(pathToFileURL(path.join(HERE, "../src/content/sponsorPage.ts")).href);
  const got = sponsorPage.lineup.days;
  const problems = [];
  for (const w of want) {
    const g = got.find((d) => d.day === w.day);
    const fmt = (ps) => ps.map((p) => `${p.brand} | ${p.prize}`);
    const a = fmt(w.partners);
    const b = g ? fmt(g.partners) : [];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      problems.push(`Dec ${w.day}:`);
      for (const x of a) if (!b.includes(x)) problems.push(`  tracker only: ${x}`);
      for (const x of b) if (!a.includes(x)) problems.push(`  page only:    ${x}`);
      if (a.length === b.length && a.every((x) => b.includes(x))) problems.push("  same entries, different order");
    }
  }
  for (const g of got) if (g.day < 1 || g.day > 25) problems.push(`page has Dec ${g.day}`);
  const total = want.reduce((n, d) => n + d.partners.length, 0);
  if (problems.length) {
    console.error(`25 Days lineup drift (tracker has ${total} giveaways):\n${problems.join("\n")}`);
    console.error("Fix: node scripts/check-25days-lineup.mjs --print, then paste into lineup.days.");
    process.exit(1);
  }
  console.log(`25 Days lineup matches the tracker: ${total} giveaways over 25 days.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
