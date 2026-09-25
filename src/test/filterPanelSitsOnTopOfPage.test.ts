/*
 * Owner, 2026-09-25 (iPhone, Home → Refine Your Search): "This should be like
 * on top of the stuff behind it it looks like it's blends all together."
 *
 * The phone/native filter band is a sheet over the feed: a surface token that
 * is NOT the page canvas in either theme, the floating-surface elevation, and
 * rounded bottom corners. No blur or scrim (owner, 2026-08-31).
 *
 * Both panels anchored to the header (Filters and Notifications) use these
 * surfaces, on phone (the band) and on the desktop website (the dropdown).
 * Owner, 2026-09-25: "Filters and notification should have a background so
 * they don't blend in with the info behind it".
 *
 * @mutate src/components/ui/anchoredPanel.tsx | background: "hsl(var(--popover))",\n  borderBottom | background: "hsl(var(--background))",\n  borderBottom
 * @mutate src/components/ui/anchoredPanel.tsx | boxShadow: "var(--elev-sheet), 0 24px 48px -16px hsl(160 10% 12% / 0.35)", | boxShadow: "none",
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const panel = readFileSync(resolve(ROOT, "src/components/ui/anchoredPanel.tsx"), "utf8");
const css = readFileSync(resolve(ROOT, "src/index.css"), "utf8");

/** The object literal behind `screenPanelSurfaceStyle`. */
const surface = (() => {
  const start = panel.indexOf("const screenPanelSurfaceStyle = {");
  return start === -1 ? "" : panel.slice(start, panel.indexOf("} as React.CSSProperties;", start));
})();

/** Every value a custom property is given across the stylesheet (light + dark blocks). */
function values(name: string): string[] {
  return [...css.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, "g"))].map((m) => m[1].replace(/\/\*.*$/, "").trim());
}

/** The object literal behind `desktopPanelSurfaceStyle`. */
const desktopSurface = (() => {
  const start = panel.indexOf("const desktopPanelSurfaceStyle = {");
  return start === -1 ? "" : panel.slice(start, panel.indexOf("} as React.CSSProperties;", start));
})();

describe("the Filters / Notifications panels sit on top of the page", () => {
  it("the desktop dropdown is painted in the same card tone, not the page canvas", () => {
    expect(desktopSurface.length, "desktopPanelSurfaceStyle not found").toBeGreaterThan(40);
    expect(desktopSurface).toMatch(/background:\s*"hsl\(var\(--popover\)\)"/);
  });

  it("both panels are built on these surfaces", () => {
    for (const f of ["src/components/dashboard/FilterSheet.tsx", "src/components/NotificationPanel.tsx"]) {
      expect(readFileSync(resolve(ROOT, f), "utf8"), `${f} no longer uses screenPanelContentProps`).toMatch(/screenPanelContentProps\(band\)/);
    }
  });

  it("the surface literal is found", () => {
    expect(surface.length, "screenPanelSurfaceStyle not found — this guard has rotted").toBeGreaterThan(40);
  });

  it("is painted in a surface token that differs from the page canvas in every theme", () => {
    const m = /background:\s*"hsl\(var\(--([a-z-]+)\)\)"/.exec(surface);
    expect(m, "the band's background is not a single hsl(var(--token))").not.toBeNull();
    const token = m![1];
    expect(token, "the band is painted in the page canvas colour, so it blends into the page").not.toBe("background");
    const bg = values("background");
    const own = values(token);
    expect(bg.length, "no --background values found").toBeGreaterThan(1);
    expect(own.length, `no --${token} values found`).toBe(bg.length);
    own.forEach((v, i) => expect(v, `--${token} equals --background in theme block ${i + 1}`).not.toBe(bg[i]));
  });

  it("carries the floating-surface elevation and a rounded bottom edge, with no blur", () => {
    expect(surface).toMatch(/boxShadow:\s*"var\(--elev-sheet\)/);
    expect(surface).toMatch(/borderBottomLeftRadius:/);
    expect(surface).toMatch(/borderBottomRightRadius:/);
    expect(surface).not.toMatch(/backdropFilter|blur\(/);
  });
});
