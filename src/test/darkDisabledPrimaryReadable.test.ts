/**
 * F277a (audit 11-10): in dark mode a disabled primary ("Tip" before an amount, "Send new time") was dark words on a
 * mid-olive (the light olive at 50%), hard to read and not plainly off. Dark mode's disabled primary is now the quiet
 * dark-grey surface (--sand) at full opacity with light words (--olivewood, the dark theme's ink) at 60%, for
 * `:disabled` and `aria-disabled="true"` alike, and its children follow the words' colour (<Button> pins a
 * parchment colour on every child with !important). Light mode keeps the 50% dim (disabledPrimaryLooksDisabled).
 *
 * @mutate src/index.css |   background-color: hsl(var(--sand)) !important;\n  background-image: none !important;\n  color: hsl(var(--olivewood) / 0.6) !important; |   background-image: none !important;
 * @mutate src/index.css | [data-theme="dark"] .btn-grad-primary:disabled *, | [data-theme="dark"] .btn-grad-primary:disabled > .never,
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankCssComments } from "./helpers/blankNonCode";

const css = blankCssComments(readFileSync(join(process.cwd(), "src/index.css"), "utf8"));

describe("dark mode: a disabled primary is plainly off and readable (F277a)", () => {
  it("dark-grey surface, full opacity, light words at 60%, for both disabled forms", () => {
    const rule = css.match(/\[data-theme="dark"\] \.btn-grad-primary:disabled,\s*\[data-theme="dark"\] \.btn-grad-primary\[aria-disabled="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/opacity: 1;/);
    expect(rule).toMatch(/background-color: hsl\(var\(--sand\)\) !important;/);
    expect(rule).toMatch(/background-image: none !important;/);
    expect(rule).toMatch(/color: hsl\(var\(--olivewood\) \/ 0\.6\) !important;/);
  });

  it("the words inside follow (the shared Button pins a colour on every child)", () => {
    expect(css).toMatch(/\[data-theme="dark"\] \.btn-grad-primary:disabled \*,\s*\[data-theme="dark"\] \.btn-grad-primary\[aria-disabled="true"\] \*\s*\{\s*color: inherit !important;/);
    expect(readFileSync(join(process.cwd(), "src/components/ui/button.tsx"), "utf8")).toContain("[&_*]:!text-[hsl(var(--parchment))]");
  });

  it("dark mode is the data-theme on <html>, and dark --sand is a dark surface", () => {
    const dark = css.slice(css.indexOf('[data-theme="dark"] {'));
    expect(dark.match(/--sand:\s+40 8% 21%;/)).not.toBeNull();
  });
});
