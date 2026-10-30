/**
 * Buttons, links, tabs and page headings are SENTENCE CASE too, not only pop-up
 * titles (owner, 2026-10-21: "Set Up Payouts with Stripe", "This Week / This
 * Month / This Year", "More Insights", "Saved Helpr Openings", "Set Up"). The
 * rule is src/test/helpers/sentenceCase.ts, the same as popupTitlesSentenceCase.
 *
 * Inventory from source: in every tracked .tsx under src/ (admin screens and
 * the legal documents excepted, below), the visible text inside <Button>,
 * <button>, <Link>, <h1>-<h3>, <TabsTrigger>, <DropdownMenuItem> and
 * <SectionTabs>/<ToggleGroup> labels: each JSX text run and each string
 * literal written as a child ({"…"} and the string branches of a ternary).
 * Plus `label: "…"` entries in tab and range arrays (the segmented toggles).
 *
 * @mutate src/pages/info/HelpCenter.tsx | <PublicHeaderPage title="Help center" | <PublicHeaderPage title="Help Center"
 * @mutate src/components/PayoutSetupForm.tsx | Set up payouts with Stripe | Set Up Payouts with Stripe
 * @mutate src/components/profile/earningsTab/EarningsRangeToggle.tsx | label: "This week" | label: "This Week"
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { sentenceCaseProblems } from "./helpers/sentenceCase";

/** Admin is operator vocabulary; legal pages name documents. */
const SKIP = /^src\/(components\/admin|pages\/admin|pages\/info\/legal)\/|\.test\.tsx$|^src\/test\//;
const TAGS = ["Button", "button", "Link", "h1", "h2", "h3", "TabsTrigger", "DropdownMenuItem"];

const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.tsx$/.test(f) && !SKIP.test(f));

/** The JSX children of each <Tag …>…</Tag>, braces balanced in the opening tag. */
function children(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(new RegExp(`<(${TAGS.join("|")})\\b`, "g"))) {
    let depth = 0;
    let i = m.index! + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    if (src[i - 1] === "/") continue; // self-closing
    const close = src.indexOf(`</${m[1]}>`, i);
    if (close === -1) continue;
    out.push(src.slice(i + 1, close));
  }
  return out;
}

/** The words each child shows: text runs, {"…"} literals, and string branches of ternaries. */
function shown(body: string): string[] {
  const out: string[] = [];
  // Text runs between tags, with {expr} as a value marker.
  // Innermost {expr} without JSX become value markers ({"…"} literals kept), repeatedly; braces that hold
  // JSX (a ternary of fragments) are opened, so the text inside their branches is read too.
  let flat = body;
  for (let prev = ""; prev !== flat; ) {
    prev = flat;
    flat = flat.replace(/\{[^{}<]*\}/g, (e) => (/^\{\s*"[^"]*"\s*\}$/.test(e) ? e : "\u0001"));
  }
  for (const run of flat.split(/<[^>]*>/)) {
    const t = run.replace(/\{\s*"([^"]*)"\s*\}/g, "$1").replace(/[{}]/g, " \u0001 ").replace(/\s+/g, " ").trim();
    // A run holding quotes or backticks is an expression's source, not shown text (its literals are read below).
    if (/[A-Za-z]{2}/.test(t) && !/[=;()`"]|=>/.test(t)) out.push(t);
  }
  for (const m of body.matchAll(/(?:\?|:)\s*"([^"]{3,})"/g)) out.push(m[1]);
  return out;
}

/** title="…" on the shared page-header / empty-state components, label="…" on badges. */
const TITLE_PROPS = /<(PageHeader|PublicHeaderPage|EmptyState|ProfileTabHeader|AppPage|PageTitleBar|SectionHeader|ProfileBadge|Badge)\b[^>]*?\b(?:title|label)="([^"]+)"/g;

/** Product and badge NAMES, written as names everywhere they appear (exact text). */
// "Terms of Service": the legal document's name, the H1 of /terms/full (lead, 2026-10-23, Twilio's A2P review).
// "Answer in Buying" / "Your Wanted posts" (B77/B82, 1030e): Buying and Wanted are the Declutter tabs' names, written as on the tab row.
// "Share your Book me link" (B99 UX-4): Book me is the profile button's name, written as on that button.
const NAMES = new Set(["Licensed & Insured", "Licensed & Insured Only", "Top Rated", "Terms of Service", "Answer in Buying", "Your Wanted posts", "Share your Book me link"]);

function findings(): string[] {
  const bad: string[] = [];
  for (const f of files) {
    const src = blankComments(readFileSync(f, "utf8"));
    for (const body of children(src)) {
      for (const t of shown(body)) {
        const p = NAMES.has(t) ? [] : sentenceCaseProblems(t);
        if (p.length) bad.push(`${f}: "${t}" (${p.join(", ")})`);
      }
    }
    // Audit #18/#20 (2026-10-21): page-header and empty-state titles and badge
    // labels, written as a string prop on the shared components.
    for (const m of src.matchAll(TITLE_PROPS)) {
      const t = m[2].replace(/&amp;/g, "&");
      const p = NAMES.has(t) ? [] : sentenceCaseProblems(t);
      if (p.length) bad.push(`${f}: ${m[1]} "${t}" (${p.join(", ")})`);
    }
    for (const m of src.matchAll(/\blabel:\s*"([^"]+)"/g)) {
      const p = NAMES.has(m[1]) ? [] : sentenceCaseProblems(m[1]);
      if (p.length) bad.push(`${f}: label "${m[1]}" (${p.join(", ")})`);
    }
  }
  return [...new Set(bad)];
}

describe("buttons, links, tabs and headings are sentence case (owner 2026-10-21)", () => {
  it("the inventory reads real controls", () => {
    expect(files.length).toBeGreaterThan(500);
    let n = 0;
    for (const f of files) n += children(blankComments(readFileSync(f, "utf8"))).length;
    expect(n).toBeGreaterThan(1000);
  });

  it("the title/label prop scan reads real headers (not vacuous)", () => {
    let n = 0;
    for (const f of files) n += [...blankComments(readFileSync(f, "utf8")).matchAll(TITLE_PROPS)].length;
    expect(n).toBeGreaterThan(50);
  });

  it("every control and heading the scan reads is sentence case", () => {
    expect(findings()).toEqual([]);
  });

  it("the rule catches Title Case and allows names and acronyms", () => {
    expect(sentenceCaseProblems("Set Up Payouts with Stripe")).toEqual(["Up", "Payouts"]);
    expect(sentenceCaseProblems("Pay with Apple Pay")).toEqual([]);
    expect(sentenceCaseProblems("Verify your ID")).toEqual([]);
  });
});
