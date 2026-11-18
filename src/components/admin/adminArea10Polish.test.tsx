/**
 * Design audit area 10 (Admin, 11-18) Medium/Low fixes in one guard:
 *  #16 Revenue chart: dollars and new users on separate axes.
 *  #24 Users row: all-lowercase names title-cased, nameless "No name (email)" sorted last.
 *  #25 Users row: no "Active" chip on every row; "Email not confirmed".
 *  #27 Charts: whole-number count ticks, "Jun '26" months, "1 paid tip".
 *  #31 Plain words on the payouts ledger and the social daily cap.
 *  #32 Disabled Pay Out says why; 13px select-all.
 *  #33 Report status chip: tab label, Support's colours.
 *  #36 Custom-range days field: no native stepper.
 *  #37 Restrict chips 44px.
 *  #41 Growth placeholders say "e.g.", the social auto-publish switch sits right on a phone.
 *
 * @mutate src/components/admin/adminUserHelpers.tsx |   if (!an !== !bn) return an ? -1 : 1; |   if (!an !== !bn) return an ? 1 : -1;
 * @mutate src/components/admin/adminUserHelpers.tsx |   if (name !== name.toLowerCase()) return name; |   return name;
 * @mutate src/components/admin/adminUserHelpers.tsx |   return null;\n}; |   return <Badge className="bg-primary/10 text-primary text-ds-11">Active</Badge>;\n};
 * @mutate src/components/admin/adminAnalytics/adminAnalyticsHelpers.ts |   return `${month} '${year}`; |   return `${month} ${year}`;
 * @mutate src/components/admin/AdminAnalyticsCharts.tsx | <Line yAxisId="people" type="monotone" dataKey="signups" | <Line yAxisId="usd" type="monotone" dataKey="signups"
 * @mutate src/components/admin/adminPayoutBatches/BatchRow.tsx | {!batch.stripe_account_id && (\n              <p data-testid="payout-disabled-reason" | {false && (\n              <p data-testid="payout-disabled-reason"
 * @mutate src/components/admin/AdminReports.tsx | {REPORT_FILTERS.find((f) => f.value === report.status)?.label ?? | {report.status ??
 * @mutate src/components/admin/dashboard/DateRangeBar.tsx |  [&::-webkit-inner-spin-button]:appearance-none |
 * @mutate src/components/admin/RestrictApplicationsDialog.tsx | className={`min-h-11 p-2 rounded-ds-md | className={`p-2 rounded-ds-md
 * @mutate src/components/admin/AdminGrowthLinks.tsx | placeholder="e.g. Lafayette" | placeholder="Lafayette"
 * @mutate src/components/admin/marketing/MarketingSettingsCard.tsx | items-center gap-3 self-end sm:self-auto"> | items-center gap-3">
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { adminRowName, compareAdminNames, statusBadge, type Profile } from "./adminUserHelpers";
import { chartMonthLabel } from "./adminAnalytics/adminAnalyticsHelpers";

const ROOT = join(__dirname, "..", "..", "..");
const code = (rel: string) => {
  const src = blankComments(readFileSync(join(ROOT, rel), "utf8"));
  expect(src.length, `inventory floor: ${rel} was read`).toBeGreaterThan(400);
  return src;
};

describe("design audit area 10: Users row (#24, #25)", () => {
  it("title-cases an all-lowercase name, keeps a typed one, and names a nameless member", () => {
    expect(adminRowName("marie beaumont", "m@x.com")).toBe("Marie Beaumont");
    expect(adminRowName("Marie deLaune", "m@x.com")).toBe("Marie deLaune");
    expect(adminRowName("  ", "nobody@x.com")).toBe("No name (nobody@x.com)");
    expect(adminRowName(null, null)).toBe("No name");
  });

  it("sorts nameless members after named ones", () => {
    const rows = [{ full_name: "", email: "a@x.com" }, { full_name: "Zed", email: "z@x.com" }, { full_name: "amy", email: "b@x.com" }];
    expect([...rows].sort(compareAdminNames).map((r) => r.full_name || r.email)).toEqual(["amy", "Zed", "a@x.com"]);
  });

  it("draws no chip for an active, confirmed member and says 'Email not confirmed' otherwise", () => {
    const confirmed = { ban_status: "active", email_verified: true } as unknown as Profile;
    expect(statusBadge(confirmed)).toBeNull();
    const src = code("src/components/admin/adminUserHelpers.tsx");
    expect(src).toContain(">Email not confirmed</Badge>");
    expect(src).not.toContain(">Active</Badge>");
    expect(code("src/components/admin/AdminUsers.tsx")).toContain('label: "Email not confirmed"');
  });
});

describe("design audit area 10: charts (#16, #27)", () => {
  it("a chart month reads Jun '26", () => {
    expect(chartMonthLabel(new Date(Date.UTC(2026, 5, 15)), "UTC")).toBe("Jun '26");
  });

  it("the revenue chart keeps dollars and people on separate axes, counts tick whole", () => {
    const src = code("src/components/admin/AdminAnalyticsCharts.tsx");
    expect(src).toContain('<Line yAxisId="people" type="monotone" dataKey="signups"');
    expect(src.match(/<Line yAxisId="usd"/g)?.length).toBe(2);
    expect(src.match(/allowDecimals=\{false\}/g)?.length).toBeGreaterThanOrEqual(3);
    expect(code("src/components/admin/AdminAnalytics.tsx")).not.toMatch(/\} paid tips</);
  });
});

describe("design audit area 10: small screens and words (#31, #32, #33, #36, #37, #41)", () => {
  it("each fix is in place", () => {
    expect(code("src/components/admin/adminPayoutBatches/BatchRow.tsx")).toMatch(/\{!batch\.stripe_account_id && \(\s*<p data-testid="payout-disabled-reason"/);
    expect(code("src/components/admin/adminPayoutBatches/LedgerList.tsx")).not.toContain("payout_transfers");
    expect(code("src/components/admin/marketing/MarketingSettingsCard.tsx")).not.toContain("UTC day");
    const reports = code("src/components/admin/AdminReports.tsx");
    expect(reports).toContain("{REPORT_FILTERS.find((f) => f.value === report.status)?.label ??");
    expect(reports).not.toContain('report.status === "pending" ? "new" : report.status');
    expect(code("src/components/admin/dashboard/DateRangeBar.tsx")).toContain("[&::-webkit-inner-spin-button]:appearance-none");
    expect(code("src/components/admin/RestrictApplicationsDialog.tsx")).toContain("className={`min-h-11 p-2 rounded-ds-md");
    const growth = code("src/components/admin/AdminGrowthLinks.tsx");
    for (const p of ["Fix a leaking faucet", "Lafayette", "70501", "80"]) expect(growth).toContain(`placeholder="e.g. ${p}"`);
    expect(code("src/components/admin/marketing/MarketingSettingsCard.tsx")).toContain("items-center gap-3 self-end sm:self-auto\">");
  });
});
