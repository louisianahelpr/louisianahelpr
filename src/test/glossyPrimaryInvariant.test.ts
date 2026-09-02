import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * ONE PRIMARY, AND IT IS GLOSSY.
 *
 * Project rule: a primary action and a SELECTED control wear the shared
 * `btn-grad-primary` gradient — never a flat brand fill. The owner found two
 * olive full-width primaries in the same app, one flat and one glossy, and had
 * no way to tell from a screenshot which one was "the" primary.
 *
 * `src/components/ui/button.tsx` already makes this true for anything that goes
 * through `<Button>`: `primary` and `default` both resolve to
 * `btn-grad-primary + GREEN_CTA_HOVER + ELEV_FILLED`. So the gloss never
 * escapes through the Button component — it escapes through the things that
 * are NOT a Button:
 *
 *   1. a bare `<button className="bg-primary …">` (an NPS score chip, a
 *      quick-feedback pill), which paints the brand olive flat; and
 *   2. a `<Button className="bg-… ">` that overrides the variant's own fill.
 *
 * Both read to a user as "the emphasised control", both sit next to a real
 * glossy CTA, and neither is visible to a per-component review that only ever
 * opens one file. This test reads all of them at once.
 *
 * WHY THE MATCHER IS ABOUT *SOLID* FILLS ONLY. `bg-primary/10`,
 * `bg-[hsl(var(--bark)/0.18)]` and friends are TINTS — a background wash behind
 * an icon or a callout, not a filled control. They are legitimate and common,
 * so an alpha suffix takes a class out of scope. What is in scope is the fully
 * opaque brand fill, which is the one that competes with the CTA.
 */

const ROOT = resolve(__dirname, "../..");
const repoFile = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

function tsxFiles(): string[] {
  return execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".tsx") && !/\.test\./.test(f))
    .filter((f) => existsSync(resolve(ROOT, f)));
}

const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * A fully-opaque brand fill. The `(?![\/])` is the whole subtlety: it excludes
 * every tint (`bg-primary/10`), and `hsl(var(--bark)/0.18)` is excluded because
 * the arbitrary value carries no `/alpha` inside the brackets.
 */
const SOLID_BRAND_FILL =
  /\bbg-(?:primary|\[hsl\(var\(--(?:bark|olivewood|sage[a-z-]*)\)\)\])(?![/\w-])/;

/** Interactive? A control the user taps, as opposed to a decorative slab. */
const INTERACTIVE_TAG = /^(button|Button|a|Link|label)$/;

interface Site {
  file: string;
  line: number;
  tag: string;
  className: string;
}

/**
 * Walk every JSX opening tag and pull out `tag` + the string content of every
 * className/cn(...) argument on it. Deliberately text-based (no TS AST): it has
 * to survive template literals, `cn()` with three conditional branches, and
 * `${selected ? "…" : "…"}`, all of which the real offenders use.
 */
function jsxSites(file: string): Site[] {
  const src = stripComments(repoFile(file));
  const sites: Site[] = [];
  for (const open of src.matchAll(/<([A-Za-z][\w.]*)(?=[\s/>])/g)) {
    const tag = open[1];
    // Hand-rolled scan to the tag's own closing `>`, balancing braces and
    // skipping string bodies. A regex cannot do this: the real offenders wear
    // `onClick={() => { … }}` (braces two deep) and
    // `className={`… ${cond ? "a" : "b"} …`}` (braces inside a template
    // literal), and a `[^{}]*` alternation walks straight past both — which is
    // how the first draft of this file reported ZERO flat controls in popups
    // while two were on screen.
    let i = open.index! + open[0].length;
    let depth = 0;
    let quote: string | null = null;
    const start = i;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    const attrs = src.slice(start, i);
    if (!/className\s*=/.test(attrs)) continue;
    // The haystack is the WHOLE attribute soup, not a quote-paired extraction.
    // Classes get assembled every way this codebase knows — a plain string,
    // `cn(a, cond && b)`, a ternary, a template literal with `${…}` holes
    // holding more quoted strings — and any quote-pairing scheme mis-pairs at
    // least one of them. `bg-…` tokens only ever appear in class position, so
    // scanning the raw slice costs nothing and misses nothing.
    //
    // KNOWN LIMIT, stated rather than hidden: a tag whose ternary has a glossy
    // branch AND a flat branch reads as glossy here. The "SELECTED states"
    // assertion below scans ternary branches individually and covers that case.
    sites.push({
      file,
      line: src.slice(0, open.index).split("\n").length,
      tag,
      className: attrs,
    });
  }
  return sites;
}

const POPUP_CONTENT = /<(DialogContent|AlertDialogContent|SheetContent)\b/;

const ALL_SITES = tsxFiles().flatMap(jsxSites);
const POPUP_FILES = new Set(
  tsxFiles().filter((f) => POPUP_CONTENT.test(stripComments(repoFile(f)))),
);

// ---------------------------------------------------------------------------

describe("the shared primary is the only glossy primary", () => {
  it("the Button primitive still applies the gloss (guards this file going blind)", () => {
    // Every assertion below is stated as "…and it is not btn-grad-primary".
    // If the primitive stops emitting that class, the whole rule evaporates
    // silently and every offender below becomes indistinguishable from a CTA.
    const button = repoFile("src/components/ui/button.tsx");
    expect(
      (button.match(/btn-grad-primary/g) ?? []).length,
      "button.tsx no longer gives BOTH `primary` and `default` btn-grad-primary — " +
        "the gloss is the primary CTA's whole identity; restore it or repoint this test",
    ).toBeGreaterThanOrEqual(2);
    expect(
      repoFile("src/index.css"),
      "the .btn-grad-primary rule is gone from index.css — every 'glossy' button in " +
        "the app is now flat and nothing failed",
    ).toContain(".btn-grad-primary");
  });

  it("no interactive control in a popup paints a flat brand fill", () => {
    const offenders = ALL_SITES.filter(
      (s) =>
        POPUP_FILES.has(s.file) &&
        INTERACTIVE_TAG.test(s.tag) &&
        SOLID_BRAND_FILL.test(s.className) &&
        !/btn-grad-primary/.test(s.className),
    ).map(
      (s) =>
        `${s.file}:${s.line} <${s.tag}> — solid brand fill with no btn-grad-primary. ` +
        `A flat olive control sitting beside a glossy CTA is the exact ambiguity the ` +
        `owner reported. Use <Button variant="primary"> if it IS the primary action, ` +
        `or add btn-grad-primary if it is a selected state.`,
    );
    expect(
      offenders,
      "flat brand-filled controls inside popups:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("no <Button> anywhere overrides its variant's fill via className", () => {
    // The other direction of the same defect: keep the component, repaint it.
    // The diff reads as a styling tweak and the result is a CTA that no longer
    // matches any other CTA.
    const offenders = ALL_SITES.filter(
      (s) => s.tag === "Button" && SOLID_BRAND_FILL.test(s.className),
    ).map(
      (s) =>
        `${s.file}:${s.line} <Button className="… ${
          s.className.match(SOLID_BRAND_FILL)?.[0]
        } …"> — the variant owns the fill. Pick the variant (primary / secondary / ` +
        `outline / ghost / destructive) instead of repainting one instance.`,
    );
    expect(
      offenders,
      "Buttons repainting their own background:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("SELECTED states across the app use the shared gloss, not a flat fill", () => {
    // Not scoped to popups: the rule is "primary AND selected controls", and a
    // segmented control on a page has the same problem as one in a sheet.
    // Heuristic for "this class string is the selected branch": the file's own
    // ternary put a solid brand fill on one side of `selected`/`isActive`/
    // `checked`, which is only ever how a chosen control is painted.
    const offenders: string[] = [];
    for (const file of tsxFiles()) {
      const src = stripComments(repoFile(file));
      for (const m of src.matchAll(
        /\b(selected|isSelected|isActive|active|checked|isChecked|isCurrent)\b[^?\n]{0,40}\?\s*([\s\S]{0,200}?):/g,
      )) {
        const chosen = m[2];
        if (!SOLID_BRAND_FILL.test(chosen)) continue;
        if (/btn-grad-primary/.test(chosen)) continue;
        offenders.push(
          `${file}:${src.slice(0, m.index).split("\n").length} — the "${m[1]}" branch ` +
            `paints a solid brand fill with no btn-grad-primary. Selected controls carry ` +
            `the same gloss as the primary CTA (project rule); a flat one reads as a ` +
            `different, lesser kind of "chosen".`,
        );
      }
    }
    expect(
      offenders,
      "flat selected states:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });
});
