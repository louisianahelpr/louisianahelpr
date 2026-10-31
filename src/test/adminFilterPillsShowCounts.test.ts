/**
 * CLASS CHECK (owner, 2026-10-27, from /admin?view=support at 1440): "pending,
 * resolved and all each need the number of items in each". Support's
 * Pending / Resolved / All, Reports' five, Stuck Jobs' "Awaiting a human /
 * Including resolved", Subscriptions' All / Active / Expired and Disputes'
 * Age / Filed by / Category chips said only their names.
 *
 * INVENTORY (from source, comments blanked): every non-test file under
 * src/components/admin that draws a pill or tab control (`aria-pressed=`,
 * `role="tab"`, `<SegmentedControl`, `<FilterChipGroup`). Each is either
 * COUNTED, with the source evidence that every pill's label carries its
 * number, or NOT_A_LIST_FILTER, with why (a setting, a time window, a pin).
 * EXACT both ways: a new admin pill row fails here until it shows its counts
 * or says why it has none.
 *
 * SAME DATA: Support, Reports and Stuck Jobs count each pill from the very
 * query its list reads (useFilterCounts: same key function, same fetcher), so
 * a pill can never disagree with the list under it.
 * Measured live (pill numbers against the nav badge and the Priority Alert):
 * e2e/prod-audit/admin-chrome.spec.ts.
 *
 * @mutate src/components/admin/AdminSupport.tsx |             {pillLabel(label, counts.get(value))} |             {label}
 * @mutate src/components/admin/AdminReports.tsx |             {pillLabel(label, counts.get(value))} |             {label}
 * @mutate src/components/admin/AdminStalledJobs.tsx | label: pillLabel("Awaiting a human", counts.get(false)) | label: "Awaiting a human"
 * @mutate src/components/admin/AdminSubscriptions.tsx | {pillLabel(f.charAt(0).toUpperCase() + f.slice(1), isInitialLoading \|\| isError ? undefined : pillCount(f))} | {f.charAt(0).toUpperCase() + f.slice(1)}
 * @mutate src/components/admin/adminDisputes/DisputeFilters.tsx | ].map((o) => ({ ...o, label: pillLabel(o.label, p.partyCount(o.id as PartyFilter)) }))} | ]}
 * @mutate src/components/admin/AdminSupport.tsx | useFilterCounts(SUPPORT_FILTERS, supportQueueKey, fetchSupportTickets | useFilterCounts(SUPPORT_FILTERS, (f) => ["admin-support-count", f], fetchSupportTickets
 * @mutate src/components/admin/useFilterCounts.ts |   count === undefined ? label : `${label} (${count})`; |   `${label} (${count ?? 0})`;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { blankComments } from "./helpers/blankNonCode";
import { pillLabel } from "@/components/admin/useFilterCounts";

const ROOT = resolve(__dirname, "..", "..");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

/** Pill rows that show a count on every pill, and the source that proves it. */
const COUNTED: Record<string, RegExp[]> = {
  "src/components/admin/AdminSupport.tsx": [/\{pillLabel\(label, counts\.get\(value\)\)\}/],
  "src/components/admin/AdminReports.tsx": [/\{pillLabel\(label, counts\.get\(value\)\)\}/],
  "src/components/admin/AdminStalledJobs.tsx": [
    /label: pillLabel\("Awaiting a human", counts\.get\(false\)\)/,
    /label: pillLabel\("Including resolved", counts\.get\(true\)\)/,
  ],
  "src/components/admin/AdminSubscriptions.tsx": [/\{pillLabel\(f\.charAt\(0\)\.toUpperCase\(\) \+ f\.slice\(1\), [^)]*pillCount\(f\)\)\}/],
  "src/components/admin/adminDisputes/DisputeTabs.tsx": [
    /Open\s*<span className="text-ds-11 tabular-nums">\(\{openCount\}\)<\/span>/,
    /Decided\s*<span className="text-ds-11 tabular-nums">\(\{decidedCount\}\)<\/span>/,
  ],
  // AUD31-45 moved the Open queue's filters into DisputeFilters.tsx (closed on a phone); the counts moved with them.
  "src/components/admin/adminDisputes/DisputeFilters.tsx": [
    /label: pillLabel\(o\.label, p\.ageCount\(o\.id as AgeFilter\)\)/,
    /label: pillLabel\(o\.label, p\.partyCount\(o\.id as PartyFilter\)\)/,
    /label: pillLabel\(o\.label, p\.categoryCount\(o\.id as CategoryFilter\)\)/,
  ],
  "src/components/admin/AdminJobs.tsx": [/\{f\.label\} \(\{f\.count\}\)/],
  "src/components/admin/AdminPayoutBatches.tsx": [/\(\{readyBatches\.length\}\)/, /\(\{heldBatches\.length\}\)/],
  "src/components/admin/AdminHelperTiers.tsx": [/All \(\{helpers\.length\}\)/, /\{t\} \(\{counts\[t\] \|\| 0\}\)/],
  "src/components/admin/AdminReferrals.tsx": [/`Codes \(\$\{codes\.length\}\)`/, /`Referrals \(\$\{referrals\.length\}\)`/, /`Credits \(\$\{credits\.length\}\)`/],
  "src/components/admin/AdminUsers.tsx": [/count: t\.count,/],
  "src/components/admin/AdminAnalyticsDrilldowns.tsx": [/`All \(\$\{users\.length\}\)`|\(\$\{users\.filter/, /`All \(\$\{jobs\.length\}\)`/],
  "src/components/admin/marketing/MarketingQueue.tsx": [/` \(\$\{counts\[f\.id\]\}\)`/],
};

/** Pill/tab controls that do not filter a list of items. EXACT. */
const NOT_A_LIST_FILTER: Record<string, string> = {
  "src/components/admin/AdminHealth.tsx": "the fill-rate time window (7d/30d/...), a setting, not a list",
  "src/components/admin/AdminSidebar.tsx": "the pin / unpin toggle on a rail row",
  "src/components/admin/adminJobs/StatusOverrideDialog.tsx": "picks the status to SET on a job, in a dialog",
  "src/components/admin/settings/FeatureSwitchesCard.tsx": "picks a hidden switch's audience (a setting)",
  "src/components/admin/dashboard/DateRangeBar.tsx": "the Dashboard's date range (7d/30d/90d/custom)",
  "src/components/admin/dashboard/TaxReserveCard.tsx": "the tax reserve rate (20%..35%), a setting",
  "src/components/admin/adminDisputes/FilterChipGroup.tsx": "the shared labelled chip group; DisputeFilters passes it labels that carry the counts",
};

const files = execFileSync("git", ["ls-files", "src/components/admin"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
const PILL = /aria-pressed=|role="tab"|<SegmentedControl\b|<FilterChipGroup\b/;
const withPills = files.filter((f) => PILL.test(code(f))).sort();

describe("every admin filter pill shows how many items it holds (owner 2026-10-27)", () => {
  it("reads the real tree (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(withPills.length).toBeGreaterThan(15);
  });

  it("every pill row is counted or listed with why it is not a list filter (exact, both ways)", () => {
    const listed = { ...COUNTED, ...NOT_A_LIST_FILTER };
    expect(withPills.filter((f) => !(f in listed)), "an admin pill row with no counts: label each pill with pillLabel(label, n)").toEqual([]);
    expect(Object.keys(listed).filter((f) => !withPills.includes(f)), "stale entry: remove it").toEqual([]);
  });

  it("each counted row's labels carry their number", () => {
    for (const [f, evidence] of Object.entries(COUNTED)) {
      const src = code(f);
      for (const re of evidence) expect(src, `${f}: ${re}`).toMatch(re);
    }
  });

  it("Support, Reports and Stuck Jobs count each pill from the query its list reads", () => {
    const pairs: [string, string, string][] = [
      ["src/components/admin/AdminSupport.tsx", "supportQueueKey", "fetchSupportTickets"],
      ["src/components/admin/AdminReports.tsx", "reportsQueueKey", "fetchReports"],
      ["src/components/admin/AdminStalledJobs.tsx", "stalledQueueKey", "fetchStalledQueue"],
    ];
    for (const [f, key, fetcher] of pairs) {
      const src = code(f);
      expect(src, f).toMatch(new RegExp(`useFilterCounts\\(\\w+, ${key}, ${fetcher},`));
      expect(src, f).toMatch(new RegExp(`const queryKey = ${key}\\((filter|includeResolved)\\);`));
      expect(src, f).toMatch(new RegExp(`fetcher: \\(\\) => ${fetcher}\\((filter|includeResolved)\\)`));
    }
  });

  it("a count that has not loaded shows the bare label, never a guessed 0", () => {
    expect(pillLabel("Pending", undefined)).toBe("Pending");
    expect(pillLabel("Pending", 0)).toBe("Pending (0)");
    expect(pillLabel("Pending", 6)).toBe("Pending (6)");
  });
});
