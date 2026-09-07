import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HeroSection from "@/components/landing/HeroSection";

/**
 * TWO TYPEFACES, NOT THREE — owner decision 2026-09-07.
 *
 * Bodoni Moda is for headings only; Montserrat is for everything else (body,
 * labels, counts, nav items, captions, placeholders, toasts, the auth "or").
 * EB Garamond is gone: the Google Fonts request, the Tailwind `serif` token,
 * the `.text-display-eyebrow` face, and the 359 `font-serif italic` call sites
 * were all folded into `font-sans` in one pass.
 *
 * Nothing in the type system can fail loudly on its own. A `font-serif` class
 * with no `serif` token compiles to NOTHING (Tailwind emits no rule for an
 * unknown family), so the element silently inherits whatever is above it, and
 * a stray `family=EB+Garamond` in index.html downloads ~60KB of font for zero
 * elements. This file is the only thing that notices either.
 *
 * The hero is LOCKED (CLAUDE.md): H1 in Bodoni Moda, subhead in Montserrat.
 * That is asserted from the rendered element's own style, not from a class
 * name, because a class name can be present and compile to nothing (see the
 * gloss rule in CLAUDE.md for the same trap).
 */

const ROOT = resolve(__dirname, "..", "..");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(tsx?|css|html)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
};

describe("two-font type system", () => {
  const files = walk(join(ROOT, "src")).concat(join(ROOT, "index.html"), join(ROOT, "tailwind.config.ts"));

  it("no file in src/, index.html or the Tailwind config selects EB Garamond", () => {
    const offenders = files
      .filter((f) => !f.endsWith("twoFontTypeSystem.test.tsx"))
      .flatMap((f) => {
        const lines = readFileSync(f, "utf8").split("\n");
        return lines
          .map((line, i) => ({ line, i }))
          // Prose that records the retirement is fine; anything that would
          // still LOAD or SELECT the face is not.
          .filter(({ line }) => /EB\+Garamond|["']EB Garamond["']|font-family:\s*["']?EB Garamond/.test(line))
          .map(({ i }) => `${f.replace(ROOT + "/", "")}:${i + 1}`);
      });
    expect(offenders, `EB Garamond is still selected at:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no call site uses the retired `font-serif` token", () => {
    const offenders = files
      .filter((f) => !f.endsWith("twoFontTypeSystem.test.tsx"))
      .flatMap((f) => {
        const lines = readFileSync(f, "utf8").split("\n");
        return lines
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => /(^|[^\w-])!?font-serif(?![\w-])/.test(line))
          .map(({ i }) => `${f.replace(ROOT + "/", "")}:${i + 1}`);
      });
    expect(offenders, `font-serif has no token and compiles to nothing at:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the Tailwind fontFamily has exactly sans, display and script", () => {
    const src = readFileSync(join(ROOT, "tailwind.config.ts"), "utf8");
    const block = src.slice(src.indexOf("fontFamily: {"), src.indexOf("},", src.indexOf("fontFamily: {")));
    expect(block).toMatch(/sans:\s*\["Montserrat"/);
    expect(block).toMatch(/display:\s*\["\\"Bodoni Moda\\""/);
    expect(block).not.toMatch(/serif:/);
  });

  it("the hero H1 is Bodoni Moda and the subhead is Montserrat (LOCKED)", () => {
    render(
      <MemoryRouter>
        <HeroSection />
      </MemoryRouter>,
    );
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Louisiana’s Local Job Partner.");
    // jsdom has no stylesheet, so the class list is the contract here: the
    // `font-display` token is the only route to Bodoni Moda in the app.
    expect(h1.className.split(/\s+/)).toContain("font-display");
    const subhead = screen.getByText("Hire a Helpr or find local work. For everyday jobs, big and small.");
    expect(subhead.style.fontFamily).toMatch(/^Montserrat/);
    expect(subhead.className.split(/\s+/)).not.toContain("font-display");
  });
});
