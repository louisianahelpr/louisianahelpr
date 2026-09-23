import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

/**
 * Exactly ONE `<main>` landmark in the whole app, owned by App.tsx.
 *
 * App.tsx wraps every route in `<main id="main-content">`, so any page, shell
 * or layout that renders its own `<main>` (or `role="main"`) nests a second
 * main landmark inside the first. That is three WCAG failures at once in axe
 * (landmark-main-is-top-level, landmark-no-duplicate-main, landmark-unique) and
 * a screen reader announcing "main" twice.
 *
 * Found 2026-09-23 (docs/OPEN.md Q211, Q181 axe sweep run 35888653918): the
 * admin console's scroll container was a `<main>`, so all 26 admin screens
 * carried the three violations (78 baseline entries, Chromium and WebKit alike).
 *
 * Derived from the source tree, not a hand list: every .ts/.tsx under src/
 * (tests excluded) is scanned with comments blanked, and each JSX `<main`
 * opener, `role="main"` / `role: "main"` and `as="main"` counts as an owner.
 */

// @mutate src/pages/Admin.tsx | <div data-admin-scroll | <main data-admin-scroll
// @mutate src/App.tsx | <main\n            id="main-content" | <div\n            id="main-content"

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "test" || e.name === "__tests__" || e.name === "node_modules") continue;
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

const OWNER = /<main[\s>]|\brole\s*[=:]\s*\{?\s*["'`]main["'`]|\bas\s*=\s*\{?\s*["'`]main["'`]/g;

function owners(): string[] {
  const found: string[] = [];
  for (const f of sourceFiles(SRC)) {
    const code = blankComments(readFileSync(f, "utf8"));
    for (const m of code.matchAll(OWNER)) {
      const line = code.slice(0, m.index).split("\n").length;
      found.push(`${relative(join(SRC, ".."), f)}:${line}`);
    }
  }
  return found;
}

describe("one <main> landmark per page (Q211)", () => {
  it("scans the real source tree", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(300);
  });

  it("App.tsx is the only component that renders a main landmark", () => {
    const found = owners();
    expect(
      found,
      "a second <main>/role=main nests inside App.tsx's <main id=\"main-content\">: " +
        "use a <div> (or <section aria-label>) for page/scroll containers",
    ).toHaveLength(1);
    expect(found[0]).toMatch(/^src\/App\.tsx:\d+$/);
  });
});
