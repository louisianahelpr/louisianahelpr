/**
 * Every branded email carries the sender's postal address (owner's UI audit 11-09, F167, HIGH). No marketing email
 * (drips, re-engagement, come-back, marketing blast, sign-up lead reminder) had one: CAN-SPAM requires a valid
 * physical postal address in every commercial email (15 U.S.C. 7704(a)(5)(A)(iii); FTC CAN-SPAM compliance guide).
 * The owner's address is "Louisiana Helpr · 314 Lynn Street, Delcambre, LA 70528" (via the lead, 11-09).
 *
 * The class, read from the source (comments blanked):
 *   1. the one constant (_shared/resend.ts POSTAL_ADDRESS_LITERAL) holds that address;
 *   2. BOTH shared footers (MarketingFooter, TransactionalFooter) render POSTAL_ADDRESS;
 *   3. every <BaseLayout> in every template passes a footer that is one of those two, so no template, today's or a new
 *      one, can ship without the line; every commercial template (it takes an unsubscribeUrl) uses MarketingFooter.
 * The rendered proof (Deno, the real react-email render of all 8 marketing emails) is in the commit message.
 *
 */
// @mutate supabase/functions/_shared/resend.ts | export const POSTAL_ADDRESS = POSTAL_ADDRESS_LITERAL.trim(); | export const POSTAL_ADDRESS = (Deno.env.get("HELPR_POSTAL_ADDRESS") ?? POSTAL_ADDRESS_LITERAL).trim();
// @mutate supabase/functions/_shared/resend.ts | const POSTAL_ADDRESS_LITERAL = "Louisiana Helpr · 314 Lynn Street, Delcambre, LA 70528"; | const POSTAL_ADDRESS_LITERAL = "";
// @mutate supabase/functions/_shared/email-templates/components.tsx | the commercial ones (lead 11-09, F167). */}\n    {POSTAL_ADDRESS ? ( | the commercial ones (lead 11-09, F167). */}\n    {false ? (
// @mutate supabase/functions/_shared/email-templates/drip.tsx |     footer={<MarketingFooter unsubscribeUrl={unsubscribeUrl} />}\n  >\n    <Heading className="e-h1" style={{ ...h1, fontSize: '22px' }}>\n      Welcome to | footer={<p>Unsubscribe: {unsubscribeUrl}</p>}\n  >\n    <Heading className="e-h1" style={{ ...h1, fontSize: '22px' }}>\n      Welcome to
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const TEMPLATES = join(ROOT, "supabase/functions/_shared/email-templates");
const read = (p: string) => blankComments(readFileSync(p, "utf8"));
const ADDRESS = "Louisiana Helpr · 314 Lynn Street, Delcambre, LA 70528";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "node_modules" ? [] : walk(join(dir, e.name))) : [join(dir, e.name)],
  );
}

/** The text of the JSX element starting at `start` (`<Tag`), up to its matching `/>` or `</Tag>`, balancing braces. */
function propsOf(src: string, start: number): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unterminated element");
}

describe("every branded email carries the postal address (F167, CAN-SPAM)", () => {
  it("the one constant holds the owner's address", () => {
    expect(read(join(ROOT, "supabase/functions/_shared/resend.ts"))).toContain(`const POSTAL_ADDRESS_LITERAL = "${ADDRESS}";`);
  });

  // Lead 11-09: a HELPR_POSTAL_ADDRESS secret is set on prod with a hidden value that matches none of the owner's
  // spellings, and it used to take precedence over the literal. The literal is the only source: no email code reads it.
  it("no edge function code reads HELPR_POSTAL_ADDRESS; POSTAL_ADDRESS is the literal alone", () => {
    const files = walk(join(ROOT, "supabase/functions")).filter((f) => /\.(ts|tsx|mts|js)$/.test(f));
    expect(files.length).toBeGreaterThan(300);
    expect(files.filter((f) => /HELPR_POSTAL_ADDRESS/.test(read(f))).map((f) => f.slice(ROOT.length + 1))).toEqual([]);
    expect(read(join(ROOT, "supabase/functions/_shared/resend.ts"))).toMatch(/export const POSTAL_ADDRESS = POSTAL_ADDRESS_LITERAL\.trim\(\);/);
  });

  it("both shared footers render it", () => {
    const src = read(join(TEMPLATES, "components.tsx"));
    for (const name of ["MarketingFooter", "TransactionalFooter"]) {
      const at = src.indexOf(`export const ${name} = `);
      expect(at, name).toBeGreaterThan(-1);
      const next = src.indexOf("export ", at + 10);
      const body = src.slice(at, next === -1 ? undefined : next);
      expect(body, `${name} no longer renders POSTAL_ADDRESS`).toMatch(/\{POSTAL_ADDRESS \? \(\s*<>\s*<br \/>\s*\{POSTAL_ADDRESS\}/);
    }
  });

  it("every template's BaseLayout passes one of the two footers; every commercial one the marketing footer", () => {
    const files = readdirSync(TEMPLATES).filter((f) => f.endsWith(".tsx") && f !== "components.tsx");
    let layouts = 0;
    let commercial = 0;
    const bad: string[] = [];
    for (const f of files) {
      const src = read(join(TEMPLATES, f));
      for (let at = src.indexOf("<BaseLayout"); at !== -1; at = src.indexOf("<BaseLayout", at + 1)) {
        layouts++;
        // The footer prop, or a footer placed as the layout's last child (signup.tsx, confirmReminder.tsx...).
        const props = propsOf(src, at);
        const close = props.endsWith("/>") ? at + props.length : src.indexOf("</BaseLayout>", at);
        expect(close, `${f}: unclosed BaseLayout`).toBeGreaterThan(at);
        const footer = src.slice(at, close);
        const usesMarketing = /<MarketingFooter\b/.test(footer);
        if (!usesMarketing && !/<TransactionalFooter\b/.test(footer)) bad.push(`${f}: a BaseLayout without a shared footer`);
        // A template that takes an unsubscribe link is commercial mail: it must use the marketing footer.
        const line = src.slice(0, at).split("\n").length;
        const fnStart = src.lastIndexOf("export const ", at);
        if (/unsubscribeUrl/.test(src.slice(fnStart, at))) {
          commercial++;
          if (!usesMarketing) bad.push(`${f}:${line}: commercial (unsubscribeUrl) without MarketingFooter`);
        }
      }
    }
    expect(bad).toEqual([]);
    // Floors: 23 BaseLayouts and 7 commercial ones (drip x5, come-back, marketing blast) on 2026-11-09.
    expect(layouts).toBeGreaterThan(20);
    expect(commercial).toBeGreaterThan(5);
  });
});
