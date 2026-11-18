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

/**
 * #6 (Medium): in dark mode the unselected Post a job chips had no border: `[data-theme="dark"] :where(.bg-card)`
 * dims every .bg-card border to the card's own tone. A choice button on bg-card keeps a light hairline in dark.
 * @mutate src/index.css | :root[data-theme="dark"] button.bg-card:is([role="radio"], [aria-pressed]) { | :root[data-theme="dark"] button.bg-card:is([data-never]) {
 */
describe("design audit r2 #6: unselected choices keep an edge in dark mode", () => {
  it("index.css gives a dark-mode choice button on bg-card a visible border, after the rule that dims it", () => {
    const css = readFileSync("src/index.css", "utf8");
    const dim = css.indexOf('[data-theme="dark"] :where(.bg-card) {');
    const fix = css.indexOf(':root[data-theme="dark"] button.bg-card:is([role="radio"], [aria-pressed]) {');
    expect(dim).toBeGreaterThan(-1);
    expect(fix).toBeGreaterThan(dim);
    expect(css.slice(fix, css.indexOf("}", fix))).toMatch(/border-color:\s*hsl\(0 0% 100% \/ 0\.1[2-9]\)/);
    // The chips it reaches: ChoicePill is role="radio" on bg-card when unselected.
    expect(readFileSync("src/components/ui/ChoicePill.tsx", "utf8")).toMatch(/role="radio"[\s\S]*bg-card/);
  });
});

/**
 * #19, #20, #23, #29 (25 Days, presentation only): a prize no longer repeats its brand ("GentleStyle Brush" under
 * GentleStyle reads "Brush"; a prize equal to the brand is not shown twice); the calendar count is 12px; the date's
 * dot is upright with room each side; lineup cards align to the top of their row.
 * @mutate src/components/sponsor/Sections.tsx |   if (p.toLowerCase() === b.toLowerCase()) return ""; |   if (p.toLowerCase() === "") return "";
 */
describe("design audit r2: 25 Days lineup presentation", () => {
  it("strips a leading brand from the prize and hides a prize that is only the brand", async () => {
    const { prizeWithoutBrand } = await import("@/components/sponsor/Sections");
    expect(prizeWithoutBrand("GentleStyle", "GentleStyle Brush")).toBe("Brush");
    expect(prizeWithoutBrand("GentleStyle Brush", "GentleStyle Brush")).toBe("");
    expect(prizeWithoutBrand("RYSE", "RYSE Fuel bundle")).toBe("Fuel bundle");
    expect(prizeWithoutBrand("Acme", "$50 gift card")).toBe("$50 gift card");
    const { sponsorPage } = await import("@/content/sponsorPage");
    const all = sponsorPage.lineup.days.flatMap((d) => d.partners);
    expect(all.length).toBeGreaterThan(25);
    // No shown prize starts with its own brand.
    expect(all.filter((p) => { const s = prizeWithoutBrand(p.brand, p.prize); return s && s.toLowerCase().startsWith(`${p.brand.toLowerCase()} `); })).toEqual([]);
  });

  it("the CSS: 12px calendar count, upright spaced dot, top-aligned lineup cards", () => {
    const css = readFileSync("src/pages/sponsor/sponsor.css", "utf8");
    expect(css).toMatch(/\.lh25-tile-count \{ font-size: 12px;/);
    expect(css).toMatch(/\.lh25-lineup-dot \{ font-style: normal; margin: 0 \.3em; \}/);
    expect(css).toMatch(/\.lh25-lineup \{[^}]*align-items: start;/);
  });
});

/**
 * #24 (25 Days): How-it-works cards had a numeral, an icon circle and a title; the numeral alone marks the step.
 * @mutate src/components/sponsor/Sections.tsx |             <span className="lh25-step-num" aria-hidden="true">{i + 1}</span>\n |             <span className="lh25-step-num" aria-hidden="true">{i + 1}</span>\n            <span className="lh25-icon-badge"><Icon name={s.icon} /></span>\n
 */
describe("design audit r2 #24: How it works shows the numeral, not a second icon mark", () => {
  it("HowItWorks draws no icon badge", () => {
    const src = blankComments(readFileSync("src/components/sponsor/Sections.tsx", "utf8"));
    const how = src.slice(src.indexOf("export function HowItWorks"), src.indexOf("export function", src.indexOf("export function HowItWorks") + 10));
    expect(how).toContain("lh25-step-num");
    expect(how).not.toMatch(/lh25-icon-badge/);
  });
});

/**
 * #22 (25 Days): the back-to-top button was a white disc with a grey shadow on the cream page; there it wears cream
 * with a 1px gold edge and no shadow.
 * @mutate src/components/ScrollToTop.tsx |         ...(onGiveawayPage(pathname) ? GIVEAWAY_LOOK : null),\n | \n
 */
describe("design audit r2 #22: back-to-top matches the 25 Days page", () => {
  it("ScrollToTop applies the cream + gold look on /25days", () => {
    const src = blankComments(readFileSync("src/components/ScrollToTop.tsx", "utf8"));
    expect(src).toMatch(/GIVEAWAY_LOOK = \{ background: "#fbf7ee", border: "1px solid #b08d57"[^}]*boxShadow: "none" \}/);
    expect(src).toContain("...(onGiveawayPage(pathname) ? GIVEAWAY_LOOK : null),");
  });
});

/**
 * #21 (25 Days): the trust strip wrapped 2-3 lines per label at 390/768. Below 1024px it drops the uppercase tracking.
 * @mutate src/pages/sponsor/sponsor.css |   .lh25-trust { letter-spacing: .02em; text-transform: none; font-size: 13px; } |   .lh25-trust { }
 */
describe("design audit r2 #21: the 25 Days trust strip fits below 1024px", () => {
  it("sponsor.css untracks and un-uppercases the strip under 1024px", () => {
    const css = readFileSync("src/pages/sponsor/sponsor.css", "utf8");
    expect(css).toMatch(/@media \(max-width: 1023px\) \{\s*\.lh25-trust \{ letter-spacing: \.02em; text-transform: none; font-size: 13px; \}/);
  });
});

/**
 * #42, #17: below 1024px (the bottom nav is up) the toaster's bottom offset clears the nav + 16px, also on a tablet
 * where it sits bottom-right; the close X draws at 16px inside its 44px hit area.
 * @mutate src/components/ui/sonner.tsx | bottom: navShown ? "calc(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px) + 16px)" : "24px" | bottom: "24px"
 */
describe("design audit r2 #42/#17: toasts clear the bottom nav on a tablet", () => {
  it("the offset follows the nav, and the X is 16px", () => {
    const src = blankComments(readFileSync("src/components/ui/sonner.tsx", "utf8"));
    expect(src).toContain('window.matchMedia("(min-width: 1024px)")');
    expect(src).toContain('bottom: navShown ? "calc(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px) + 16px)" : "24px"');
    expect(src).toContain("[&_svg]:!w-4 [&_svg]:!h-4");
  });
});

/**
 * #50: the filter sheet's "Clear all" was 13px next to a 56px primary; it is 16px semibold olive.
 * #33 part: the job card swipe underlays ("Not interested", "Apply") follow the member's language.
 * #34 part: the Spanish inbox title is "Mensajes" ("Bandeja de entrada" was cut at 390).
 * @mutate src/components/dashboard/filterSheet/FilterSheetFooter.tsx | "min-h-11 text-ds-16"} px-1 font-semibold | "min-h-11 text-ds-14"} px-1 font-bold
 * @mutate src/components/dashboard/SwipeMotionLayer.tsx |             {tr("jobCard.swipeApply")}\n |             Apply\n
 */
describe("design audit r2 #50/#33/#34", () => {
  it("Clear all is 16px semibold", () => {
    expect(readFileSync("src/components/dashboard/filterSheet/FilterSheetFooter.tsx", "utf8")).toContain('"min-h-11 text-ds-16"} px-1 font-semibold');
  });
  it("the swipe labels and the inbox title are Spanish in Spanish", () => {
    const src = blankComments(readFileSync("src/components/dashboard/SwipeMotionLayer.tsx", "utf8"));
    expect(src).toContain('{tr("jobCard.swipeNo")}');
    expect(src).toContain('{tr("jobCard.swipeApply")}');
    expect(src).not.toMatch(/>\s*(Not interested|Apply)\s*</);
    expect(es["jobCard.swipeNo"]).toBe("No me interesa");
    expect(es["inbox.title"]).toBe("Mensajes");
  });
});

/**
 * #11: the review's Helpr line said "have worked jobs in X Parish — your job will reach an active community"; it says
 * "N Helprs work in X Parish." The step 3 tip is 13px and translated.
 * @mutate src/components/postjob/HelprActivityNote.tsx | <span className="text-muted-foreground">work in {activity.parish} Parish.</span> | <span className="text-muted-foreground">have worked jobs in {activity.parish} Parish — your job will reach an active community.</span>
 */
describe("design audit r2 #11: plain copy on Post a job", () => {
  it("the Helpr activity line is the plain fact, and the tip is 13px", () => {
    const note = blankComments(readFileSync("src/components/postjob/HelprActivityNote.tsx", "utf8"));
    expect(note).toContain("work in {activity.parish} Parish.");
    expect(note).not.toMatch(/active community/);
    const desc = blankComments(readFileSync("src/components/postjob/detailsSection/DescriptionField.tsx", "utf8"));
    expect(desc).toContain('{tr("postJob.f.tip", { tips: unmet.join("; ") })}');
    expect(desc).not.toMatch(/text-ds-11 font-sans leading-snug/);
  });
});
