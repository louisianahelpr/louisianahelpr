/**
 * The two money rows say what each one covers: their names alone can't, because the
 * senders don't split them cleanly (prod titles, 60 days, read 2026-10-30). NOID-15 (10-31)
 * moved payouts and tips to financial_alerts (src/test/payoutAndTipNoticesOneRow.test.ts),
 * so Job payments no longer owns up to an overlap.
 *
 * @mutate src/components/notificationPreferences/CategoryRow.tsx | {item.description && ( | {false && (
 * @mutate src/components/notificationPreferences/constants.tsx |  description: "Finished jobs, refunds and saved cards.", |  description: "Finished jobs, refunds and saved cards. Some payouts and tips too.",
 * @mutate src/components/notificationPreferences/constants.tsx |  description: "Money held for a job, payout setup, payouts and tips.", |
 * @mutate src/components/notificationPreferences/constants.tsx | label: "Buying & selling", | label: "Sales",
 * @mutate src/components/notificationPreferences/constants.tsx | label: "Pickups", description: "Pickup and delivery times, reminders and updates.", | label: "Pickups",
 * @mutate src/components/notificationPreferences/constants.tsx | label: "Messages", description: "New messages, plus a reminder at 15 min and 2 h if a job message is still unread. Texts follow Text alerts.", | label: "Messages",
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CategoryRow } from "./CategoryRow";
import { declutterRows, defaultPrefs, rows } from "./constants";

const show = (key: string) => {
  const item = rows.find((r) => r.key === key);
  if (!item) throw new Error(`no row ${key}`);
  return render(
    <CategoryRow item={item} prefs={defaultPrefs} emailMasterEnabled emailShownOn saving={false} loaded savingKey={null} locked={false} onToggle={() => {}} />,
  );
};

describe("the money rows' descriptions", () => {
  it("Job payments says refunds and finished jobs, and no longer claims payouts or tips", () => {
    show("payments");
    expect(screen.getByText("Finished jobs, refunds and saved cards.")).toBeInTheDocument();
    expect(screen.queryByText(/payouts|tips/i)).toBeNull();
  });

  it("Payments and tips says held money, payouts and tips", () => {
    show("financial_alerts");
    expect(screen.getByText("Money held for a job, payout setup, payouts and tips.")).toBeInTheDocument();
  });

  it("neither uses a word the notice rules bar", () => {
    for (const r of rows) expect(r.description ?? "").not.toMatch(/escrow|\bfee\b/i);
  });

  it("only the two money rows and Messages carry one (floor: the list still has its rows)", () => {
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => r.description).map((r) => r.key).sort()).toEqual(["financial_alerts", "messages", "payments"]);
  });

  it("a row without one renders only its label", () => {
    const { container } = show("reviews");
    expect(container.querySelector("p")).toBeNull();
  });

  // A3-105 (audit 11-01): the unread-message reminders (20261101183017, type 'message') had no mention; the Messages
  // row now says they exist and what controls their texts.
  it("Messages names the unread reminders and says texts follow Text alerts", () => {
    show("messages");
    expect(screen.getByText(/reminder at 15 min and 2 h if a job message is still unread\. Texts follow Text alerts\./)).toBeInTheDocument();
  });
});

// A3-103 (audit 11-01): every Declutter switch says what it sends, and the row that carries the BUYER's checkout
// deadline (declutter_sales: "Reserved for you: check out within 30 minutes") is named for both sides.
describe("the Declutter rows' descriptions", () => {
  it("every Declutter row has one line (floor: all eight rows)", () => {
    expect(declutterRows.length).toBeGreaterThan(7);
    for (const r of declutterRows) expect(r.description ?? "", r.key).toMatch(/^[A-Z].{15,}\.$/);
    for (const r of declutterRows) expect(r.description ?? "").not.toMatch(/escrow|\bfee\b/i);
  });

  it("the sales row is named for buyers and sellers and says it holds the checkout deadlines", () => {
    const sales = declutterRows.find((r) => r.key === "declutter_sales");
    expect(sales?.label).toBe("Buying & selling");
    expect(sales?.description).toMatch(/checkout deadlines when you buy/);
    render(<CategoryRow item={sales!} prefs={defaultPrefs} emailMasterEnabled emailShownOn saving={false} loaded savingKey={null} locked={false} onToggle={() => {}} />);
    expect(screen.getByText(sales!.description!)).toBeInTheDocument();
  });
});
