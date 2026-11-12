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
 * @mutate src/lib/i18n/enScreens.ts | "hero.subhead": "Hire help, find work, or buy and sell. One account, real neighbors.", | "hero.subhead": "Hire help or find work.",
 * @mutate src/components/MobileNav.tsx |     const shown = shownKey ? tr(shownKey) : label; |     const shown = label;
 * @mutate src/lib/i18n/navLabels.ts |   "/messages": "nav.messages",\n | \n
 * @mutate src/pages/home/HomeDashboard.tsx | >{t("home.caughtUp")}</p> | >You're all caught up</p>
 * @mutate src/pages/home/HomeDashboard.tsx | <GroupSection title={t("home.comingUp")}> | <GroupSection title="Coming up">
 * @mutate src/components/messages/chatView/ChatTimeline.tsx | {composerLocked ? t("msg.noneYet") : t("msg.sayHello")} | {composerLocked ? "No messages yet." : "Say hello."}
 * @mutate src/pages/messages/useMessageSections.tsx | aria-label={t("msg.filterAria")} | aria-label="Filter messages"
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | <dt className="font-bold text-foreground">{t("offer.youPayIfYes")}</dt> | <dt className="font-bold text-foreground">You pay if the seller says yes</dt>
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx |           {t("free.takeBack")}\n |           Take back my ask\n
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | {t("free.pick")} | Pick
 * @mutate src/components/declutter/FreeAskSheet.tsx | {isToday(d.slots[0].iso) ? t("fask.today") : d.label} | {isToday(d.slots[0].iso) ? "Today" : d.label}
 * @mutate src/components/declutter/FreeAskSheet.tsx | text-base font-semibold">{t("fask.when")}</h2> | text-base font-semibold">When can you pick it up?</h2>
 * @mutate src/components/declutter/DeclutterQuestions.tsx | text-muted-foreground">{t("dq.none")}</p> | text-muted-foreground">No questions yet.</p>
 * @mutate src/components/declutter/DeclutterOfferTrade.tsx | label={t("dp.tradeListLabel")} | label="Your listing to trade"
 * @mutate src/components/declutter/SellSummaryCard.tsx | placeholder={t("sell.detailsPlaceholder")} | placeholder="e.g. Works great. Small scuff on the base."
 * @mutate src/components/messages/ConversationListBody.tsx |                 {t("msg.noneMatch")}\n |                 No conversations match\n
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
  "src/pages/auth/completeProfile/saveCompletedProfile.ts", // CompleteProfile's save path (Q806)
  "src/components/profile/DeleteAccountDialog.tsx",
  "src/components/profile/DeleteAccountReauth.tsx",
  "src/pages/jobs/JobsSection.tsx",
  "src/components/sections/SectionTabs.tsx",
  "src/components/sections/ExploreSwitcher.tsx",
  "src/components/sections/SoonPill.tsx",
  "src/components/sections/AppTopBar.tsx",
  // F260q (owner 11-11 "Spanish everything"): the section search bar and Declutter Browse's chips and cards.
  "src/components/sections/SectionSearchBar.tsx",
  "src/components/declutter/DeclutterCategoryChips.tsx",
  "src/components/declutter/DeclutterActiveFilters.tsx",
  "src/components/declutter/DeclutterItemCard.tsx",
  // F260q: Home (the Dashboard) chrome; its to-do lines are data (useNeedsYouTodos.ts).
  "src/pages/home/HomeDashboard.tsx",
  // F260q: Messages (the inbox list, its chips and header, the open thread's timeline and jump chip).
  "src/components/messages/ConversationListBody.tsx",
  "src/components/messages/ConversationListHeader.tsx",
  "src/components/messages/ConversationList.tsx",
  "src/components/messages/ConversationRow.tsx",
  "src/components/messages/MessageBubble.tsx",
  "src/components/messages/chatView/ChatTimeline.tsx",
  "src/components/messages/chatView/JumpToBottomButton.tsx",
  "src/pages/messages/useMessageSections.tsx",
  // F260q: Declutter's buy bar and offer box (enOffer.ts).
  "src/components/declutter/DeclutterOfferPanel.tsx",
  "src/components/declutter/DeclutterQuestions.tsx",
  // F260q: the item page's panels (enDeclPanels.ts): price drop, price hint, delivery prices, trade offer.
  "src/components/declutter/DeclutterPriceDrop.tsx",
  "src/components/declutter/DeclutterPriceHint.tsx",
  "src/components/declutter/DeliveryPriceList.tsx",
  "src/components/declutter/DeclutterOfferTrade.tsx",
  "src/components/declutter/ItemPickupBlock.tsx",
  // F260q: the Sell form's summary card (sell.* in enDeclPanels.ts).
  "src/components/declutter/SellSummaryCard.tsx",
  "src/components/declutter/SellTradesRow.tsx",
  "src/components/declutter/CategoryDrillDown.tsx",
  "src/components/declutter/SellOneScreen.tsx",
  // F260q: the whole free-item file (asker's panel, rules sentence, giver's list, Buying's asks, free checkout; enFree.ts)
  // and the Ask for it sheet (enFreeAsk.ts).
  "src/components/declutter/DeclutterFreeClaim.tsx",
  "src/components/declutter/FreeAskSheet.tsx",
  // F260q: Home's money strip and the head of You › Money (enMoneyTiles.ts).
  "src/pages/home/homeDashboard/HomeMoneyTiles.tsx",
  // F260q: the deal room's receipt card and system rows (enChatEvents.ts, built by jobSystemEvents.ts).
  "src/components/messages/chatView/ChatReceiptCard.tsx",
  "src/components/messages/chatView/SystemEventRow.tsx",
];

/** Exact literals that are not member-facing words, per file. */
// @two-way src/test/spanishScreensUseDictionary.test.ts:stale ALLOWED
const ALLOWED: Record<string, string[]> = {
  // Placeholder values postProblems feeds formProblem while the AI is still writing; never shown.
  "src/components/declutter/SellOneScreen.tsx": ["Being written", "Answered"],
  // The heading value the category list is keyed by (HEADING_KEY maps it to its words).
  "src/components/declutter/CategoryDrillDown.tsx": ["Hobbies and fun"],
  "src/pages/home/HomeDashboard.tsx": ["SmsPhonePrompt"],
  "src/components/messages/ConversationList.tsx": ["Escape"],
  "src/components/messages/ConversationRow.tsx": ["Louisiana Helpr team", "Enter", "Spacebar", "ConversationRow"],
  "src/components/messages/chatView/ChatTimeline.tsx": ["ChatTimeline"],
  // Report tags and a thrown Error the member never reads (userFacingError shows the t() fallback).
  "src/pages/auth/Signup.tsx": ["Account creation failed", "Signup.completeProfile", "Signup.createAccountAndFinish"],
  // A report tag (CompleteProfile's save path, moved out of CompleteProfile.tsx, Q806).
  "src/pages/auth/completeProfile/saveCompletedProfile.ts": ["CompleteProfile.legalAcceptances"],
  // Keyboard key names (e.key / getModifierState), not words.
  "src/pages/auth/signup/SignupStep1.tsx": ["CapsLock", "Enter", "Enter", "Enter", "Enter"],
  // English config names (tests and the @mutate lines read them); the member sees each tab's labelKey and
  // the gear's labelKey through t() (jobsTabsInSpanish.test.tsx renders them in Spanish).
  "src/pages/jobs/JobsSection.tsx": ["Jobs settings", "Posted", "Working"],
  // Keyboard key names; the Browse tab reads tr("tabs.browse") (F260q, 11-11).
  "src/components/sections/SectionTabs.tsx": ["ArrowRight", "ArrowLeft", "Home", "End"],
  "src/components/sections/SectionSearchBar.tsx": ["Escape"],
  // itemTimesPlan's plan.usual values, compared as identifiers (never rendered by ItemPickupBlock).
  // The time zone the dates are read in (Intl), not words.
  "src/components/declutter/DeclutterFreeClaim.tsx": ["America/Chicago", "America/Chicago"],
  "src/components/declutter/FreeAskSheet.tsx": ["America/Chicago"],
  "src/components/declutter/ItemPickupBlock.tsx": ["Pickup times", "Pickup and meetup times", "Meetup times", "Pickup and meetup times"],
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
    expect(en["hero.subhead"]).toBe("Hire help, find work, or buy and sell. One account, real neighbors.");
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
    // The dock is icons only since 2026-11-06: the translated word is each tab's name (its aria-label).
    expect(dock.match(/<TabButton[\s\S]*?<\/TabButton>/)?.[0] ?? "").toMatch(/ariaLabel=\{[^\n]*\bshown\b/);
    expect(dock).toMatch(/const shown = shownKey \? tr\(shownKey\) : label;/);
    expect(rail).toMatch(/const shown = shownKey \? tr\(shownKey\) : label;/);
    expect(rail).toMatch(/style=\{\{ fontWeight: active \? 700 : 500 \}\}\s*>\s*\{shown\}/);
    expect(rail).toContain('{tr("nav.create")}');
  });
});
