import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs inventory, shared with the CLI and with CI.
import { collectLowAlphaForegrounds } from "../../scripts/a11y/low-alpha-text-inventory.mjs";

/**
 * THE CLASS, NOT THE INSTANCE.
 *
 * On 2026-09-20 the changed-route a11y sweep caught ONE decorative "·" styled
 * `hsl(var(--burnt-sienna) / 0.5)` at 2.33:1 against a 4.5:1 requirement, on
 * /profile?tab=earnings. It was fixed. THREE byte-identical copies stayed live
 * for the rest of the day — ReviewsTab, RecentTransfers, SavedHelperCard — for
 * one reason: the sweep only visits routes a diff touches, and nobody had the
 * list. Two of the three even carried `aria-hidden`, which does not help: axe's
 * colour-contrast rule matches VISUAL visibility, not the accessibility tree.
 *
 * So this guard owns the class. It re-derives every alpha'd foreground colour
 * declaration in src/ FROM SOURCE on every run, composites each over the real
 * surface tokens the way the compositor does, scores it, and diffs the result
 * against the baseline below. The baseline is not the inventory — the inventory
 * comes from the world, the baseline is the list of things a human has looked
 * at and accepted — so a list that is both input and oracle cannot happen here.
 *
 * WHAT MAKES IT FAIL:
 *   - a NEW low-contrast foreground anywhere in src/ (the separator class);
 *   - an EXTRA instance in a file that already had some (counts are pinned);
 *   - a baseline entry whose declarations are gone, so the list cannot rot.
 *
 * Keyed by file + token + alpha, NOT by line number: line numbers move every
 * time anything above them is edited, and a guard that demands re-pinning on
 * unrelated edits teaches people to re-pin without looking.
 */

/**
 * ACCEPTED, EACH LOOKED AT. Everything here is below 4.5:1 on at least one
 * surface and is NOT a defect. Three reasons, and only three:
 *
 *  (a) NON-TEXT. A decorative or duplicated-by-adjacent-text icon — Loader2,
 *      Video, ImagePlus, Circle, TrendingUp, ChevronRight, Gift, Bell, Search,
 *      sonner's close ×. WCAG 1.4.3 governs TEXT; these are graphical objects
 *      under 1.4.11, whose floor is 3:1, and the purely decorative ones are
 *      exempt outright. The scanner cannot tell an icon from a word — it reads
 *      a `color:` declaration, and a Lucide glyph takes its stroke from
 *      `currentColor` exactly like a letter does — so it reports them and a
 *      human dispositions them. EVERY entry below names the glyph, so "it's an
 *      icon" can be checked rather than believed.
 *
 *  (b) WRONG SURFACE ASSUMED. `--parchment / 0.85` is near-white ink painted on
 *      a dark bark bar (the bulk-dismiss bar, the conversation-list overlay).
 *      The scanner composites over card and page because it cannot read a
 *      painted ancestor out of a JSX tree; on its REAL ground each of these is
 *      high-contrast. These are false positives of the static approximation,
 *      kept visible rather than silently excluded.
 *
 *  (c) A DIFFERENT WCAG THRESHOLD APPLIES, and is met. The scanner hard-codes
 *      4.5:1 because it cannot read a font size out of a `clamp()` or an
 *      `[aria-disabled]` out of a render prop. Two cases, both argued in a
 *      comment at the declaration itself, not only here.
 *
 * (c) USED TO MEAN "real, dim, and someone else's problem" — twenty-one text
 * declarations parked behind a promise. On 2026-09-20 they were fixed rather
 * than re-parked: nineteen declarations darkened or re-tokened to the lowest
 * value that clears AA, five reclassified to (a) after looking at what the
 * element actually was, and two to (c). That category no longer exists, and it
 * should not come back — a real failure gets fixed or it gets a WCAG clause.
 *
 * To remove an entry, fix the declaration — the guard fails if a stale entry
 * lingers. To add one, say which of (a)/(b)/(c) it is and why.
 */
const ACCEPTED = new Map<string, number>([
  // (a) non-text icons — 1.4.11's 3:1 floor, or decorative and exempt outright
  ["src/components/BrowseMap.tsx --bark/0.6", 2], //                     2.47:1 — two Loader2 spinners
  ["src/components/analytics/AnalyticsUpgradePanel.tsx --bark/0.6", 1], // 2.47:1 — TrendingUp, beside its own heading
  ["src/components/postjob/detailsSection/VideoScope.tsx --bark/0.5", 1], // 2.08:1 — Video glyph above its label
  ["src/components/reviewPanel/ReviewForm.tsx --burnt-sienna/0.7", 1], //  2.87:1 — ImagePlus inside a labelled button
  ["src/pages/CompleteProfile.tsx --burnt-sienna/0.7", 1], //             2.87:1 — Circle bullet, aria-hidden, decorative
  ["src/components/messages/ChatHeader.tsx --olivewood/0.65", 1], //      4.24:1 — ChevronRight affordance
  ["src/components/dashboard/jobDetailDialog/JobStatTiles.tsx --burnt-sienna/0.7", 1], // 2.87:1 — tile icon
  // Reclassified 2026-09-20 — each was on the "21 failing text declarations"
  // list, and each turned out to be a glyph, not a word.
  ["src/pages/HelprWrapped.tsx --burnt-sienna/0.75", 1], //               3.11:1 — <Gift className="w-10 h-10">, ornament above its own <h2>
  ["src/components/landing/HeroSection.tsx --olivewood/0.55", 1], //      3.23:1 — <ChevronDown>, aria-hidden scroll hint that fades out by 160px
  ["src/pages/giftCards/RecipientPicker.tsx --olivewood/0.6", 1], //      3.70:1 — <Search> inside the field, pointer-events-none; the placeholder says it
  ["src/components/PushNotificationPrompt.tsx --bark/0.85", 1], //        3.97:1 — <Bell className="w-3.5 h-3.5"> beside its own label
  ["src/components/ui/sonner.tsx --olivewood/0.65", 1], //                4.24:1 — sonner's close is an <svg aria-hidden stroke="currentColor">, button labelled "Close toast"

  // (b) painted on a dark ground the static scan cannot see
  ["src/components/messages/ConversationList.tsx --parchment/0.85", 1], // "1.00:1" — near-white on bark
  ["src/pages/activity/BulkDismissBar.tsx --parchment/0.85", 1], //       "1.00:1" — near-white on bark

  // (c) a different WCAG threshold applies, and is met
  //
  // The disabled day: 1.4.3 exempts "text that is part of an inactive user
  // interface component" by name. Darkening it is not a fix — a disabled day
  // that reads as legible as an enabled one is a new defect — and it carries
  // `opacity-50` beside the tint saying the same thing twice on purpose.
  ["src/components/ui/calendar.tsx --olivewood/0.35", 1], //              1.99:1 — react-day-picker's `disabled` day button
  //
  // The step numerals: `clamp(2.125rem, 6.5vw, 6rem)` font-black is never below
  // 34px, so 1.4.3's LARGE SCALE floor of 3:1 governs, not 4.5:1. They were
  // 0.35 = 1.62:1, which missed even that, and are now the lowest alpha that
  // clears 3:1 on every surface. Not taken further on purpose: full-strength
  // sienna would make "01" louder than the Bodoni title under it.
  ["src/components/landing/HowItWorksSection.tsx --burnt-sienna/0.75", 1], // 3.11:1 worst surface, 3.61:1 on its real light ground
]);

type Row = { file: string; line: number; token: string; alpha: number; worst: [string, number]; source: string };

function keyOf(r: Row) {
  return `${r.file} --${r.token}/${r.alpha}`;
}

describe("low-alpha foreground contrast", () => {
  const { rows, failing } = collectLowAlphaForegrounds() as { rows: Row[]; failing: Row[] };

  it("scanned a real tree — the guard cannot pass vacuously", () => {
    // If the walker or the regexes break, `failing` goes to zero and every
    // assertion below passes while measuring nothing. This is the floor.
    expect(rows.length, "no alpha'd foreground declarations found at all").toBeGreaterThan(300);
  });

  // @mutate src/components/profile/ReviewsTab.tsx | <span aria-hidden="true" className="mr-2">·</span> | <span aria-hidden="true" className="mr-2" style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
  it("the four `·` separators inherit their line and clear AA", () => {
    // The original bug, named. `hsl(var(--burnt-sienna) / 0.5)` as a FOREGROUND
    // is the exact shape that failed; it must not come back anywhere.
    const sienna = rows.filter((r) => r.token === "burnt-sienna" && r.alpha === 0.5);
    expect(
      sienna.map((r) => `${r.file}:${r.line}`),
      "a separator went back to burnt-sienna at 0.5 — 2.33:1 light, 2.15:1 dark",
    ).toEqual([]);
  });

  // @mutate src/components/profile/savedHelpersTab/SavedHelperCard.tsx | <span aria-hidden="true">·</span> | <span aria-hidden="true" style={{ color: "hsl(var(--bark) / 0.4)" }}>·</span>
  it("no low-contrast foreground colour that a human has not dispositioned", () => {
    const seen = new Map<string, number>();
    for (const r of failing) seen.set(keyOf(r), (seen.get(keyOf(r)) ?? 0) + 1);

    const unexplained: string[] = [];
    for (const [key, count] of seen) {
      const allowed = ACCEPTED.get(key);
      if (allowed === undefined) {
        const worst = failing.find((r) => keyOf(r) === key)!;
        unexplained.push(
          `NEW  ${key}  (${worst.worst[1].toFixed(2)}:1 on ${worst.worst[0]})\n` +
            `       ${worst.file}:${worst.line}  ${worst.source}`,
        );
      } else if (count > allowed) {
        unexplained.push(`MORE ${key}  pinned at ${allowed}, found ${count}`);
      }
    }

    expect(
      unexplained,
      "A foreground colour with an alpha composites to less than 4.5:1 on a real\n" +
        "surface. Either darken it (or let it inherit its line, which is how the\n" +
        "separator was fixed), or add it to ACCEPTED with a reason.",
    ).toEqual([]);
  });

  // The mutation used to darken TrustRow's separator, which was the stalest
  // candidate in the list. TrustRow has no tint at all any more (2026-09-20),
  // so the mutation moved to the one remaining (c) entry that names an alpha:
  // taking the step numerals to full sienna deletes
  // `HowItWorksSection --burnt-sienna/0.75` from the world and the entry below
  // must then be reported stale.
  // @mutate src/components/landing/HowItWorksSection.tsx | hsl(var(--burnt-sienna) / 0.75) | hsl(var(--burnt-sienna))
  it("the accepted list does not rot", () => {
    const seen = new Set(failing.map(keyOf));
    const stale = [...ACCEPTED.keys()].filter((k) => !seen.has(k));
    expect(
      stale,
      "these were fixed or moved — delete them from ACCEPTED so the list keeps meaning something",
    ).toEqual([]);
  });
});
