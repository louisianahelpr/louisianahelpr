/**
 * Q1288 — every empty and error screen has the SAME space above its title
 * (owner decision, 2026-10-12: "remove the extra gap", so all empty screens
 * look the same).
 *
 * WHAT WAS WRONG: EmptyState rendered an optional `eyebrow` as a display:none
 * span ahead of the title inside a `space-y-2` stack. A hidden element still
 * counts for Tailwind's `~` sibling selector, so every screen that passed an
 * eyebrow got an extra 0.5rem above its title and the rest did not. ErrorState
 * passed one by default ("Hiccup on our end"), and 9 call sites passed their
 * own, so error screens and those 9 empty screens sat 8px lower than the others.
 *
 * THE RULE, kept in the one shared primitive: EmptyState (and ErrorState,
 * which renders it) has no eyebrow, the title is the copy stack's first
 * child, and no call site passes an eyebrow.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { Inbox } from "lucide-react";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";

const REPO = resolve(__dirname, "..", "..");
const SRC = join(REPO, "src");
const TAGS = new Set(["EmptyState", "ErrorState"]);

/** The copy stack is the title's parent; the title must open it. */
function expectTitleFirst(titleText: string) {
  const title = screen.getByText(titleText);
  const stack = title.parentElement as HTMLElement;
  expect(stack.className).toContain("space-y-2");
  expect(stack.firstElementChild, "nothing (not even a hidden span) may sit above the title").toBe(title);
}

describe("Q1288: one title gap on every empty and error screen", () => {
  it("EmptyState: the title is the first thing in its copy stack", () => {
    render(<EmptyState icon={Inbox} title="Nothing here yet" body="b" />);
    expectTitleFirst("Nothing here yet");
  });

  it("ErrorState with its defaults: same, no default kicker above the title", () => {
    render(<ErrorState />);
    expectTitleFirst("We couldn't load this.");
  });

  it("neither primitive offers an eyebrow any more", () => {
    for (const f of ["src/components/ui/EmptyState.tsx", "src/components/ui/ErrorState.tsx"]) {
      const code = blankComments(readFileSync(join(REPO, f), "utf8"));
      expect(code.length).toBeGreaterThan(500);
      expect(code, `${f} must not take or render an eyebrow`).not.toMatch(/\beyebrow\b/);
    }
  });

  it("no call site passes an eyebrow (or spreads props it cannot see)", () => {
    const files = walkSource([SRC]).filter(
      (f) => f.endsWith(".tsx") && !f.startsWith(join(SRC, "test") + "/"),
    );
    let sites = 0;
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (!/<(EmptyState|ErrorState)\b/.test(text)) continue;
      const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (n: ts.Node) => {
        if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && TAGS.has(n.tagName.getText(sf))) {
          sites++;
          for (const a of n.attributes.properties) {
            const where = `${relative(REPO, f)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
            if (ts.isJsxSpreadAttribute(a)) bad.push(`${where} spreads props into <${n.tagName.getText(sf)}>`);
            else if (a.name.getText(sf) === "eyebrow") bad.push(`${where} passes eyebrow`);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    // Inventory floor: the scan must actually find the app's empty/error states.
    expect(sites).toBeGreaterThan(60);
    expect(bad).toEqual([]);
  });
});

// @mutate src/components/ui/EmptyState.tsx |           {title && ( |           <span className="hidden" />{title && (
// @mutate src/pages/home/DashboardGuest.tsx |             title="You're offline." |             eyebrow="Offline" title="You're offline."
// @mutate src/components/ui/ErrorState.tsx |   title = "We couldn't load this.", |   eyebrow = "Hiccup on our end", title = "We couldn't load this.",
