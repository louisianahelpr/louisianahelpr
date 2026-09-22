/**
 * THE CLASS, not the instance: the two screens that carry a phone filter
 * strip must carry the SAME affordance for folding it away.
 *
 * ── THE ORIGINAL BUG THIS IS BUILT FROM ──────────────────────────────────
 * Owner, 2026-09-22, three messages in a row, all one report:
 *   "message shouod be collapsed like post and jobs on a smaller view"
 *   "post jobs and messagess hould collpase and expand all the same"
 *   "no it needs to be a drop down like post an djobs to show active and all"
 *
 * My Posts / My Jobs (ActivityHeader) had a disclosure chevron beside the
 * search magnifier; Messages (ConversationList) had had the identical chevron
 * DELETED three days earlier, on 2026-09-19. Two screens in the same app,
 * wearing the same title card, with the same search button in the same
 * corner, behaved differently when you pressed the space next to it.
 *
 * ── WHY A FILE-DERIVED CHECK AND NOT A RENDER TEST ───────────────────────
 * Each screen already has its own render tests (activityTabLabelsFitAPhone,
 * messagesDesktopFilterTabsInline) and they both passed all through the
 * divergence — because each asserts its OWN screen. The defect only exists in
 * the gap between them. So this reads the two SOURCES and diffs the
 * affordance, which is the only place the drift is visible.
 *
 * The inventory is derived from the world (the files on disk), not from a
 * list this test also owns — the "registry checked against itself" trap.
 *
 * ── WHAT IS PINNED, AND WHAT IS DELIBERATELY NOT ─────────────────────────
 * Pinned: both screens have a ChevronDown disclosure button; both start
 * OPEN (`useState(true)`); both emit `aria-expanded` and a conditional
 * `aria-controls`; both re-open the strip when a non-default filter arrives;
 * both fire a haptic on press; both suppress the chevron on the wide screen.
 *
 * NOT pinned: the tab words, the counts, the ids, the exact class strings,
 * the row composition. The two screens filter different things and are
 * allowed to look different in every way except this control's behaviour.
 *
 * SHOWN RED on the original bug: at 320dfba24 (before the 2026-09-22 fix)
 * ConversationList.tsx had no ChevronDown import, no `aria-expanded`, and no
 * open-state at all, so every assertion in the parity block below fails.
 * Re-prove with the @mutate lines.
 *
 * @mutate src/components/messages/ConversationList.tsx | const [tabsOpenPhone, setTabsOpenPhone] = useState(true); | const [tabsOpenPhone, setTabsOpenPhone] = useState(false);
 * @mutate src/components/messages/ConversationList.tsx | aria-expanded={tabsOpen} | data-expanded={tabsOpen}
 * @mutate src/pages/activity/ActivityHeader.tsx | const [tabsOpenPhone, setTabsOpenPhone] = useState(true); | const [tabsOpenPhone, setTabsOpenPhone] = useState(false);
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE INVENTORY. Both files are read from disk; a rename breaks this test
 * loudly rather than letting it pass over a file that no longer exists.
 */
const SCREENS = {
  "My Posts / My Jobs": "src/pages/activity/ActivityHeader.tsx",
  Messages: "src/components/messages/ConversationList.tsx",
} as const;

const SOURCES = Object.fromEntries(
  Object.entries(SCREENS).map(([name, rel]) => {
    const path = resolve(process.cwd(), rel);
    const src = readFileSync(path, "utf8");
    if (!src.trim()) throw new Error(`${rel} is empty — the inventory is not real`);
    return [name, src];
  }),
) as Record<keyof typeof SCREENS, string>;

/**
 * Each trait is a question about the AFFORDANCE, asked the same way of both
 * files. Anything that has to differ between the two screens (ids, words,
 * counts) is deliberately outside every pattern.
 */
const TRAITS: Array<{ trait: string; pattern: RegExp; why: string }> = [
  {
    trait: "renders a ChevronDown disclosure glyph",
    pattern: /<ChevronDown\b/,
    why: "the owner's word for it is 'a drop down'; the same glyph on both screens is what makes them one control",
  },
  {
    trait: "the chevron rotates to carry open/closed",
    pattern: /rotate-180/,
    why: "the rotation IS the state indicator — neither screen wears a filled pill for it",
  },
  {
    trait: "the strip STARTS OPEN",
    pattern: /useState\(true\)/,
    why: "shipping Activity closed-by-default hid ALL FIVE tab words at 320/375/414 — the same complaint it was meant to fix, worse",
  },
  {
    trait: "emits aria-expanded",
    pattern: /aria-expanded=\{tabsOpen\}/,
    why: "a disclosure with no aria-expanded is a button a screen reader cannot report the state of",
  },
  {
    trait: "emits aria-controls ONLY while the panel exists",
    pattern: /aria-controls=\{tabsOpen \? [A-Z_a-z"'-]+ : undefined\}/,
    why: "the strip unmounts when collapsed; pointing at a missing id is axe aria-valid-attr-value critical",
  },
  {
    trait: "a non-default filter re-opens a folded strip",
    pattern: /if \(!isDefault[A-Za-z]*\) setTabsOpen/,
    why: "the disclosure may hide a CONTROL; it may never hide an ACTIVE filter",
  },
  {
    trait: "fires a haptic on press",
    pattern: /hapticLight\(\); setTabsOpen/,
    why: "every other control in these two clusters does; a silent one reads as a dead press on device",
  },
  {
    trait: "darkens its ink while a non-default filter is on",
    pattern: /text-\[hsl\(var\(--bark\)\)\]/,
    why: "so a filter folded away behind the chevron is never silent",
  },
  {
    trait: "the wide screen keeps the strip up instead (no chevron there)",
    pattern: /const tabsOpen = (inlineFilters|isWebDesktop) \|\| tabsOpenPhone;/,
    why: "the disclosure is a phone affordance — the desktop row has the width, so a chevron there costs a press and saves nothing",
  },
];

describe("filter disclosure — My Posts / My Jobs and Messages cannot drift apart", () => {
  it("the inventory is real: two distinct, non-trivial sources were read", () => {
    const names = Object.keys(SOURCES);
    expect(names).toHaveLength(2);
    expect(SOURCES[names[0] as keyof typeof SOURCES]).not.toBe(
      SOURCES[names[1] as keyof typeof SOURCES],
    );
    for (const src of Object.values(SOURCES)) expect(src.length).toBeGreaterThan(2000);
  });

  for (const { trait, pattern, why } of TRAITS) {
    it(`both screens: ${trait}`, () => {
      const missing = (Object.keys(SOURCES) as Array<keyof typeof SOURCES>).filter(
        (name) => !pattern.test(SOURCES[name]),
      );
      expect(
        missing,
        `${missing.join(" and ")} ${missing.length === 1 ? "does" : "do"} not ${trait}.\n` +
          `Why it matters: ${why}\n` +
          `Source of truth for this affordance: ${SCREENS["My Posts / My Jobs"]}.\n` +
          `Pattern: ${pattern}`,
      ).toEqual([]);
    });
  }
});
