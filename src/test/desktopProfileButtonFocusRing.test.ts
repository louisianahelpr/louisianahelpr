/**
 * Q2254 (code-review@d280ca302#8): the desktop top bar's profile photo was a raw <button> forced to 44x44 by the
 * wrapper's [&_button]:h-11 w-11 around a 36x36 avatar, with no keyboard focus ring of its own. 58009824ba made it the
 * shared compact icon Button (variant ghost, size iconCompact). This pins what the item asked for:
 *   - the hit box is the app's 44px floor and the 36px photo sits centred in the 40px padding box (iconCompact:
 *     h-11 w-11 + a 2px transparent border, inline-flex centred), never stretched or pinned to a corner;
 *   - a keyboard focus ring shows (the Button base: focus-visible ring-2 in --ring, offset 2), and nothing on the
 *     button or its wrapper takes it away.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { buttonVariants } from "@/components/ui/button";

// @mutate src/components/ui/button.tsx | focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none | focus-visible:outline-none disabled:pointer-events-none
// @mutate src/components/DesktopTopNav.tsx |             data-testid="desktop-top-profile"\n |             data-testid="desktop-top-profile"\n            className="focus-visible:ring-0"\n
// @mutate src/components/DesktopTopNav.tsx | name={profile?.full_name} pixelSize={72} alt="" className="w-9 h-9" /> | name={profile?.full_name} pixelSize={72} alt="" className="w-11 h-11 absolute top-0 left-0" />
// @mutate src/components/DesktopTopNav.tsx | -mr-1 [&_button]:h-11 [&_button]:w-11"> | -mr-1 [&_button]:h-11 [&_button]:w-11 [&_button]:focus-visible:ring-0">

const FILE = resolve(__dirname, "../components/DesktopTopNav.tsx");
const SRC = readFileSync(FILE, "utf8");

type Attrs = Map<string, string>;
/** The <Button> carrying data-testid="desktop-top-profile", its attributes, and the className of the photo inside it. */
function profileButton(): { attrs: Attrs; avatarClass: string | null; wrapperClass: string | null } | null {
  const sf = ts.createSourceFile(FILE, SRC, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const read = (open: ts.JsxOpeningLikeElement): Attrs => {
    const m: Attrs = new Map();
    for (const p of open.attributes.properties) {
      if (!ts.isJsxAttribute(p)) continue;
      const v = p.initializer;
      m.set(p.name.getText(sf), !v ? "true" : ts.isStringLiteral(v) ? v.text : v.getText(sf));
    }
    return m;
  };
  let found: { attrs: Attrs; avatarClass: string | null; wrapperClass: string | null } | null = null;
  const visit = (n: ts.Node, wrapper: string | null) => {
    if (ts.isJsxElement(n)) {
      const attrs = read(n.openingElement);
      if (n.openingElement.tagName.getText(sf) === "Button" && attrs.get("data-testid") === "desktop-top-profile") {
        let avatarClass: string | null = null;
        const inner = (c: ts.Node) => {
          if (ts.isJsxSelfClosingElement(c) && c.tagName.getText(sf) === "UserAvatar") avatarClass = read(c).get("className") ?? null;
          ts.forEachChild(c, inner);
        };
        n.children.forEach(inner);
        found = { attrs, avatarClass, wrapperClass: wrapper };
        return;
      }
      const cls = n.openingElement.tagName.getText(sf) === "div" ? attrs.get("className") ?? wrapper : wrapper;
      n.children.forEach((c) => visit(c, cls ?? null));
      return;
    }
    ts.forEachChild(n, (c) => visit(c, wrapper));
  };
  visit(sf, null);
  return found;
}

describe("Q2254: the desktop top bar's profile photo has a centred 44px hit box and a keyboard focus ring", () => {
  const b = profileButton();

  it("finds the profile button and its photo (a parser that finds none must not pass)", () => {
    expect(b).not.toBeNull();
    expect(b!.attrs.get("aria-label")).toBe('{avatarButtonLabel("Profile", profile?.full_name)}'); // WCAG 2.5.3: the initials are in the name (Q1816)
    expect(b!.avatarClass).not.toBeNull();
  });

  it("is the shared compact icon Button, with no className of its own to override the ring or the box", () => {
    expect(b!.attrs.get("variant")).toBe("ghost");
    expect(b!.attrs.get("size")).toBe("iconCompact");
    expect(b!.attrs.has("className")).toBe(false);
  });

  it("the classes it renders: 44px box, 40px padding box, content centred, a visible focus ring", () => {
    const cls = buttonVariants({ variant: "ghost", size: "iconCompact" }).split(/\s+/);
    for (const c of ["h-11", "w-11", "border-2", "border-transparent", "bg-clip-padding", "inline-flex", "items-center", "justify-center",
      "focus-visible:ring-2", "focus-visible:ring-ring", "focus-visible:ring-offset-2"]) {
      expect(cls, c).toContain(c);
    }
    expect(cls.some((c) => /^focus-visible:ring-0$|^focus:ring-0$|^focus-visible:ring-transparent$/.test(c))).toBe(false);
  });

  it("the photo is 36px (w-9 h-9), inside the 40px padding box, laid out by the flex centring (not positioned)", () => {
    const a = (b!.avatarClass ?? "").split(/\s+/);
    expect(a).toContain("w-9");
    expect(a).toContain("h-9");
    expect(a.some((c) => /^(absolute|fixed|inset-|top-|left-|w-1[0-9]|h-1[0-9]|w-full|h-full)/.test(c))).toBe(false);
  });

  it("the wrapper only sizes its buttons (44px) and never removes their focus ring", () => {
    const w = b!.wrapperClass ?? "";
    expect(w).toContain("[&_button]:h-11");
    expect(w).toContain("[&_button]:w-11");
    expect(w).not.toMatch(/ring-0|outline-none|focus/);
  });
});
