/**
 * Q1948 (L46) screens: each review on a shop's page has "Report" (ReportDialog type 'shop_review'), and the admin
 * reports queue reads a shop review report as admin (shops_admin_reported_reviews), names it "Shop review · N stars",
 * and its "Remove Review" calls shops_admin_remove_review (never the Declutter one). Server rules:
 * src/test/pglite/shopsReviewReport.pglite.mjs (migration 20261112094500).
 *
 * @mutate src/components/shops/ShopReviews.tsx | onClick={() => setReporting(r.id)} data-report="shop_review" | onClick={() => undefined} data-report="shop_review"
 * @mutate src/components/shops/ShopReviews.tsx | reportedType="shop_review" reportedId={reporting} | reportedType="declutter_review" reportedId={reporting}
 * @mutate src/components/admin/adminReports/ReportedCopy.tsx |       if (part === "review" && isShopReview) await removeReportedShopReview(report.reported_id, report.id);\n |
 * @mutate src/components/admin/adminReports/ReportedCopy.tsx |   const removable = report.reported_type.startsWith("declutter_") \|\| isShopReview; |   const removable = report.reported_type.startsWith("declutter_");
 * @mutate src/components/admin/adminReports/reportedQuestions.ts |     for (const r of srs) questions.set(r.review_id, r); |     void srs;
 * @mutate src/components/admin/adminReports/reportedQuestions.ts | ${type === SHOP_REVIEW_REPORT ? "Shop" : "Declutter"} review | Declutter review
 * @mutate src/lib/shops/reviews.ts | supabase.rpc("shops_admin_remove_review", | supabase.rpc("declutter_admin_remove_review",
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls = vi.hoisted(() => ({ rpc: [] as unknown[][], declutterRemoved: [] as unknown[][], dialog: [] as unknown[] }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: unknown) => {
      calls.rpc.push([name, args]);
      if (name === "shops_shop_reviews") {
        return { data: { rating: null, review_count: 1, reviews: [{ id: "srv1", stars: 2, comment: "Late and cold", created_at: "2026-11-01T12:00:00Z" }] }, error: null };
      }
      if (name === "shops_admin_reported_reviews") {
        return { data: [{ review_id: "srv1", reviewer_id: "b1", reviewee_id: "o1", reviewer_side: "buyer", stars: 2, comment: "Late and cold", removed: false, is_seed: false }], error: null };
      }
      if (name === "shops_admin_remove_review") return { data: "removed", error: null };
      return { data: null, error: { message: `unexpected ${name}` } };
    },
  },
}));
vi.mock("@/lib/declutter/api", () => ({
  removeReportedQuestion: async () => "removed",
  removeReportedReview: async (...a: unknown[]) => { calls.declutterRemoved.push(a); return "removed"; },
  fetchReportedQuestions: async () => [],
  fetchReportedReviews: async () => [],
}));
vi.mock("@/components/ReportDialog", () => ({
  default: (p: { reportedType: string; reportedId: string }) => {
    calls.dialog.push(p);
    return <div data-testid="report-dialog">{`${p.reportedType}:${p.reportedId}`}</div>;
  },
}));

import { ShopReviewsCard } from "./ShopReviews";
import { ReportedCopy } from "@/components/admin/adminReports/ReportedCopy";
import { hydrateReportedQuestions, isQuestionReport, questionAuthor, questionSubject } from "@/components/admin/adminReports/reportedQuestions";

beforeEach(() => { calls.rpc = []; calls.declutterRemoved = []; calls.dialog = []; });

describe("Q1948: a Shops review can be reported and taken down", () => {
  it("each review on the shop page has Report, which opens the shop_review report", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><ShopReviewsCard shopId="s1" /></QueryClientProvider>);
    expect(await screen.findByText("Late and cold")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(await screen.findByTestId("report-dialog")).toHaveTextContent("shop_review:srv1");
  });

  it("the queue reads shop review reports as admin, names the stars, and the person is the reviewer", async () => {
    expect(isQuestionReport("shop_review")).toBe(true);
    const { questions, failed } = await hydrateReportedQuestions([{ reported_type: "shop_review", reported_id: "srv1" }]);
    expect(failed).toBe(false);
    expect(calls.rpc).toEqual([["shops_admin_reported_reviews", { p_review_ids: ["srv1"] }]]);
    const rv = questions.get("srv1");
    expect(questionSubject("shop_review", rv, false)).toBe("Shop review · 2 stars");
    expect(questionSubject("shop_review", undefined, false)).toBe("Deleted review");
    expect(questionAuthor("shop_review", rv)).toBe("b1");
  });

  it("Remove Review on a shop review report calls the Shops remove, never Declutter's", async () => {
    const done = vi.fn();
    render(<ReportedCopy report={{ id: "r1", reported_id: "srv1", reported_type: "shop_review", status: "pending", reported_content: "2 stars: Late and cold" }} onDone={done} />);
    expect(screen.getByText(/Reported shop review:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Review" }));
    await waitFor(() => expect(calls.rpc).toEqual([["shops_admin_remove_review", { p_review_id: "srv1", p_note: "", p_report_id: "r1" }]]));
    expect(calls.declutterRemoved).toEqual([]);
    expect(done).toHaveBeenCalled();
  });

  it("a removed shop review says so, with no take-down", () => {
    render(<ReportedCopy report={{ id: "r1", reported_id: "srv1", reported_type: "shop_review", status: "pending", reported_content: "2 stars" }} gone onDone={() => undefined} />);
    expect(screen.getByText("This review was removed.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
