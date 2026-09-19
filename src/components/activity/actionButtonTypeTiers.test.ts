import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * ONE TYPE SCALE FOR THE ACTIVITY CARDS' BUTTONS (owner, 2026-09-19: "the
 * buttons word size and font need to be consistent bc rn they are not").
 *
 * THE TIERS ARE REAL AND THIS DOES NOT FLATTEN THEM. The cards run exactly two:
 *
 *   CHIP     11px, Montserrat, 44px tap target — the icon-over-label control
 *            (`JobActionChip`). The 11px lives on the chip's LABEL SPAN, not on
 *            the button, which is why a BUTTON declaring 11px is drift by
 *            definition: it is a flat text button borrowing the chip's size
 *            without being one.
 *   PRIMARY  14px, Montserrat, 44px — the row's one main move. It comes from
 *            `size="sm"` (button.tsx: `h-11 px-4 text-ds-14`), so the correct
 *            primary declares NO font size at all.
 *
 * docs/OPEN.md records 11-vs-14 as deliberate hierarchy (V5), and the two
 * shell-owned exceptions are CSS, not classes: index.css steps a squeezed
 * primary down to 12px (`[data-tight]`) and hides chip labels outright
 * (`[data-compact]`). Both belong to the row, which is the point — a step file
 * never decides its own type.
 *
 * So the rule a button in this tree must satisfy is narrow and mechanical:
 * declare NO type size (inherit the sanctioned one) or declare exactly
 * `text-ds-14`, and never re-declare the font family. What this catches is the
 * next 12px primary or 11px text button, which is how the three fixed on
 * 2026-09-19 got in:
 *
 *   JobConfirmation "I'm Still On"        text-ds-12 on a row primary
 *   PendingApplicationSection "Save"      text-ds-11 on a glossy primary
 *   PendingApplicationSection "Cancel"    text-ds-11 on a flat text button
 *
 * THE INVENTORY IS DERIVED, not listed: every non-test .tsx under
 * src/components/activity, plus the one component outside it that renders a
 * control INTO a step row (JobConfirmation). A new step file is covered the
 * day it is written.
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
  const list = [
    ...walk(join(ROOT, "src/components/activity")),
    join(ROOT, "src/components/JobConfirmation.tsx"),
  ].map((p) => relative(ROOT, p));
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

const SANCTIONED = new Set(["text-ds-14"]);

describe("activity card action buttons — one type scale", () => {
  const tags = buttonTags();

  it("finds the buttons at all (a scanner that matches nothing passes everything)", () => {
    expect(files().length).toBeGreaterThan(20);
    expect(tags.length).toBeGreaterThan(20);
    // The chip primitive and the row primary must both be in the inventory, or
    // the glob has drifted away from the tree this rule is about.
    expect(tags.some((t) => t.where.startsWith("src/components/activity/JobActionRow.tsx"))).toBe(true);
  });

  it("declares no type size but the primary tier", () => {
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
      "an action button below (or between) the sanctioned tiers: the 11px tier is the chip's LABEL SPAN, and a row primary is 14px",
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
    // names `font-display` or `font-serif` is the other half of the owner's
    // report ("word size and FONT").
    const fonts = tags.flatMap((t) =>
      [...t.text.matchAll(/\bfont-(display|serif|mono)\b/g)].map((x) => `${t.where} → ${x[0]}`),
    );
    expect(fonts, "an action button in a second typeface").toEqual([]);
  });
});
