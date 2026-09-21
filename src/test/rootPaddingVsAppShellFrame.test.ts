/**
 * CLASS CHECK: every rule that pads #root DOWN on a document-scroll route
 * (`:not(.app-shell) #root { padding-top }`) must be cancelled for a page that
 * mounts an AppShell frame (`#root:has(.app-shell-frame) { padding-top: 0 }`).
 *
 * VN-24 (owner, 2026-09-14): signed in, /support and /help showed "a large
 * empty band above the title". PublicLayout renders AppShell for a signed-in
 * viewer on those document-scroll routes; the route's <PageTransition>
 * (`will-change: transform`) is the containing block for the shell's
 * `position: fixed` frame, so #root's top padding moved the frame down AND the
 * frame added its own top offset for the same bar — 56px counted twice.
 *
 * Inventory comes from src/index.css itself (postcss), so a new #root
 * padding-top rule scoped to `:not(.app-shell)` fails here until it is paired.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import postcss from "postcss";

// PROVEN ABLE TO FAIL 2026-09-20. Narrowing the cancelling selector so it no
// longer matches the padding rule it pairs with re-creates VN-24's 56px
// double-count, and the inventory reports the unpaired selector by name.
// @mutate src/index.css | html.web-desktop.desktop-rail:not(.app-shell) #root:has(.app-shell-frame) { | html.web-desktop.desktop-rail.x:not(.app-shell) #root:has(.app-shell-frame) {

type Found = { padded: string[]; cancelled: Set<string> };

function inventory(css: string): Found {
  const padded: string[] = [];
  const cancelled = new Set<string>();
  postcss.parse(css).walkRules((rule) => {
    const topPad = rule.nodes.find(
      (n) => n.type === "decl" && (n as postcss.Declaration).prop === "padding-top",
    ) as postcss.Declaration | undefined;
    if (!topPad) return;
    for (const raw of rule.selectors) {
      const sel = raw.trim().replace(/\s+/g, " ");
      if (!/:not\(\.app-shell\) #root/.test(sel)) continue;
      if (sel.endsWith("#root:has(.app-shell-frame)")) {
        if (/^0(px|rem)?$/.test(topPad.value.trim())) {
          cancelled.add(sel.replace(/:has\(\.app-shell-frame\)$/, ""));
        }
        continue;
      }
      if (sel.endsWith("#root")) padded.push(sel);
    }
  });
  return { padded, cancelled };
}

const unpaired = ({ padded, cancelled }: Found) => padded.filter((s) => !cancelled.has(s));

describe("#root top padding never double-counts an AppShell frame (VN-24)", () => {
  it("catches the original unpaired rule", () => {
    const original = `
      @media (min-width: 900px) {
        html.web-desktop.desktop-rail:not(.app-shell) #root { padding-top: 3.5rem; }
      }`;
    expect(unpaired(inventory(original))).toEqual([
      "html.web-desktop.desktop-rail:not(.app-shell) #root",
    ]);
    const fixed = `${original}
      html.web-desktop.desktop-rail:not(.app-shell) #root:has(.app-shell-frame) { padding-top: 0; }`;
    expect(unpaired(inventory(fixed))).toEqual([]);
  });

  it("src/index.css pairs every document-scroll #root padding-top rule", () => {
    const found = inventory(readFileSync("src/index.css", "utf8"));
    expect(found.padded.length, "inventory found no #root padding rules — the parser is broken").toBeGreaterThan(0);
    expect(
      unpaired(found),
      "add `<selector>:has(.app-shell-frame) { padding-top: 0 }` for each (see the VN-24 note in index.css):\n  " +
        unpaired(found).join("\n  "),
    ).toEqual([]);
  });
});
