/**
 * A PRICE IS NEVER OLIVE. Rust = money, olive = action (spec v2 §1.1). A dollar
 * amount painted in the olive action colour reads as a button or a link.
 *
 * Found 2026-10-20 (lead, builder1e quick wins): the public profile's job list
 * (src/pages/user/JobsList.tsx) painted every job's price `text-primary`
 * (--primary = --bark, the olive action). Money is --accent-ink (rust).
 *
 * CLASS: every tracked .tsx under src/ is scanned for an element whose children
 * render a formatted amount (`{formatPrice…(`, `{formatCurrency…(`,
 * `{formatMoney…(`, `{formatDollars…(`, `{formatCents…(`), and the element that
 * directly wraps it must not carry an olive action token (text-primary, --bark,
 * --sage, --olive, --primary).
 *
 * KNOWN_OLIVE_PRICES is EXACT and two-way: a fixed site must leave the list in
 * the same commit, and a new olive price fails.
 *
 * @mutate src/pages/profile/HomeHistory.tsx | font-medium tabular-nums" style={{ color: "hsl(var(--bark))" }}> | font-medium tabular-nums" style={{ color: "hsl(var(--accent-ink))" }}>
 * @mutate src/pages/user/JobsList.tsx | <span className="text-ds-13 font-bold" style={{ color: "hsl(var(--accent-ink))" }}>${formatPrice(job.budget)}</span> | <span className="text-ds-13 font-bold text-primary">${formatPrice(job.budget)}</span>
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "../..");
const AMOUNT = /\{\s*(?:formatPrice|formatCurrency|formatMoney|formatDollars|formatCents)\w*\(/g;
const OLIVE = /\btext-primary\b|--bark\b|--sage\b|\btext-sage\b|\btext-bark\b|--olive\b|--primary\b/;

/** Not yet restyled (2026-10-20). Each one leaves this list when it turns rust. */
// @two-way src/test/pricesAreNeverOlive.test.ts:stale baseline entry — remove it (lower the baseline)
const KNOWN_OLIVE_PRICES = [
  "src/components/admin/AdminPayoutBatches.tsx",
  "src/components/postjob/RecurringSchedulePicker.tsx",
  "src/components/profile/MonthlyGoalCard.tsx",
  "src/pages/profile/HomeHistory.tsx",
];

function wrappingTag(src: string, at: number): string | null {
  for (let i = at; i >= 0; i--) {
    if (src[i] === "<" && /[A-Za-z]/.test(src[i + 1] ?? "")) {
      const end = src.indexOf(">", i);
      if (end === -1 || end > at) return null;
      return src.slice(i, end + 1);
    }
    if (src[i] === "<" && src[i + 1] === "/") return null;
  }
  return null;
}

function scan(): { sites: number; olive: Map<string, string[]> } {
  let sites = 0;
  const olive = new Map<string, string[]>();
  for (const rel of trackedFiles("src")) {
    if (!rel.endsWith(".tsx") || rel.startsWith("src/test/") || /\.test\.tsx$/.test(rel)) continue;
    const src = blankComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
    for (const m of src.matchAll(AMOUNT)) {
      const tag = wrappingTag(src, m.index!);
      if (!tag) continue;
      sites++;
      if (OLIVE.test(tag)) {
        const line = src.slice(0, m.index!).split("\n").length;
        olive.set(rel, [...(olive.get(rel) ?? []), `${line}: ${tag}`]);
      }
    }
  }
  return { sites, olive };
}

describe("prices are never olive (rust = money, spec v2 §1.1)", () => {
  const { sites, olive } = scan();
  it("finds the formatted-amount render sites (inventory floor)", () => {
    expect(sites).toBeGreaterThan(40);
  });
  it("no new olive price", () => {
    const fresh = [...olive.entries()].filter(([f]) => !KNOWN_OLIVE_PRICES.includes(f));
    expect(fresh).toEqual([]);
  });
  it("KNOWN_OLIVE_PRICES is exact: every entry is still olive", () => {
    const stale = KNOWN_OLIVE_PRICES.filter((f) => !olive.has(f));
    expect(stale, `stale baseline entry — remove it (lower the baseline): ${stale.join(", ")}`).toEqual([]);
  });
});
