/**
 * Builder 187 (11-02, measured in a local build at 375): the seller's money-note "Details" (Q2634) and Free's
 * "How it works" are InlineTextButtons (class link-standard) that also ask for Tailwind's `underline`. link-standard
 * sets `text-decoration-color: transparent` at rest (the underline appears on hover), so the asked-for underline
 * computed rgba(0, 0, 0, 0) and never drew: the class test that only read the className stayed green.
 *
 * The class: every link-standard in src that asks for `underline` draws it, because index.css gives
 * `.link-standard.underline` the text colour in the same components layer (two classes outrank link-standard's one).
 * Inventory: every TSX file that puts `underline` on an InlineTextButton or a link-standard element.
 *
 * @mutate src/index.css |   .link-standard.underline {\n    text-decoration-color: currentColor;\n  } |   .link-standard.underline {\n    text-decoration-color: transparent;\n  }
 * @mutate src/index.css |   .link-standard.underline { |   .link-standard.underlined {
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith(".tsx") && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

/** The body of the top-level `@layer components { ... }` block that holds `.link-standard {`. */
function componentsLayerWithLinkStandard(css: string): string {
  let from = 0;
  for (;;) {
    const at = css.indexOf("@layer components", from);
    if (at < 0) return "";
    const open = css.indexOf("{", at);
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === "{") depth++;
      else if (css[end] === "}" && --depth === 0) break;
    }
    const body = css.slice(open + 1, end);
    if (/(^|\n)\s*\.link-standard\s*\{/.test(body)) return body;
    from = end;
  }
}

describe("a link-standard that asks for an underline draws it", () => {
  it("every such link in src is covered by .link-standard.underline taking the text colour", () => {
    const users = tsxFiles("src").filter((f) => {
      const src = blankComments(readFileSync(f, "utf8"));
      return /<InlineTextButton\b[^>]*className="[^"]*\bunderline\b(?!-)/.test(src) || /className="[^"]*\blink-standard\b[^"]*\bunderline\b(?!-)/.test(src);
    });
    // Today: the money note (DeclutterPorchHandover) and Free's "How it works" (DeclutterFreeClaim).
    expect(users.length).toBeGreaterThan(1);
    const layer = componentsLayerWithLinkStandard(blankCssComments(readFileSync("src/index.css", "utf8")));
    expect(layer.length).toBeGreaterThan(200);
    // link-standard's own rest colour is transparent: that is what hid the underline.
    expect(layer).toMatch(/\.link-standard\s*\{[^}]*text-decoration-color:\s*transparent/);
    const rule = layer.match(/\.link-standard\.underline\s*\{([^}]*)\}/);
    expect(rule, `index.css @layer components needs .link-standard.underline (used by ${users.join(", ")})`).not.toBeNull();
    expect(rule![1]).toMatch(/text-decoration-color:\s*currentColor\s*;/);
  });
});
