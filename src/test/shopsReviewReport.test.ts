/**
 * Q1948 L46 leftovers (Shops audit 11-12): a Shops review can be reported and taken down by an admin (20261112094500;
 * behaviour proof src/test/pglite/shopsReviewReport.pglite.mjs), and - the privacy decision (OWNER-DECISIONS 11-12) -
 * shop reviews are never folded into the owner's PERSON rating: a shop never names its owner, so matching the shop
 * page's count and average to a person's profile would name the person behind a home shop (Q2207).
 *
 * @mutate supabase/migrations/20261112094500_shops_review_report.sql |   IF NEW.reported_type = 'shop_review' THEN |   IF NEW.reported_type = 'shop_review_off' THEN
 * @mutate src/components/reportDialog/reportReasons.ts |   shop_review: "What's wrong with this review?", |   shop_review: "",
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";

const MIG = "supabase/migrations/";
function newestBody(fn: string): string {
  const file = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort().reverse()
    .find((f) => readFileSync(MIG + f, "utf8").includes(`CREATE OR REPLACE FUNCTION public.${fn}(`))!;
  const t = readFileSync(MIG + file, "utf8");
  const s = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)![1];
  const open = t.indexOf(`\nAS ${tag}`, s) + 4 + tag.length;
  return t.slice(open, t.indexOf(`\n${tag}`, open));
}
const newestCheck = () => {
  const file = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort().reverse()
    .find((f) => readFileSync(MIG + f, "utf8").includes("ADD CONSTRAINT reports_reported_type_check"))!;
  const t = readFileSync(MIG + file, "utf8");
  return t.slice(t.lastIndexOf("ADD CONSTRAINT reports_reported_type_check"));
};

describe("Shops review reports", () => {
  it("the reports table and its trigger take a shop review", () => {
    expect(newestCheck().split(";")[0]).toContain("'shop_review'::text");
    const trig = newestBody("report_message_party_and_copy");
    expect(trig).toContain("IF NEW.reported_type = 'shop_review' THEN");
    expect(trig).toMatch(/public\.shop_review_public\(shr\.id\)/);
    expect(newestBody("notify_reporter_report_outcome")).toContain("WHEN 'shop_review' THEN 'a review'");
  });
  it("the report dialog has words for it", () => {
    const src = readFileSync("src/components/reportDialog/reportReasons.ts", "utf8");
    expect(src).toContain(`shop_review: "What's wrong with this review?",`);
  });
  it("the owner's person rating never reads shop reviews (privacy, Q2207)", () => {
    expect(newestBody("get_public_profile_stats")).not.toMatch(/shop_reviews/);
  });
});
