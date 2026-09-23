/**
 * CLASS CHECK: every rule that insets #root for the right rail on a
 * document-scroll route (`:not(.app-shell) #root { padding-right }`) must be
 * handed over to the frame for a page that mounts an AppShell frame:
 *   `…:not(.app-shell) #root:has(.app-shell-frame) { padding-right: 0 }` and
 *   `…:not(.app-shell) .app-shell-frame { right: var(--desktop-sidebar-w) }`.
 *
 * Q179 (2026-09-23 visual walk, measured at 1440 on prod as poster-e2e):
 * signed in, PublicLayout renders AppShell on /help, /support and the four
 * Legal routes, which stay document-scroll (no `app-shell` on <html>). The
 * frame inset rule required `.app-shell`, and #root's padding cannot reach a
 * `position: fixed` frame, so the frame ran to x=1440 under the rail (from
 * x=1192): Help's accordion chevrons and its "Contact Support" button were
 * covered. Twin of rootPaddingVsAppShellFrame.test.ts (VN-24, the top offset).
 *
 * Inventory comes from src/index.css itself (postcss).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import postcss from "postcss";

// @mutate src/index.css | html.web-desktop.desktop-rail.side-panel-open:not(.app-shell) .app-shell-frame { | html.web-desktop.desktop-rail.side-panel-open.x:not(.app-shell) .app-shell-frame {
// @mutate src/index.css | html.web-desktop.desktop-rail.side-panel-open:not(.app-shell) #root:has(.app-shell-frame) { | html.web-desktop.desktop-rail.side-panel-open.x:not(.app-shell) #root:has(.app-shell-frame) {

type Found = { padded: string[]; cancelled: Set<string>; frames: Set<string> };

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

function inventory(css: string): Found {
  const padded: string[] = [];
  const cancelled = new Set<string>();
  const frames = new Set<string>();
  postcss.parse(css).walkRules((rule) => {
    const decl = (prop: string) =>
      (rule.nodes.find((n) => n.type === "decl" && (n as postcss.Declaration).prop === prop) as
        | postcss.Declaration
        | undefined)?.value.trim();
    const padR = decl("padding-right");
    const right = decl("right");
    for (const raw of rule.selectors) {
      const sel = norm(raw);
      if (!/:not\(\.app-shell\)/.test(sel)) continue;
      if (padR !== undefined && sel.endsWith("#root:has(.app-shell-frame)")) {
        if (/^0(px|rem)?$/.test(padR)) cancelled.add(sel.replace(/ #root:has\(\.app-shell-frame\)$/, ""));
      } else if (padR !== undefined && sel.endsWith(" #root") && padR.includes("--desktop-sidebar-w")) {
        padded.push(sel.replace(/ #root$/, ""));
      } else if (right !== undefined && sel.endsWith(" .app-shell-frame") && right.includes("--desktop-sidebar-w")) {
        frames.add(sel.replace(/ \.app-shell-frame$/, ""));
      }
    }
  });
  return { padded, cancelled, frames };
}

const unpaired = ({ padded, cancelled, frames }: Found) =>
  padded.filter((s) => !cancelled.has(s) || !frames.has(s));

describe("#root's right-rail inset is handed to an AppShell frame (Q179)", () => {
  it("catches the original, frame-less rule", () => {
    const original = `
      @media (min-width: 900px) {
        html.web-desktop.desktop-rail.side-panel-open:not(.app-shell) #root { padding-right: var(--desktop-sidebar-w); }
        html.web-desktop.app-shell.desktop-rail.side-panel-open .app-shell-frame { right: var(--desktop-sidebar-w); }
      }`;
    expect(unpaired(inventory(original))).toEqual(["html.web-desktop.desktop-rail.side-panel-open:not(.app-shell)"]);
  });

  it("every #root right inset in src/index.css is paired", () => {
    const found = inventory(readFileSync("src/index.css", "utf8"));
    expect(found.padded.length).toBeGreaterThan(0);
    expect(unpaired(found)).toEqual([]);
  });
});
