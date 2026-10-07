/**
 * THE CLASS: pressing a centred control must not move it out from under the
 * pointer.
 *
 * OWNER, 2026-10-01, two reports, one cause:
 *   (1) "the x button in jobs does not work"
 *   (2) the same X on /profile?tab=saved_helpers at 1440 "does nothing when
 *       clicked"
 *
 * Every search clear-X is centred with Tailwind `top-1/2 -translate-y-1/2`
 * and wears a shared press primitive (`.btn-press` / `.glass-press`). Those
 * primitives are UNLAYERED rules with `:active` (specificity 0,2,0), which
 * beats `.-translate-y-1/2` (0,1,0). A bare `transform: scale(0.97)` on
 * :active therefore REPLACED the translate: on press the X dropped ~14px
 * (measured: rect y 89 -> 103.42 on /jobs, 156 -> 170.42 on saved_helpers),
 * mouseup landed on the input, and the click never fired. An automated
 * centre click still passed; a human pressing the upper part of the glyph
 * did not.
 *
 * This file holds two things, both derived from source:
 *   A. every `:active` rule in src/**\/*.css that sets `transform` composes
 *      the Tailwind translate vars back in, so a translated element keeps its
 *      place while pressed;
 *   B. the inventory of every X button (renders `<X`) whose className
 *      centres it with a `-translate-` utility — the search clear-Xs and
 *      anything built like them — and every press class it wears is one
 *      that check A covered. A new press primitive must be added to A's
 *      CSS (with the translate) before an X may wear it.
 * The browser half (the X's rect does not move on :active, and one
 * off-centre press closes the field) is e2e/prod-audit/search-x-off-center-press.spec.ts.
 */
// @mutate src/index.css | here to this. */\n  transform: translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0)) scale(0.97); | here to this. */\n  transform: scale(0.97);
// @mutate src/index.css | `.btn-press:active`. */\n  transform: translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0)) scale(0.97); | `.btn-press:active`. */\n  transform: scale(0.97);
// @mutate src/index.css | Chromium and WebKit, 2026-10-07). Keep the translate, drop the rest. */\n    transform: translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0)); | Chromium and WebKit, 2026-10-07). Keep the translate, drop the rest. */\n    transform: none;
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "src");

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "__tests__" || name === "node_modules") continue;
      walk(p, exts, out);
    } else if (exts.some((e) => name.endsWith(e)) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** CSS comments only (`/* *\/`), string-aware: a `/*` inside a quoted string
 * is left alone. blankComments is JS-aware and would read an unquoted `//`
 * inside a CSS `url()` as a line comment, so CSS gets its own scanner.
 * Offsets and line count preserved. */
function blankCssComments(src: string): string {
  const out = src.split("");
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close < 0 ? src.length : close + 2;
      for (let k = i; k < end; k++) if (out[k] !== "\n") out[k] = " ";
      i = end;
      continue;
    }
    i++;
  }
  return out.join("");
}

interface ActiveRule { file: string; selector: string; transform: string }

/** Every innermost `selector { ... }` block whose selector has `:active` and
 * whose body declares `transform`. Walks braces so rules inside @media are
 * found with their own selector. */
function activeTransformRules(match: (selector: string) => boolean = (sel) => sel.includes(":active")): ActiveRule[] {
  const out: ActiveRule[] = [];
  for (const file of walk(SRC, [".css"])) {
    const css = blankCssComments(readFileSync(file, "utf8"));
    const stack: number[] = [];
    for (let i = 0; i < css.length; i++) {
      if (css[i] === "{") stack.push(i);
      else if (css[i] === "}") {
        const open = stack.pop();
        if (open === undefined) continue;
        const body = css.slice(open + 1, i);
        if (body.includes("{")) continue; // not innermost
        const prevEnd = Math.max(css.lastIndexOf("}", open - 1), css.lastIndexOf("{", open - 1), css.lastIndexOf(";", open - 1));
        const selector = css.slice(prevEnd + 1, open).trim();
        if (!match(selector)) continue;
        const m = /(?:^|[;\s])transform\s*:\s*([^;]+)/.exec(body);
        if (!m) continue;
        out.push({ file: path.relative(ROOT, file), selector, transform: m[1].trim() });
      }
    }
  }
  return out;
}

interface XButton { file: string; line: number; className: string }

/** Every `<button ...>...</button>` in src/**\/*.tsx that renders a lucide
 * `<X` and whose className carries a `-translate-` utility. */
function translatedXButtons(): XButton[] {
  const out: XButton[] = [];
  for (const file of walk(SRC, [".tsx"])) {
    const raw = readFileSync(file, "utf8");
    const src = blankComments(raw);
    let from = 0;
    for (;;) {
      const start = src.indexOf("<button", from);
      if (start < 0) break;
      const end = src.indexOf("</button>", start);
      if (end < 0) break;
      from = start + 7;
      const el = src.slice(start, end);
      // Nested <button> means this slice is not one element; the inner one is visited on its own.
      if (el.indexOf("<button", 7) >= 0) continue;
      if (!/<X[\s/>]/.test(el)) continue;
      const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(el);
      const className = cls ? (cls[1] ?? cls[2]) : "";
      if (!/(^|\s)-?translate-[xy]-/.test(className)) continue;
      out.push({ file: path.relative(ROOT, file), line: raw.slice(0, start).split("\n").length, className });
    }
  }
  return out;
}

describe("press feedback keeps a centred control in place (owner 2026-10-01: dead search X)", () => {
  const rules = activeTransformRules();

  it("finds the press primitives' :active rules (the scan is not blind)", () => {
    const selectors = rules.map((r) => r.selector);
    expect(selectors).toContain(".btn-press:active");
    expect(selectors).toContain(".glass-press:active");
    // EXACT: two primitives, each with a normal and a reduced-motion :active rule.
    expect(rules.length).toBe(4);
  });

  it("Q910: every press-primitive rule that sets a transform, at REST too, keeps the translate", () => {
    // `.btn-press { transform: none }` under Reduce Motion is unlayered and
    // after Tailwind's utilities at equal specificity, so it erased
    // `-translate-y-1/2` with no press at all: every search clear-X sat 22px
    // low for anyone with Reduce Motion on (measured Chromium + WebKit,
    // 2026-10-07). The browser half is search-x-off-center-press.spec.ts's
    // reduced-motion pass.
    const press = activeTransformRules((sel) => /\.[\w-]*press\b/.test(sel));
    // EXACT: btn-press :active, its reduced-motion rest and :active, and
    // glass-press :active and its reduced-motion :active.
    expect(press.map((r) => r.selector).sort()).toEqual([
      ".btn-press", ".btn-press:active", ".btn-press:active", ".glass-press:active", ".glass-press:active",
    ]);
    const bad = press.filter((r) => !r.transform.includes("var(--tw-translate-x") || !r.transform.includes("var(--tw-translate-y"));
    expect(bad, `press rules that replace a -translate-* utility:\n${bad.map((r) => `${r.file}  ${r.selector} { transform: ${r.transform} }`).join("\n")}`).toEqual([]);
  });

  it("every :active transform composes the Tailwind translate back in", () => {
    const bad = rules.filter(
      (r) => !r.transform.includes("var(--tw-translate-x") || !r.transform.includes("var(--tw-translate-y"),
    );
    expect(bad, `these :active rules replace a -translate-* utility on press:\n${bad.map((r) => `${r.file}  ${r.selector} { transform: ${r.transform} }`).join("\n")}`).toEqual([]);
  });

  it("every translated X button wears only press classes that rule covers", () => {
    const xs = translatedXButtons();
    const files = new Set(xs.map((x) => x.file));
    // Inventory, EXACT: the six search clear-Xs (BrowseSearchBar,
    // ConversationList, SavedHelpersTab, PostsHeader, JobsHeader, Legal)
    // plus ChatView's safety-banner dismiss. A new one fails here until it is
    // reviewed; a removed one fails too.
    expect([...files].sort()).toEqual([
      "src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx",
      "src/components/messages/ChatView.tsx",
      "src/components/messages/ConversationList.tsx",
      "src/components/profile/SavedHelpersTab.tsx",
      "src/pages/info/Legal.tsx",
      "src/pages/jobs/JobsHeader.tsx",
      "src/pages/posts/PostsHeader.tsx",
    ]);
    expect(xs.length).toBe(7);

    // Any class on these Xs that has an :active transform rule anywhere in
    // src CSS was checked translate-safe above, so the class is covered. What
    // remains to rule out is a press class the CSS scan cannot see (a typo,
    // a class defined in a component's own stylesheet that moved): every
    // `*press*` class an X wears must be one of the scanned primitives.
    const covered = new Set(
      rules.map((r) => /^\.([\w-]+):active$/.exec(r.selector)?.[1]).filter((c): c is string => !!c),
    );
    const bad = xs.flatMap((x) =>
      x.className.split(/\s+/).filter((c) => /press/.test(c) && !covered.has(c)).map((c) => `${x.file}:${x.line} wears ${c}`),
    );
    expect(bad, `press classes with no translate-safe :active rule:\n${bad.join("\n")}`).toEqual([]);
    // The six search Xs are the ones that press; ChatView's dismiss has no
    // press feedback, so it has no :active transform to lose its centring to.
    expect(xs.filter((x) => x.className.split(/\s+/).some((c) => covered.has(c))).length).toBe(6);
  });
});
