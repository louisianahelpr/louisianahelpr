/**
 * Design audit round 2 (11-17, ~/.lh-shots/design-audit-r2/FINDINGS.md): guards for the fixes on
 * design/audit-r2-fixes-1118.
 *
 * #1 (High): Post a job step 5 read "Helprs see the area now. undefined" on the live English bundle. enPostJob.ts
 * built postJob.whereH with a template literal around an imported constant, and in the production chunk order the
 * constant was not yet set when the dictionary object was built. Dictionaries are now plain string literals: no
 * dictionary imports anything but the registry, and no value is a template with ${...} interpolation. Every value
 * in both languages is also checked for the word "undefined" / "null" / "NaN".
 *
 * @mutate src/lib/i18n/enPostJob.ts | "postJob.whereH": "Helprs see the area now. Your street address goes only to the Helpr you offer the job to.", | "postJob.whereH": `Helprs see the area now. ${undefined}`,
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

const I18N = "src/lib/i18n";
const dictionaryFiles = readdirSync(I18N)
  .filter((n) => /^(en|es)[A-Z]\w*\.ts$/.test(n) && n !== "enRegistry.ts")
  .map((n) => join(I18N, n));

describe("design audit r2 #1: no English or Spanish string renders 'undefined'", () => {
  it("every dictionary value is a real string with no undefined/null/NaN in it", () => {
    const all = [...Object.entries(en), ...Object.entries(es)];
    expect(all.length).toBeGreaterThan(2000);
    const bad = all.filter(([, v]) => typeof v !== "string" || /\b(undefined|null|NaN)\b/.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("dictionaries are plain literals: no imports but the registry, no ${...} template interpolation", () => {
    expect(dictionaryFiles.length).toBeGreaterThan(50);
    const bad: string[] = [];
    for (const f of dictionaryFiles) {
      const src = blankComments(readFileSync(f, "utf8"));
      // a type-only import is erased at build time, so it cannot leave a value unset
      const imports = [...src.matchAll(/^import(?!\s+type\b)[^;]*from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
      if (imports.some((m) => m !== "./enRegistry")) bad.push(`${f}: imports ${imports.join(", ")}`);
      if (/`[^`]*\$\{[^}]*\}[^`]*`/.test(src)) bad.push(`${f}: template interpolation`);
    }
    expect(bad).toEqual([]);
  });
});

/**
 * #2 (High): the price on Post a job step 4 drew a 15px number inside a pill: the hero CurrencyInput used the shared
 * field surface (glass-field, rounded-2xl border, text-ds-15), and tailwind-merge does not treat text-ds-40 as a
 * font size, so ds-15 won. The hero field is now bare: no surface, one font size, the text colour.
 * @mutate src/components/ui/currency-input.tsx |             look="bare"\n | \n
 */
describe("design audit r2 #2: the price field is a big bare number, not a pill", () => {
  it("the hero input carries no field surface and only the top text size", async () => {
    const { render } = await import("@testing-library/react");
    const { createElement } = await import("react");
    const { CurrencyInput } = await import("@/components/ui/currency-input");
    const { container } = render(createElement(CurrencyInput, { hero: true, value: 60, onChange: () => {}, "aria-label": "Job budget in dollars" }));
    const input = container.querySelector("input")!;
    expect(input).not.toBeNull();
    const cls = input.className.split(/\s+/);
    expect(cls).not.toContain("glass-field");
    expect(cls).not.toContain("text-ds-15");
    expect(cls).toContain("text-ds-40");
    expect(input.getAttribute("style") ?? "").not.toMatch(/burnt-sienna/);
  });
});

/**
 * #31 (High): the You page was English in Spanish ("View my public profile", "Your activity", "Money", "Settings",
 * "Talk to a real person", "Log out", "Delete account"). The rows, captions, card and activity tiles now draw t().
 * @mutate src/components/profile/profileLanding/YouMenu.tsx | title={t(ROW_KEY[row.key])}>{t(ROW_KEY[row.key])}</span> | title={row.label}>{row.label}</span>
 * @mutate src/components/profile/profileLanding/YouCard.tsx |           {t("yp.you.publicProfile")}\n |           View my public profile\n
 */
describe("design audit r2 #31: the You page follows the member's language", () => {
  it("Spanish: the menu rows, captions and the card's link are Spanish", async () => {
    const { render, cleanup } = await import("@testing-library/react");
    const { createElement } = await import("react");
    const { MemoryRouter } = await import("react-router-dom");
    const { setLang, ensureLangLoaded, __resetLangForTests } = await import("@/lib/i18n/language");
    const { YouMenuList, youStaticCaptions } = await import("@/components/profile/profileLanding/YouMenu");
    const { YouCard } = await import("@/components/profile/profileLanding/YouCard");
    const { profilePageTitle } = await import("@/components/profile/profileLanding/profilePageTitle");
    try {
      expect(profilePageTitle()).toBe("You");
      setLang("es");
      await ensureLangLoaded();
      expect(profilePageTitle()).toBe("Perfil");
      const menu = render(createElement(YouMenuList, { captions: youStaticCaptions(), showAdmin: true }));
      const text = menu.container.textContent ?? "";
      for (const es of ["Dinero", "Notificaciones", "Ajustes", "Hable con una persona", "Avisos y correo", "Ayuda"]) expect(text).toContain(es);
      for (const en of ["Money", "Notifications", "Settings", "Talk to a real person", "Alerts and email"]) expect(text).not.toContain(en);
      cleanup();
      const card = render(createElement(MemoryRouter, null, createElement(YouCard, { profile: null, userId: "u1", displayName: "", avgRating: null, reviewCount: 0 })));
      expect(card.container.textContent).toContain("Ver mi perfil público");
      expect(card.container.textContent).not.toContain("View my public profile");
    } finally {
      cleanup();
      __resetLangForTests();
    }
  });
});

/**
 * #32 (High): Post a job steps 3-6 were English in Spanish except the questions. The field labels, tiers, photo-proof
 * toggle, When chips, review rows, "You pay", "Continue to payment" and the app bar now draw t(). Every key added has
 * real Spanish (not the English copied).
 * @mutate src/components/postjob/LogisticsSection.tsx | onClick={chooseWeek}>{tr("postJob.f.anyWeek")}</ChoicePill> | onClick={chooseWeek}>Any time this week</ChoicePill>
 * @mutate src/pages/post-job/CheckoutStepView.tsx | question={tr("postJob.f.lookGood")} | question="Look good?"
 */
describe("design audit r2 #32: Post a job steps 3-6 follow the member's language", () => {
  const FORBIDDEN: Record<string, string[]> = {
    "src/components/postjob/detailsSection/TitleField.tsx": [">Job title <"],
    "src/components/postjob/detailsSection/DescriptionField.tsx": [">Description <"],
    "src/components/postjob/detailsSection/CredentialTierSelector.tsx": [">Who can apply?<", "Require credentials for licensed trade work."],
    "src/components/postjob/detailsSection/PhotoProofToggle.tsx": ["Require before &amp; after photos", "\"Your Helpr has to upload"],
    "src/components/postjob/LogisticsSection.tsx": [">Job type<", ">A set time<", ">Any time this week<", "Need it today\n", "More dates\n", "Start time\n", "\"Date needed\""],
    "src/components/postjob/CheckoutGlanceCard.tsx": ["Your post at a glance\n", ">Job<", ">Category<", ">Details<", "/>Location", "/>When"],
    "src/components/postjob/CheckoutPlainYouPay.tsx": [">You pay<"],
    "src/components/postjob/CheckoutStep.tsx": [": \"Continue to payment\""],
    "src/pages/post-job/CheckoutStepView.tsx": ["question=\"Look good?\""],
    "src/pages/post-job/PostJob.tsx": ["title: \"Post a job\""],
  };
  it("no hard-coded English is left in those screens", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const [f, words] of Object.entries(FORBIDDEN)) {
      const src = blankComments(readFileSync(f, "utf8"));
      for (const w of words) { checked++; if (src.includes(w)) bad.push(`${f}: ${JSON.stringify(w)}`); }
    }
    expect(checked).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it("every step 3-6 key has Spanish of its own", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("postJob.f."));
    expect(keys.length).toBeGreaterThan(30);
    const same = keys.filter((k) => es[k as keyof typeof es] === en[k as keyof typeof en]);
    expect(same).toEqual([]);
  });
});
