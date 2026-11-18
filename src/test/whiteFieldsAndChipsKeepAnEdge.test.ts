/**
 * Design audit r3 #1 (HIGH, 11-18): on the white page (owner 11-17) a field or chip painted `bg-card` (white) lost
 * its border to the cleaner-cards rule (T2 in src/index.css clears the border of every `:where(.bg-card)` with
 * !important), so the Edit listing / Sell title and description boxes, the Edit listing chips (ChoicePill) and the
 * Open a shop category chips were white on white: floating text (shots ~/.lh-shots/design-audit-r3/
 * helper2-manage-390-edit.png, helper-shops-mine-390.png). A field or chip keeps a real 1 px --border edge.
 *
 * @mutate src/index.css | input.bg-card,\ntextarea.bg-card, | .x-off-input,\n.x-off-textarea,
 * @mutate src/index.css | button[role="radio"].bg-card, | button[data-x-off].bg-card,
 * @mutate src/index.css | label[for].bg-card,
 | 
 * @mutate src/index.css | [data-field-edge].bg-card {\n  border-color: hsl(var(--border)) !important; | [data-field-edge].bg-card {\n  border-color: transparent !important;
 * @mutate src/components/declutter/DeclutterManageListing.tsx | <div className={field} data-field-edge="">\n          <span className="text-ds-15 font-semibold text-[hsl(var(--burnt-sienna))]" aria-hidden>$</span>\n          <input id="manage-price" | <div className={field}>\n          <span className="text-ds-15 font-semibold text-[hsl(var(--burnt-sienna))]" aria-hidden>$</span>\n          <input id="manage-price"
 * @mutate src/pages/profile/giftCards/OccasionChips.tsx | border: "1px solid hsl(var(--border))", | border: "1px solid hsl(var(--bark) / 0.18)",
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankCssComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");
const css = blankCssComments(read("src/index.css"));

/** Every rule (selector list + body) in the stylesheet, flat (nested @media bodies included). */
function rules(): { sel: string[]; body: string }[] {
  const out: { sel: string[]; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push({ sel: m[1].split(",").map((s) => s.trim()).filter(Boolean), body: m[2] });
  return out;
}

const EDGE = /border-color:\s*hsl\(var\(--border\)\)\s*!important/;
const edged = (selector: string) => rules().some((r) => r.sel.includes(selector) && EDGE.test(r.body));

describe("white fields and chips keep an edge on the white page (design audit r3 #1)", () => {
  it("the cleaner-cards rule still clears .bg-card borders (so the exception is needed)", () => {
    const t2 = rules().filter((r) => r.sel.includes(":where(.bg-card)") && /border-color:\s*transparent\s*!important/.test(r.body));
    expect(t2.length).toBeGreaterThan(0);
  });

  it.each([
    "input.bg-card",
    "textarea.bg-card",
    "select.bg-card",
    'button[role="radio"].bg-card',
    "button[aria-pressed].bg-card",
    "button[aria-expanded].bg-card",
    "label[for].bg-card",
    "[data-field-edge].bg-card",
  ])("%s wears the --border hairline", (selector) => {
    expect(edged(selector)).toBe(true);
  });

  it("the controls the audit named still match those selectors", () => {
    // Sell / Edit listing title + description: CARD_FIELD_CLS on an <input>/<textarea>.
    expect(read("src/components/ui/input.tsx")).toMatch(/CARD_FIELD_CLS =\s*"[^"]*\bbg-card\b/);
    // Edit listing chips: ChoicePill is a role="radio" button on bg-card when off.
    const pill = read("src/components/ui/ChoicePill.tsx");
    expect(pill).toMatch(/role="radio"/);
    expect(pill).toMatch(/: "[^"]*\bbg-card\b[^"]*"/);
    // Open a shop categories: role="radio" buttons on bg-card, and the More button (aria-expanded).
    const shop = read("src/components/shops/ShopCategoryQuickPick.tsx");
    expect(shop).toMatch(/role="radio"/);
    expect((shop.match(/border-border bg-card/g) ?? []).length).toBeGreaterThan(1);
    // AI describe's "Add a photo" pill (r3 #23) is a <label htmlFor> on bg-card.
    expect(read("src/components/ui/PhotoPickButton.tsx")).toMatch(/htmlFor=\{id\}[\s\S]{0,80}className="[^"]*border border-border bg-card/);
    // Manage listing price boxes are divs that hold the input.
    expect((read("src/components/declutter/DeclutterManageListing.tsx").match(/<div className=\{field\} data-field-edge="">/g) ?? []).length).toBeGreaterThan(1);
  });

  it("gift-card occasion chips use the --border hairline, not a 18% bark wash", () => {
    const chips = read("src/pages/profile/giftCards/OccasionChips.tsx");
    expect(chips).toMatch(/border: "1px solid hsl\(var\(--border\)\)"/);
    expect(chips).not.toMatch(/bark\) \/ 0\.18/);
  });
});
