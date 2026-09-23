// @mutate src/components/OfflineBanner.tsx | data-rail-inset | data-rail-off
/**
 * THE RIGHT RAIL MUST NOT SIT ON TOP OF A FIXED PAGE SURFACE.
 *
 * Owner, 2026-09-22: "in webpage, the messages go behind the right panel. fix
 * this and any other occurances this happens with" — the ask is the CLASS, not
 * the one screen.
 *
 * The class has one shape. `src/index.css` insets the rail in exactly two
 * shared places, `.app-shell-frame { right: var(--desktop-sidebar-w) }` and
 * `#root { padding-right: var(--desktop-sidebar-w) }`, and BOTH move the
 * document. An element with `position: fixed` resolves against the viewport
 * instead, so neither inset reaches it: it keeps spanning the full 1440 and
 * the rail lands on its right 248px. That is why the sonner toast needed its
 * own rule, and it is why every other fixed page bar needs one too.
 *
 * This guard is the static half — it derives the inventory from the app's own
 * source (every `position: fixed` element that also pins BOTH horizontal
 * edges) and fails when a new one appears that neither opts into
 * `data-rail-inset` nor is listed below as deliberately full-width. The
 * runtime half is scripts/audit/rail-overlap-probe.mjs, which drives the built
 * app signed in at 1440 with the panel open and asserts
 * `getBoundingClientRect().right <= innerWidth - 248`.
 *
 * SHOWN RED: with the six `data-rail-inset` attributes removed, this test
 * reports all six files as unhandled.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

/** Full-width on purpose: the hamburger that TOGGLES the rail lives in their
 *  right edge, so insetting them would hide the control under the panel it
 *  opens. MobileNav/Navbar are the phone surface and never coexist with the
 *  rail (`web-desktop` gates it). */
const DELIBERATELY_FULL_WIDTH = new Set([
  "src/components/DesktopTopNav.tsx",
  "src/components/admin/AdminTopBar.tsx",
  "src/components/MobileNav.tsx",
  "src/components/Navbar.tsx",
  // /browse's loading frame restates Navbar's fixed glass bar (Q169) for guests; the rail is signed-in only.
  "src/components/GuestBrowseSkeleton.tsx",
  // AppShell IS the frame the rail insets — index.css moves it by `right`.
  "src/components/AppShell.tsx",
]);

/** `inset-0` scrims (dialog/sheet/popover) are meant to cover the rail too. */
const SCRIM = /\binset-0\b/;
/** Pins both horizontal edges: `inset-x-0`, or `left-0` + `right-0`, or w-screen. */
const FULL_WIDTH = [/\binset-x-0\b/, /\bw-screen\b/];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

function fixedFullWidthLines(text: string): string[] {
  const hits: string[] = [];
  for (const line of text.split("\n")) {
    if (!/\bfixed\b/.test(line)) continue;
    if (!/className/.test(line)) continue;
    if (SCRIM.test(line)) continue;
    const spansBoth =
      FULL_WIDTH.some((re) => re.test(line)) ||
      (/\bleft-0\b/.test(line) && /\bright-0\b/.test(line));
    if (spansBoth) hits.push(line.trim());
  }
  return hits;
}

describe("desktop rail never overlaps a fixed page surface", () => {
  it("every fixed full-width surface either insets or is an allowed exception", () => {
    const unhandled: string[] = [];
    const files = walk(SRC);
    expect(files.length, "walked no source files").toBeGreaterThan(300);
    for (const file of files) {
      const rel = file.slice(process.cwd().length + 1);
      if (DELIBERATELY_FULL_WIDTH.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      const hits = fixedFullWidthLines(text);
      if (!hits.length) continue;
      if (text.includes("data-rail-inset")) continue;
      unhandled.push(`${rel}: ${hits[0]}`);
    }
    expect(
      unhandled,
      "These render `position: fixed` spanning both viewport edges, so neither " +
        "shared rail inset reaches them and the rail sits on their right 248px. " +
        "Add `data-rail-inset` (see the rule in src/index.css), or add the file " +
        "to DELIBERATELY_FULL_WIDTH with the reason.",
    ).toEqual([]);
  });

  it("the shared rule exists and is gated on the same three classes as the insets", () => {
    const css = readFileSync(join(SRC, "index.css"), "utf8");
    expect(css).toMatch(
      /html\.web-desktop\.desktop-rail\.side-panel-open \[data-rail-inset\]\s*\{\s*right:\s*var\(--desktop-sidebar-w\);/,
    );
  });

  it("no page re-insets itself by the rail width", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      // A per-page hard-coded rail width is the forbidden fix (CLAUDE.md).
      for (const line of text.split("\n")) {
        if (/(pr|padding-right|margin-right|mr)[-:\s]*\[?248px\]?/.test(line) && !line.trim().startsWith("*") && !line.trim().startsWith("//")) {
          offenders.push(`${file.slice(process.cwd().length + 1)}: ${line.trim()}`);
        }
      }
    }
    expect(offenders, "A page never re-insets itself — the rail is inset in one shared layer.").toEqual([]);
  });
});
