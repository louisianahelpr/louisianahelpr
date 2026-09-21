import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * THE STATIC HALF of the one-control rule (owner, 2026-09-19, twice: "the
 * buttons word size and font need to be consistent"; "i will not say this
 * again. the buttons need to have the same size font and everything").
 *
 * ── READ THIS BEFORE TRUSTING THIS FILE ────────────────────────────────────
 * The first version of this guard asserted that every action button resolved
 * to one of THREE sanctioned tiers — 11px chip, 12px squeezed primary, 14px
 * primary — and reported PASS on the screen the owner then screenshotted. It
 * validated the tiers instead of questioning them. There are no tiers now:
 * every control in a job-card action row is ONE object at ONE size
 * (`JOB_ROW_LABEL_CLASS`, 11px), and the 12px `[data-tight]` rung is deleted.
 *
 * The REAL check is `src/test/jobRowControlSameness.test.tsx`, which renders
 * every state of both cards and compares the controls in each row to EACH
 * OTHER — size, icon placement, tap floor, radius, label treatment. A static
 * scan cannot see that a stacked chip and an inline button ended up in the
 * same row; that file can, and it is registered with a mutation proving it.
 *
 * What is left HERE is the cheap static sweep the rendered check cannot do:
 * across every non-test .tsx in the activity tree, no action button may
 *
 *   - declare a type size other than `text-ds-11` — the one size the row has;
 *   - reach outside the design scale at all (`text-xs`, `text-[13px]`);
 *   - name a second typeface.
 *
 * THE INVENTORY IS DERIVED, not listed: every non-test .tsx under
 * src/components/activity. A new step file is covered the day it is written.
 *
 * `src/components/JobConfirmation.tsx` used to be appended to that list
 * because it renders a control INTO a step row. It is NOT any more, and the
 * reason is worth stating: that file draws TWO things — the row control (its
 * `inline` variant, portalled into the primary slot) and a standalone
 * "Still on for this one?" PANEL that is not in any row and has no business
 * being held to the row's 11px. A per-file static scan cannot tell them apart.
 * The rendered guard can: it reads whatever actually lands in a
 * `[data-job-step-row]`, wherever it was written, so JobConfirmation's row
 * control is covered there and its panel is left alone.
 */

const ROOT = resolve(__dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

/**
 * NOT the card's action row, and each one is a different surface with its own
 * density. Kept as three named files rather than a pattern so adding one is a
 * decision somebody writes down.
 */
const NOT_ACTION_ROWS = new Set([
  // The applicants list inside an open posted job: rows of people with their
  // own compact controls, rendered above the step card, never in its row.
  "src/components/activity/postedJobs/ApplicantsPanel.tsx",
  "src/components/activity/postedJobs/applicantsPanel/ApplicantSortControls.tsx",
]);

/** The card's INFORMATION strip, not its moves — and its location chip is the
 *  one control in the tree that is supposed to ellipsis (see JobActionRow). */
const META_ROW = "src/components/activity/JobCardMetaRow.tsx";

function files(): string[] {
  const list = walk(join(ROOT, "src/components/activity")).map((p) => relative(ROOT, p));
  return list.filter((p) => !NOT_ACTION_ROWS.has(p) && p !== META_ROW);
}

/**
 * The end of a JSX opening tag — brace-depth aware, and skipping comments and
 * strings, because an apostrophe in a `//` note between attributes (there are
 * several) or a `=>` inside an `onClick` both defeat a plain regex, and the
 * className that matters usually sits AFTER the handler.
 */
function openingTag(src: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      if (nl < 0) break;
      i = nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(from, i + 1);
  }
  return src.slice(from);
}

interface Tag {
  where: string;
  text: string;
}

/**
 * File-level `const NAME = "…classes…"` strings, so a class list lifted into a
 * variable is still read. Without this the guard has a hole the width of one
 * refactor: `className={confirmCtaClass}` hides whatever the constant says,
 * and the first thing anybody does with a class string they are editing twice
 * is name it.
 */
function classConsts(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*((?:"[^"]*"|'[^']*'|\s*\+\s*)+);/g)) {
    out.set(m[1], m[2]);
  }
  return out;
}

function buttonTags(): Tag[] {
  const tags: Tag[] = [];
  for (const rel of files()) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    const consts = classConsts(src);
    const start = /<(Button|button)(?=[\s/>])/g;
    let m: RegExpExecArray | null;
    while ((m = start.exec(src))) {
      const tag = openingTag(src, m.index);
      // Every identifier the tag mentions that resolves to a local string
      // constant is scanned as if it had been written inline.
      const referenced = [...new Set([...tag.matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0]))]
        .filter((name) => consts.has(name))
        .map((name) => consts.get(name)!)
        .join(" ");
      tags.push({
        where: `${rel}:${src.slice(0, m.index).split("\n").length}`,
        text: referenced ? `${tag} ${referenced}` : tag,
      });
    }
  }
  return tags;
}

/** A LINK, not a button tier: an underlined text escape ("Cancel Job" under the
 *  confirm dialog). It is a `<button>` because its activation is not navigation
 *  — the right call — and it wears the link's own size, not a button tier's. */
const isLinkStyled = (t: Tag) => /\bunderline\b|\blink-standard\b/.test(t.text);

const SANCTIONED = new Set(["text-ds-11"]);

describe("activity card action buttons — ONE type size, one typeface", () => {
  const tags = buttonTags();

  it("finds the buttons at all (a scanner that matches nothing passes everything)", () => {
    expect(files().length).toBeGreaterThan(20);
    expect(tags.length).toBeGreaterThan(20);
    // The chip primitive and the row primary must both be in the inventory, or
    // the glob has drifted away from the tree this rule is about.
    expect(tags.some((t) => t.where.startsWith("src/components/activity/JobActionRow.tsx"))).toBe(true);
  });

  it("declares no type size but the row's one size", () => {
    const drift = tags
      .filter((t) => !isLinkStyled(t))
      .flatMap((t) =>
        [...t.text.matchAll(/\btext-ds-\d+\b/g)]
          .map((x) => x[0])
          .filter((cls) => !SANCTIONED.has(cls))
          .map((cls) => `${t.where} → ${cls}`),
      );
    expect(
      drift,
      "an action button at a size the row does not have. There is exactly one: JOB_ROW_LABEL_CLASS (text-ds-11). See src/test/jobRowControlSameness.test.tsx",
    ).toEqual([]);
  });

  it("never reaches outside the design scale for a size", () => {
    // `text-xs` / `text-sm` / `text-[13px]` bypass the ds tokens entirely, so
    // they cannot be reasoned about as tiers at all.
    const raw = tags.flatMap((t) =>
      [...t.text.matchAll(/\btext-(xs|sm|base|lg|xl|\[[^\]]+\])/g)].map((x) => `${t.where} → ${x[0]}`),
    );
    expect(raw, "a raw Tailwind type size on an action button — use the ds scale").toEqual([]);
  });

  it("never re-declares the font family", () => {
    // Everything is Montserrat via tailwind.config.ts's `sans`. A button that
    // names a display, serif or mono family is the other half of the owner's
    // report ("word size and FONT"). The tokens are spelled only in the regex
    // below, never in prose here: src/test/twoFontTypeSystem.test.tsx scans
    // every file for the retired serif token as a bare literal, and a comment
    // quoting it reads to that guard exactly like a call site would.
    const fonts = tags.flatMap((t) =>
      [...t.text.matchAll(/\bfont-(display|serif|mono)\b/g)].map((x) => `${t.where} → ${x[0]}`),
    );
    expect(fonts, "an action button in a second typeface").toEqual([]);
  });
});

/**
 * ── THE HOLE THIS CLOSES (vacuity burn-down, 2026-09-21) ───────────────────
 * Everything above reads a button's OPENING TAG only. But every control in
 * this row writes its size on the `<span>` INSIDE the button
 * (`JOB_ROW_LABEL_CLASS`), never on the button element — so across the whole
 * activity tree exactly FOUR of the 47 scanned tags carried a type class at
 * all, and all four were in the two files `NOT_ACTION_ROWS` excludes. `drift`,
 * `raw` and `fonts` were therefore `[]` by construction, and the row's one
 * size could be changed to `text-ds-12` with all four tests green (proved by
 * mutation before this block was written).
 *
 * So the row's own size is read where it is actually declared. The two files
 * below ARE the row's controls — `JobActionRow.tsx` (chip, primary, More) and
 * the one control written outside it (`DirectionsButton`), which imports the
 * same constant. Between them they contain exactly ONE type-size declaration,
 * which is the rule this file exists to state.
 */
const ROW_PRIMITIVE_FILES = [
  "src/components/activity/JobActionRow.tsx",
  "src/components/activity/appliedJobCard/DirectionsButton.tsx",
];

/** Any declaration of a type size or a typeface, on the ds scale or off it. */
const typeTokens = (text: string): string[] =>
  text.match(/\btext-ds-\d+\b|\btext-(?:xs|sm|base|lg|xl)\b|\btext-\[[^\]]+\]|\bfont-(?:display|serif|mono)\b/g) ?? [];

describe("the row's ONE label size, read where it is actually declared", () => {
  const sources = ROW_PRIMITIVE_FILES.map(
    (rel) => [rel, readFileSync(join(ROOT, rel), "utf8")] as const,
  );

  it("JOB_ROW_LABEL_CLASS declares a size, and it is the row's one size", () => {
    const m = /export const JOB_ROW_LABEL_CLASS = "([^"]+)"/.exec(sources[0][1]);
    expect(m, "JOB_ROW_LABEL_CLASS was renamed or moved out of JobActionRow.tsx").not.toBeNull();
    const tokens = typeTokens(m![1]);
    expect(tokens.length, `the row label class "${m![1]}" declares no type size at all`)
      .toBeGreaterThan(0);
    for (const t of tokens) {
      expect(
        SANCTIONED.has(t),
        `the row's label is ${t} — every control in the row is ONE object at ONE size (text-ds-11)`,
      ).toBe(true);
    }
  });

  it("no control in those files declares a size of its own beside it", () => {
    const strays = sources.flatMap(([rel, src]) =>
      src
        .split("\n")
        .flatMap((line, i) =>
          line.includes("JOB_ROW_LABEL_CLASS =")
            ? []
            : typeTokens(line).map((t) => `${rel}:${i + 1} → ${t}`),
        ),
    );
    expect(
      strays,
      "a row control sizing itself instead of wearing JOB_ROW_LABEL_CLASS",
    ).toEqual([]);
  });
});

// The row's ONE type size, where it is actually declared.
// @mutate src/components/activity/JobActionRow.tsx | export const JOB_ROW_LABEL_CLASS = "text-ds-11 leading-tight font-medium"; | export const JOB_ROW_LABEL_CLASS = "text-ds-12 leading-tight font-medium";
