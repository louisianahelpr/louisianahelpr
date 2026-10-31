/**
 * The two money rows say what each one covers: their names alone can't, because the
 * senders don't split them cleanly (prod titles, 60 days, read 2026-10-30).
 *
 * @mutate src/components/notificationPreferences/CategoryRow.tsx | {item.description && ( | {false && (
 * @mutate src/components/notificationPreferences/constants.tsx |  description: "Finished jobs, refunds and saved cards. Some payouts and tips too.", |
 * @mutate src/components/notificationPreferences/constants.tsx |  description: "Money held for a job, payout setup, payouts and tips.", |
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CategoryRow } from "./CategoryRow";
import { defaultPrefs, rows } from "./constants";

const show = (key: string) => {
  const item = rows.find((r) => r.key === key);
  if (!item) throw new Error(`no row ${key}`);
  return render(
    <CategoryRow item={item} prefs={defaultPrefs} emailMasterEnabled emailShownOn saving={false} loaded savingKey={null} locked={false} onToggle={() => {}} />,
  );
};

describe("the money rows' descriptions", () => {
  it("Job payments says refunds and finished jobs, and owns up to the overlap", () => {
    show("payments");
    expect(screen.getByText(/Finished jobs, refunds and saved cards\. Some payouts and tips too\./)).toBeInTheDocument();
  });

  it("Payments and tips says held money, payouts and tips", () => {
    show("financial_alerts");
    expect(screen.getByText("Money held for a job, payout setup, payouts and tips.")).toBeInTheDocument();
  });

  it("neither uses a word the notice rules bar", () => {
    for (const r of rows) expect(r.description ?? "").not.toMatch(/escrow|\bfee\b/i);
  });

  it("only the two money rows carry one (floor: the list still has its rows)", () => {
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => r.description).map((r) => r.key).sort()).toEqual(["financial_alerts", "payments"]);
  });

  it("a row without one renders only its label", () => {
    const { container } = show("messages");
    expect(container.querySelector("p")).toBeNull();
  });
});
