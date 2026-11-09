/**
 * The emails wear the brand (owner's UI audit 11-09, F158): every branded email was off brand. The page was the cool
 * grey #F0F2F4, body text the blue-grey #55656D, the card border #CBCFD8, headings #23231A in a bold sans; no Bodoni
 * Moda anywhere, and Montserrat named but never loaded.
 *
 * Read from the one token file (supabase/functions/_shared/email-templates/styles.ts) and the one <Head>
 * (components.tsx EmailHead), comments blanked: the brand hexes, the heading stack with its Georgia fallback, and the
 * webfont link. No template may bring the old cool hexes back.
 *
 * @mutate supabase/functions/_shared/email-templates/styles.ts |   parchment: '#F7F5F1', |   parchment: '#F0F2F4',
 * @mutate supabase/functions/_shared/email-templates/styles.ts |   bodyOlive: '#615E56', |   bodyOlive: '#55656D',
 * @mutate supabase/functions/_shared/email-templates/styles.ts |   hairline: '#E6E2DA', |   hairline: '#CBCFD8',
 * @mutate supabase/functions/_shared/email-templates/styles.ts | export const h1 = {\n  fontFamily: headingFontStack, | export const h1 = {
 * @mutate supabase/functions/_shared/email-templates/components.tsx |     <style dangerouslySetInnerHTML={{ __html: EMAIL_CSS }} /> |     <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat" />\n    <style dangerouslySetInnerHTML={{ __html: EMAIL_CSS }} />
 *
 * F155: in dark-mode clients the dark iron H all but disappeared on the dark card. The mark sits on its own light
 * rounded tile in every email (one HMark, inside BaseLayout), kept light by the dark CSS block.
 * @mutate supabase/functions/_shared/email-templates/styles.ts |     .e-logo { background-color:#F7F5F1 !important; }\n |
 * @mutate supabase/functions/_shared/email-templates/styles.ts |   backgroundColor: '#FFFFFF',\n  padding: '6px', |   padding: '6px',
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// The repo's readdirSync (lists src/ from git; anything else, here supabase/, straight from disk).
import { readdirSync } from "./helpers/trackedFiles";

const DIR = resolve(__dirname, "..", "..", "supabase/functions/_shared/email-templates");
const read = (f: string) => blankComments(readFileSync(join(DIR, f), "utf8"));

describe("the emails wear the brand (F158)", () => {
  const styles = read("styles.ts");

  it("the tokens are the brand's: warm ground, white card, warm border, brand text, rust links, olive CTA", () => {
    const want: Record<string, string> = {
      parchment: "#F7F5F1",
      surface: "#ffffff",
      hairline: "#E6E2DA",
      olivewood: "#2E2F22",
      inkDeep: "#2E2F22",
      bodyOlive: "#615E56",
      footerOlive: "#615E56",
      burntSienna: "#984216",
      bark: "#5E6544",
    };
    for (const [k, v] of Object.entries(want)) expect(styles, k).toContain(`${k}: '${v}',`);
    expect(styles).toMatch(/main = \{\s*backgroundColor: brand\.parchment,/);
    expect(styles).toMatch(/border: `1px solid \$\{brand\.hairline\}`/);
    expect(styles).toMatch(/backgroundColor: brand\.bark,/);
  });

  it("headings are Bodoni Moda with a Georgia fallback; no email asks a font host for anything (privacy)", () => {
    expect(styles).toContain(`const headingFontStack = "'Bodoni Moda', Georgia, 'Times New Roman', serif"`);
    expect(styles).toMatch(/export const h1 = \{\s*fontFamily: headingFontStack,/);
    expect(styles).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(styles).toContain(`"'Montserrat', 'Helvetica Neue', Helvetica, Arial, sans-serif"`);
    const comp = read("components.tsx");
    const head = comp.slice(comp.indexOf("const EmailHead"), comp.indexOf("</Head>", comp.indexOf("const EmailHead")));
    expect(head).toContain("<Head>");
    expect(head).not.toMatch(/<link[^>]*stylesheet|fonts\.(googleapis|gstatic)\.com/);
  });

  it("F155: the H mark sits on a light rounded tile, kept light in dark mode, in every email", () => {
    const logo = styles.slice(styles.indexOf("export const logo = {"), styles.indexOf("}", styles.indexOf("export const logo = {")));
    expect(logo).toContain("backgroundColor: '#FFFFFF',");
    expect(logo).toMatch(/borderRadius: '\d+px',/);
    const dark = styles.slice(styles.indexOf("@media (prefers-color-scheme: dark)"));
    expect(dark).toMatch(/\.e-logo \{ background-color:#F7F5F1 !important; \}/);
    const comp = read("components.tsx");
    expect(comp).toMatch(/const HMark = \(\) => \(\s*<img src=\{LOGO_URL\}[^>]*className="e-logo" style=\{logo\} \/>/);
    // The one mark: BaseLayout draws it, so every template that uses BaseLayout has it.
    expect(comp).toMatch(/<Container className="e-card" style=\{container\}>\s*<HMark \/>/);
  });

  it("no template carries the old cool hexes", () => {
    const files = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(15);
    const old = /#F0F2F4|#55656D|#CBCFD8|#6E7C83|#23231A/i;
    expect(files.filter((f) => old.test(read(f)))).toEqual([]);
  });
});
