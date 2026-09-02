import { describe, it, expect } from "vitest";
import {
  buildHomeHistoryPdf,
  buildHomeHistorySummaryLines,
  formatHelperList,
  formatRecordDate,
  homeHistoryFileName,
  resolveServiceSpan,
  totalPaid,
  type HomeHistoryDocumentInput,
  type HomeHistoryJobRow,
} from "./homeHistoryDocument";
import { buildWorkRecordPdf } from "./workRecordDocument";
import { hasChargeBreakdown, posterPaidDollars } from "./posterJobCost";

const job = (over: Partial<HomeHistoryJobRow> = {}): HomeHistoryJobRow => ({
  title: "Deep clean before move-out",
  category: "Cleaning",
  serviceDate: "2026-08-01T02:00:00Z",
  helpers: ["Marcus Thibodeaux"],
  paid: 199.8,
  where: "East Baton Rouge",
  ...over,
});

describe("what a poster PAID is not the job's budget", () => {
  it("sums every line item the escrow charge actually bills", () => {
    expect(
      posterPaidDollars({
        budget: 640,
        customer_fee_amount: 70.4,
        urgent_fee: 25,
        sales_tax_amount: 8.13,
      }),
    ).toBeCloseTo(743.53, 2);
  });

  it("a legacy row with no stamped fee columns degrades to exactly its budget", () => {
    // These jobs predate the fee columns; their poster really was charged the
    // budget, so reporting anything else would be inventing a charge.
    expect(posterPaidDollars({ budget: 120 })).toBe(120);
    expect(hasChargeBreakdown({ budget: 120 })).toBe(false);
  });

  it("never lets a null or NaN column poison the total", () => {
    expect(
      posterPaidDollars({
        budget: 100,
        customer_fee_amount: null,
        urgent_fee: undefined,
        sales_tax_amount: Number.NaN,
      }),
    ).toBe(100);
  });

  it("reports a breakdown only once a fee was actually charged", () => {
    expect(hasChargeBreakdown({ budget: 100, customer_fee_amount: 12 })).toBe(true);
  });
});

describe("the record's dates resolve in the platform's zone, not the reader's", () => {
  it("a UTC-midnight completion reads as the Louisiana day", () => {
    // 2026-08-01T00:00:00Z is 7pm on July 31 in America/Chicago. Formatted in
    // the device's zone this record would file a job under the wrong month.
    expect(formatRecordDate("2026-08-01T00:00:00Z")).toBe("Jul 31, 2026");
  });

  it("refuses to print Invalid Date", () => {
    expect(formatRecordDate("not-a-date")).toBe("Unknown date");
    expect(formatRecordDate(null)).toBe("Unknown date");
  });

  it("collapses a one-job span instead of printing 'X - X'", () => {
    expect(resolveServiceSpan([job()])).toBe("Jul 31, 2026");
  });

  it("spans first worked to last worked, oldest first", () => {
    expect(
      resolveServiceSpan([
        job({ serviceDate: "2026-08-20T15:00:00Z" }),
        job({ serviceDate: "2025-03-04T15:00:00Z" }),
      ]),
    ).toBe("Mar 4, 2025 - Aug 20, 2026");
  });
});

describe("the whole roster is named, not just the lead", () => {
  it("lists three Helprs with a real 'and'", () => {
    expect(formatHelperList(["Marcus", "Renee", "Dee"])).toBe("Marcus, Renee and Dee");
  });

  it("two Helprs get no comma", () => {
    expect(formatHelperList(["Marcus", "Renee"])).toBe("Marcus and Renee");
  });

  it("says so rather than inventing a name when the roster is empty", () => {
    expect(formatHelperList([])).toBe("Not recorded");
    expect(formatHelperList(["  "])).toBe("Not recorded");
  });
});

describe("the exported record", () => {
  const input: HomeHistoryDocumentInput = {
    ownerName: "Jane Doe",
    generatedAt: new Date("2026-09-01T15:00:00Z"),
    jobs: [job(), job({ title: "Post-storm debris haul", helpers: ["A", "B", "C"], paid: 940.25 })],
  };

  it("totals every job", () => {
    expect(totalPaid(input.jobs)).toBeCloseTo(1140.05, 2);
  });

  it("names the file so it is findable in a downloads folder", () => {
    expect(homeHistoryFileName(input)).toBe("home-service-record-jane-doe-2026-09-01.pdf");
  });

  it("an account with no name on file says so rather than shipping a placeholder", () => {
    const lines = buildHomeHistorySummaryLines({ ...input, ownerName: "   " });
    expect(lines).toContain("Property owner: Name not on file");
  });

  it("the text fallback carries the totals and every job line", () => {
    const lines = buildHomeHistorySummaryLines(input);
    expect(lines[0]).toBe("HOME SERVICE RECORD");
    expect(lines).toContain("Jobs on record: 2");
    expect(lines).toContain("Total paid: $1,140.05");
    expect(lines.join("\n")).toContain("A, B and C");
  });

  it("the text fallback carries NO url — a filler link is what shared the homepage", () => {
    expect(buildHomeHistorySummaryLines(input).join("\n")).not.toMatch(/https?:\/\//);
  });

  it("builds real PDF bytes", async () => {
    const file = await buildHomeHistoryPdf(input);
    expect(file.fileName.endsWith(".pdf")).toBe(true);
    // "%PDF" base64-encodes to a stream starting "JVBER".
    expect(file.base64.startsWith("JVBER")).toBe(true);
    expect(file.base64.length).toBeGreaterThan(2000);
  });

  it("paginates rather than running a long history off the page", async () => {
    const many = { ...input, jobs: Array.from({ length: 60 }, () => job()) };
    const file = await buildHomeHistoryPdf(many);
    expect(file.base64.length).toBeGreaterThan(4000);
  });
});

describe("the shared letterhead did not break the work record it was extracted from", () => {
  it("still builds real PDF bytes", async () => {
    const file = await buildWorkRecordPdf({
      fullName: "Marcus Thibodeaux",
      memberSince: "2025-03-01T12:00:00Z",
      identityVerified: true,
      jobsCompleted: 12,
      totalEarnings: 4210.5,
      avgRating: 4.8,
      reviewCount: 9,
      firstWorkDay: "2025-04-02",
      lastWorkDay: "2026-08-20",
      generatedAt: new Date("2026-09-01T15:00:00Z"),
    });
    expect(file.fileName.endsWith(".pdf")).toBe(true);
    expect(file.base64.startsWith("JVBER")).toBe(true);
    expect(file.base64.length).toBeGreaterThan(2000);
  });
});
