/**
 * Q265 + Q214: the bottom-dock clearance is ONE token, owned by the shell layer.
 *
 * THE CLASS. The floating MobileNav dock + Post FAB reach `safe-area + 96px`
 * above the viewport floor. Every surface that clears them — AppShell's scroll
 * padding, Profile/AppPage's tab column, the empty-state bleed, the floating
 * bulk-select bars, the toast, the Post-a-Job step footer — had re-typed that
 * sum per screen, eleven ways: `+ 96px`, `+ 6rem`, `+ 112px`, `6rem +`, one at
 * `+ 80px` (Q214's BulkDismissBar, 16px short of the dock), and three reading
 * `env(safe-area-inset-bottom)` directly, which WebKit resolves to 0 inside
 * PageTransition's transform (see index.css `--safe-area-bottom`). One screen
 * (Profile › Legal) stacked a second copy under the shared column's first.
 *
 * Now: `--dock-clearance` is declared once in index.css `:root`, collapses
 * with `html.no-bottom-nav`, and feeds Tailwind's `safe-nav` / `dock` spacing.
 *
 * TWO-WAY, from the source tree itself (not a list this test owns):
 *   - no ts/tsx code outside tests hand-types a dock-sized literal next to the
 *     bottom inset, reads `--bottom-nav-h` itself, or reads
 *     `env(safe-area-inset-bottom)` directly — and that offender list is EXACT
 *     (zero, no allowlist);
 *   - the token is actually consumed (inventory floor), by the shell primitive
 *     first of all, so deleting the token and the copies together cannot pass.
 *
 * @mutate src/pages/activity/BulkDismissBar.tsx | bottom: "var(--dock-clearance)", | bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)",
 * @mutate src/components/AppShell.tsx | ? "var(--dock-clearance)" | ? "calc(var(--safe-area-bottom, 0px) + 96px)"
 * @mutate src/pages/Profile.tsx | overflow-y-auto px-3 -mx-3 pb-safe-nav | overflow-y-auto px-3 -mx-3 pb-[calc(var(--safe-area-bottom,0px)_+_96px_+_1rem)]
 * @mutate src/components/profile/LegalTab.tsx | <ProfileTabBody> | <ProfileTabBody bottomClearance="calc(var(--safe-area-bottom, 0px) + 6rem)">
 * @mutate src/components/dashboard/BrowseTasksFeed.tsx | style={{ paddingBottom: "var(--dock-clearance)" }} | style={{ paddingBottom: "calc(6rem + var(--safe-area-bottom, 0px))" }}
 * @mutate src/index.css | --dock-clearance: calc(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px)); | --dock-clearance: calc(var(--safe-area-bottom, 0px) + 96px);
 * @mutate tailwind.config.ts | "safe-nav": "calc(var(--dock-clearance) + 1rem)", | "safe-nav": "calc(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px) + 1rem)",
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";

const REPO = resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

const isTest = (rel: string) =>
  rel.startsWith("src/test/") || /\.(test|spec)\.tsx?$/.test(rel);

/** Every non-test ts/tsx file under src, comments blanked (strings kept). */
const SOURCES = walkSource([resolve(REPO, "src")])
  .map((abs) => ({ rel: relative(REPO, abs).split("\\").join("/"), src: readSource(abs) }))
  .filter((f): f is { rel: string; src: string } => f.src !== null && !isTest(f.rel))
  .map((f) => ({ rel: f.rel, code: blankComments(f.src) }));

// The dock's height in the spellings it was hand-typed in (96px, 6rem, 80px,
// 5rem, 112px = 96+16, 7rem = 112px). A SaveBar's 6.5rem or the admin bar's
// 4.5rem clear other things and are not the dock.
const DOCK_LITERAL = /(?<![\d.])(96px|6rem|80px|5rem|112px|7rem)(?![a-zA-Z0-9])/; // not \b: Tailwind `_+_96px_` has no word boundary after px
const BOTTOM_INSET = /safe-area-bottom|safe-area-inset-bottom/;

function offenders(): string[] {
  const out: string[] = [];
  for (const { rel, code } of SOURCES) {
    code.split("\n").forEach((line, i) => {
      const at = `${rel}:${i + 1}: ${line.trim()}`;
      if (BOTTOM_INSET.test(line) && DOCK_LITERAL.test(line)) out.push(`hand-typed dock clearance — ${at}`);
      else if (/env\(\s*safe-area-inset-bottom/.test(line)) out.push(`bare env() bottom inset — ${at}`);
      else if (/--bottom-nav-h/.test(line)) out.push(`reads --bottom-nav-h, not --dock-clearance — ${at}`);
    });
  }
  return out;
}

describe("Q265: the dock clearance is one token", () => {
  it("is declared once in index.css :root and collapses with the dock", () => {
    const css = read("src/index.css");
    const decls = css.match(/--dock-clearance\s*:[^;]+;/g) ?? [];
    expect(decls, "exactly one --dock-clearance declaration").toHaveLength(1);
    expect(decls[0]).toMatch(/var\(--safe-area-bottom[^)]*\)/);
    expect(decls[0], "must read --bottom-nav-h so html.no-bottom-nav collapses it").toMatch(/var\(--bottom-nav-h/);
    expect(css).toMatch(/html\.no-bottom-nav\s*\{\s*--bottom-nav-h:\s*0px;/);
  });

  it("Tailwind's safe-nav and dock spacing read the token", () => {
    const tw = read("tailwind.config.ts");
    expect(tw).toMatch(/"safe-nav":\s*"calc\(var\(--dock-clearance\) \+ 1rem\)"/);
    expect(tw).toMatch(/\bdock:\s*"var\(--dock-clearance\)"/);
  });

  it("the shell primitive owns it: AppShell's reserveBottomNav clearance IS the token", () => {
    const m = /reserveBottomNav\s*\n?\s*\?\s*"([^"]+)"/.exec(blankComments(read("src/components/AppShell.tsx")));
    expect(m?.[1]).toBe("var(--dock-clearance)");
  });

  it("Q214: BulkDismissBar floats on the token, not a hand-typed env() + 80px", () => {
    const code = blankComments(read("src/pages/activity/BulkDismissBar.tsx"));
    expect(code).toMatch(/bottom:\s*"var\(--dock-clearance\)"/);
  });

  it("no screen re-implements it (exact: zero, no allowlist)", () => {
    expect(SOURCES.length, "the walker found the source tree").toBeGreaterThan(500);
    expect(offenders()).toEqual([]);
  });

  it("the token is consumed across the app (inventory floor)", () => {
    const consumers = SOURCES.filter(({ code }) =>
      /--dock-clearance|\bpb-safe-nav\b|\bpb-dock\b|MAP_DOCK_CLEARANCE/.test(code),
    ).map((f) => f.rel);
    for (const must of [
      "src/components/AppShell.tsx",
      "src/pages/activity/BulkDismissBar.tsx",
      "src/components/messages/ConversationList.tsx",
      "src/pages/Profile.tsx",
      "src/components/AppPage.tsx",
    ]) expect(consumers).toContain(must);
    // Measured 19 on 2026-09-23; the floor sits one under it.
    expect(consumers.length).toBeGreaterThan(18);
  });
});
