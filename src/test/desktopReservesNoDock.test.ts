/**
 * Q836: the desktop website hides the bottom dock, so nothing may reserve room
 * for it. `--bottom-nav-h` feeds every dock clearance (`pb-safe-nav`, the
 * AppShell scroller, the inline `var(--bottom-nav-h, 96px)` sites), and it was
 * zeroed only by `html.no-bottom-nav`, which MobileNav sets for guests,
 * unverified emails and no-nav pages. A signed-in desktop page therefore kept
 * a 112px empty band under its last row (measured on prod at 1440,
 * 2026-10-07: /user/:id `.pb-safe-nav` padding-bottom 112px, the Profile
 * scroller 112px, `.mobile-nav-frame` display none).
 *
 * Inventory from source: every innermost rule in src/index.css that hides
 * `.mobile-nav-frame` under `html.web-desktop`. Each must sit in an at-rule
 * block that also zeroes `--bottom-nav-h` on `html.web-desktop`, so the rule
 * that hides the dock and the one that drops its clearance cannot drift apart.
 *
 * @mutate src/index.css | html.web-desktop {\n    --bottom-nav-h: 0px;\n  } | html.web-desktop {\n    --bottom-nav-h-unused: 0px;\n  }
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankCssComments } from "./helpers/blankNonCode";

const CSS = blankCssComments(readFileSync(resolve(__dirname, "..", "index.css"), "utf8"));

interface Block { selector: string; body: string; parent: string }

/** Innermost `selector { body }` blocks, each with its enclosing block's prelude. */
function blocks(css: string): Block[] {
  const out: Block[] = [];
  const stack: { open: number; prelude: string }[] = [];
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") {
      const prevEnd = Math.max(css.lastIndexOf("}", i - 1), css.lastIndexOf("{", i - 1), css.lastIndexOf(";", i - 1));
      stack.push({ open: i, prelude: css.slice(prevEnd + 1, i).trim() });
    } else if (css[i] === "}") {
      const top = stack.pop();
      if (!top) continue;
      const body = css.slice(top.open + 1, i);
      if (body.includes("{")) continue;
      out.push({ selector: top.prelude, body, parent: stack.length ? `${stack[stack.length - 1].prelude}@${stack[stack.length - 1].open}` : "" });
    }
  }
  return out;
}

describe("the desktop website reserves no room for the dock it hides (Q836)", () => {
  const all = blocks(CSS);
  const hides = all.filter((b) => /html\.web-desktop\s+\.mobile-nav-frame/.test(b.selector) && /display\s*:\s*none/.test(b.body));

  it("finds the rule that hides the dock on desktop", () => {
    expect(all.length).toBeGreaterThan(100);
    expect(hides.length).toBeGreaterThan(0);
  });

  it("every block that hides the dock also zeroes --bottom-nav-h on html.web-desktop", () => {
    for (const h of hides) {
      const zero = all.some(
        (b) => b.parent === h.parent && /^html\.web-desktop$/.test(b.selector) && /--bottom-nav-h\s*:\s*0(px)?\s*(;|$)/.test(b.body.trim()),
      );
      expect(zero, `${h.parent || "top level"}: hides .mobile-nav-frame but leaves --bottom-nav-h reserving the dock's clearance`).toBe(true);
    }
  });
});
