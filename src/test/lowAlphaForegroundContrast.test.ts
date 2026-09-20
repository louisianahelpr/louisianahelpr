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
 * surface and is NOT the separator class. Three reasons recur:
 *
 *  (a) NON-TEXT. A decorative or duplicated-by-adjacent-text icon — Loader2,
 *      Video, ImagePlus, Circle, TrendingUp, ChevronRight. WCAG 1.4.3 governs
 *      TEXT; these are graphical objects, and the purely decorative ones are
 *      exempt entirely. The scanner cannot tell an icon from a word, so it
 *      reports them and a human dispositions them.
 *
 *  (b) WRONG SURFACE ASSUMED. `--parchment / 0.85` is near-white ink painted on
 *      a dark bark bar (the bulk-dismiss bar, the conversation-list overlay).
 *      The scanner composites over card and page because it cannot read a
 *      painted ancestor out of a JSX tree; on its REAL ground each of these is
 *      high-contrast. These are false positives of the static approximation,
 *      kept visible rather than silently excluded.
 *
 *  (c) REAL, AND NOT THIS LANE'S. Genuinely dim text that is a defect in its
 *      own right — the disabled calendar day, the notification-preference
 *      sublabels, the ChatPresence timestamps. Filed in docs/OPEN.md rather
 *      than changed here: this lane was sent for the separator, and "fix the
 *      exact thing named" outranks tidying on the way past. They are pinned so
 *      they cannot get WORSE or MULTIPLY unnoticed.
 *
 * To remove an entry, fix the declaration — the guard fails if a stale entry
 * lingers. To add one, say which of (a)/(b)/(c) it is and why.
 */
const ACCEPTED = new Map<string, number>([
  // (a) non-text icons
  ["src/components/BrowseMap.tsx --bark/0.6", 2], //                     2.47:1 — two Loader2 spinners
  ["src/components/analytics/AnalyticsUpgradePanel.tsx --bark/0.6", 1], // 2.47:1 — TrendingUp, beside its own heading
  ["src/components/postjob/detailsSection/VideoScope.tsx --bark/0.5", 1], // 2.08:1 — Video glyph above its label
  ["src/components/reviewPanel/ReviewForm.tsx --burnt-sienna/0.7", 1], //  2.87:1 — ImagePlus inside a labelled button
  ["src/pages/CompleteProfile.tsx --burnt-sienna/0.7", 1], //             2.87:1 — Circle bullet, aria-hidden, decorative
  ["src/components/messages/ChatHeader.tsx --olivewood/0.65", 1], //      4.24:1 — ChevronRight affordance
  ["src/components/dashboard/jobDetailDialog/JobStatTiles.tsx --burnt-sienna/0.7", 1], // 2.87:1 — tile icon

  // (b) painted on a dark ground the static scan cannot see
  ["src/components/messages/ConversationList.tsx --parchment/0.85", 1], // "1.00:1" — near-white on bark
  ["src/pages/activity/BulkDismissBar.tsx --parchment/0.85", 1], //       "1.00:1" — near-white on bark

  // (c) real, dim, and owned elsewhere — pinned so they cannot worsen
  ["src/components/ChatPresence.tsx --bark/0.55", 2], //                  2.26:1
  ["src/components/ChatPresence.tsx --bark/0.7", 1], //                   2.96:1
  ["src/components/JobConfirmation.tsx --bark/0.85", 1], //               3.97:1
  ["src/components/NotificationPreferences.tsx --olivewood/0.3", 3], //   1.79:1
  ["src/components/PushNotificationPrompt.tsx --bark/0.85", 1], //        3.97:1
  ["src/components/TrustRow.tsx --burnt-sienna/0.35", 1], //              1.62:1
  ["src/components/activity/postedJobs/ApplicantsPanel.tsx --ink-deep/0.55", 1], // 3.53:1
  ["src/components/dashboard/JobDetailDialog.tsx --burnt-sienna/0.85", 1], // 3.63:1
  ["src/components/landing/HeroSection.tsx --olivewood/0.55", 1], //      3.23:1
  ["src/components/landing/HowItWorksSection.tsx --burnt-sienna/0.35", 1], // 1.62:1
  ["src/components/messages/ConversationList.tsx --olivewood/0.6", 1], // 3.70:1
  ["src/components/messages/chatView/ChatComposer.tsx --olivewood/0.6", 1], // 3.70:1
  ["src/components/profile/EarningsTab.tsx --olivewood/0.5", 2], //       2.84:1
  ["src/components/profile/EarningsTab.tsx --olivewood/0.65", 2], //      4.24:1
  ["src/components/ui/calendar.tsx --burnt-sienna/0.78", 1], //           3.26:1
  ["src/components/ui/calendar.tsx --olivewood/0.35", 1], //              1.99:1 — disabled day, also carries opacity-50
  ["src/components/ui/sonner.tsx --olivewood/0.65", 1], //                4.24:1
  ["src/pages/GiftCard.tsx --bark/0.7", 1], //                            2.96:1
  ["src/pages/HelprWrapped.tsx --burnt-sienna/0.75", 1], //               3.11:1
  ["src/pages/HelprWrapped.tsx --burnt-sienna/0.85", 1], //               3.63:1
  ["src/pages/giftCards/RecipientPicker.tsx --olivewood/0.6", 1], //      3.70:1
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

  // @mutate src/components/TrustRow.tsx | hsl(var(--burnt-sienna) / 0.35) | hsl(var(--burnt-sienna))
  it("the accepted list does not rot", () => {
    const seen = new Set(failing.map(keyOf));
    const stale = [...ACCEPTED.keys()].filter((k) => !seen.has(k));
    expect(
      stale,
      "these were fixed or moved — delete them from ACCEPTED so the list keeps meaning something",
    ).toEqual([]);
  });
});
