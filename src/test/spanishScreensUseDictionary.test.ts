/**
 * Spanish language option (owner-approved 2026-10-29, Builder 60): on every
 * screen converted to the dictionary, no member-facing words are written in
 * the component. They come from t("...") (src/lib/i18n/en.ts + es.ts), so a
 * Spanish member never meets a stray English line on a converted screen, and
 * a new string added later fails here until it goes through the dictionary.
 *
 * What counts as written-in words (comments ignored via blankComments):
 *   - JSX text between tags: <h1>Log in</h1>
 *   - aria-label / placeholder / title / alt with a literal value
 *   - a capitalised sentence-like string literal ("Add your password",
 *     toast.error("..."), cond ? "Hide" : "Show")
 * CONVERTED is the inventory; ALLOWED holds the exact non-UI literals (font
 * names, test ids) per file, two-way (an entry no longer present fails too).
 *
 * The landing hero's English lines are LOCKED (CLAUDE.md): en.ts must keep
 * them word for word, and es.ts must carry their Spanish.
 *
 * @mutate src/pages/auth/Login.tsx | {t("login.passwordMissing")} | Add your password
 * @mutate src/pages/auth/Login.tsx | aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")} | aria-label={showPassword ? "Hide password" : "Show password"}
 * @mutate src/lib/i18n/en.ts | "hero.subhead": "Hire help or find work. One account, real neighbors.", | "hero.subhead": "Hire help or find work.",
 * @mutate src/components/MobileNav.tsx |           {shown}\n        </span> |           {label}\n        </span>
 * @mutate src/lib/i18n/navLabels.ts |   "/messages": "nav.messages",\n | \n
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { navKey } from "@/lib/i18n/navLabels";
import { leftItems, rightItems, exploreItem, youItem, sectionItems } from "@/components/mobileNav/mobileNavHelpers";
import { SECTIONS } from "@/components/sections/sectionsConfig";

const ROOT = resolve(__dirname, "..", "..");

/** Screens (and shared pieces of them) whose words all go through t(). */
const CONVERTED = [
  "src/components/LanguageToggle.tsx",
  "src/components/auth/OrRule.tsx",
  "src/pages/auth/Login.tsx",
  "src/pages/auth/Signup.tsx",
  "src/pages/auth/signup/SignupStep1.tsx",
  "src/pages/auth/signup/SignupStep2.tsx",
  "src/pages/auth/CompleteProfile.tsx",
  "src/pages/auth/completeProfile/CompleteProfileIntro.tsx",
  "src/components/profile/DeleteAccountDialog.tsx",
  "src/components/profile/DeleteAccountReauth.tsx",
];

/** Exact literals that are not member-facing words, per file. */
// @two-way src/test/spanishScreensUseDictionary.test.ts:stale ALLOWED
const ALLOWED: Record<string, string[]> = {
  // Report tags and a thrown Error the member never reads (userFacingError shows the t() fallback).
  "src/pages/auth/Signup.tsx": ["Account creation failed", "Signup.completeProfile", "Signup.createAccountAndFinish"],
  // A report tag.
  "src/pages/auth/CompleteProfile.tsx": ["CompleteProfile.legalAcceptances"],
  // Keyboard key names (e.key / getModifierState), not words.
  "src/pages/auth/signup/SignupStep1.tsx": ["CapsLock", "Enter", "Enter", "Enter", "Enter"],
};

function findRawStrings(src: string): string[] {
  const code = blankComments(src)
    .split("\n")
    .filter((l) => !/^\s*import\s/.test(l))
    .join("\n");
  const out: string[] = [];
  // JSX text: ">Words<" (not an arrow "=>", not a generic "Foo<Bar>").
  for (const m of code.matchAll(/(?<![=-])>\s*([^<>{}();=&|`]*[A-Za-z]{2,}[^<>{}();=&|`]*?)\s*</g)) {
    const text = m[1].trim();
    if (/^[\w.]+$/.test(text) && /^[a-z]/.test(text)) continue; // a lone identifier, e.g. a type arg
    out.push(text);
  }
  // Attribute literals people read or hear.
  for (const m of code.matchAll(/\b(aria-label|placeholder|title|alt)="([^"]*[A-Za-z][^"]*)"/g)) out.push(m[2]);
  // Capitalised sentence-like string literals.
  for (const re of [/"([A-Z][a-z][^"\n]*)"/g, /'([A-Z][a-z][^'\n]*)'/g, /`([A-Z][a-z][^`\n]*)`/g]) {
    for (const m of code.matchAll(re)) out.push(m[1]);
  }
  return out;
}

describe("converted screens take every word from the dictionary", () => {
  it("the inventory is not empty", () => {
    expect(CONVERTED.length).toBeGreaterThan(1);
  });
  for (const file of CONVERTED) {
    it(`${file} has no written-in words`, () => {
      const found = findRawStrings(readFileSync(join(ROOT, file), "utf8"));
      const allowed = ALLOWED[file] ?? [];
      expect(found.filter((s) => !allowed.includes(s)), file).toEqual([]);
      // Two-way: an allowance no longer needed must be removed.
      expect(allowed.filter((s) => !found.includes(s)), `${file} stale ALLOWED`).toEqual([]);
    });
    it(`${file} reads the dictionary`, () => {
      expect(readFileSync(join(ROOT, file), "utf8")).toMatch(/\bt\(\s*["'`]|useLanguage\(/);
    });
  }
  it("ALLOWED names only converted files", () => {
    expect(Object.keys(ALLOWED).filter((f) => !CONVERTED.includes(f))).toEqual([]);
  });
});

describe("the detector itself", () => {
  it("catches each kind of written-in words and passes t() calls", () => {
    expect(findRawStrings(`<p>Add your password</p>`)).toEqual(["Add your password"]);
    expect(findRawStrings(`<b aria-label="Show password" />`)).toContain("Show password");
    expect(findRawStrings(`toast.error("That code didn't match.")`)).toEqual(["That code didn't match."]);
    expect(findRawStrings(`<p>{t("login.passwordMissing")}</p>`)).toEqual([]);
    expect(findRawStrings(`const f = (e) => set(a);\nconst x: Array<Foo> = [];`)).toEqual([]);
  });
});

describe("the landing hero: English locked, Spanish present", () => {
  it("en.ts keeps the locked hero words exactly", () => {
    expect(`${en["hero.titleLead"]} ${en["hero.titleAccent"]}`).toBe("Louisiana’s local partner.");
    expect(en["hero.subhead"]).toBe("Hire help or find work. One account, real neighbors.");
  });
  it("es.ts carries a Spanish hero (not the English left in place)", () => {
    for (const k of ["hero.titleLead", "hero.titleAccent", "hero.subhead"] as const) {
      expect(es[k].trim(), k).not.toBe("");
      expect(es[k], k).not.toBe(en[k]);
    }
  });
});

describe("the main nav (rail + phone dock) shows its words in the member's language", () => {
  it("every nav destination has a dictionary key", () => {
    const items = [...leftItems, ...rightItems, exploreItem, youItem, ...sectionItems, ...SECTIONS];
    expect(items.length).toBeGreaterThan(8);
    expect(items.filter((i) => !navKey(i.path, i.label)).map((i) => i.path)).toEqual([]);
  });
  it("the dock and rail render the translated word, not the config label", () => {
    const dock = blankComments(readFileSync(join(ROOT, "src/components/MobileNav.tsx"), "utf8"));
    const rail = blankComments(readFileSync(join(ROOT, "src/components/DesktopSidebarNav.tsx"), "utf8"));
    expect(dock.match(/<span\s+data-dock-label[\s\S]*?<\/span>/)?.[0] ?? "").toMatch(/\{shown\}/);
    expect(dock).toMatch(/const shown = shownKey \? tr\(shownKey\) : label;/);
    expect(rail).toMatch(/const shown = shownKey \? tr\(shownKey\) : label;/);
    expect(rail).toMatch(/style=\{\{ fontWeight: active \? 700 : 500 \}\}\s*>\s*\{shown\}/);
    expect(rail).toContain('{tr("nav.create")}');
  });
});
