/**
 * ME-010: category decides Louisiana labor sales tax, which is charged at
 * checkout. A paid job must not offer categories on the other side of the
 * taxable line (the server refuses them: trg_funded_category_tax_class), and
 * the server list must stay the one salesTax.ts uses.
 *
 * @mutate src/components/activity/EditJobDialog.tsx |  disabled={crossesTaxClass(c.value)}> | >
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { TAXABLE_CATEGORIES } from "@/lib/salesTax";
import type { Job } from "./activityConstants";

// Radix Select renders its options only when open; a native stand-in exposes
// each item's disabled state directly.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SelectItem: ({ value, disabled, children }: { value: string; disabled?: boolean; children: ReactNode }) => (
    <li data-value={value} aria-disabled={disabled ? "true" : "false"}>{children}</li>
  ),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { EditJobDialog } = await import("./EditJobDialog");

const job = (over: Partial<Job>) =>
  ({ id: "j1", title: "Shelves", description: "", category: "cleaning", location: "", date_needed: "2026-10-01",
     start_time: null, special_requirements: null, helper_id: null, payment_status: "unpaid", stripe_session_id: null,
     is_flexible_schedule: false, ...over }) as unknown as Job;

const disabledValues = () =>
  Array.from(document.querySelectorAll("li[data-value]"))
    .filter((li) => li.getAttribute("aria-disabled") === "true")
    .map((li) => li.getAttribute("data-value"));

describe("a paid job cannot cross the sales-tax line by category (ME-010)", () => {
  it("funded exempt job: every taxable category is disabled, and only those", () => {
    render(<EditJobDialog job={job({ payment_status: "escrow" })} onClose={() => {}} onSaved={() => {}} />);
    expect(disabledValues().sort()).toEqual([...TAXABLE_CATEGORIES].sort());
    expect(screen.getByTestId("category-tax-lock-hint")).toBeTruthy();
  });

  it("unpaid job: nothing is disabled and no hint", () => {
    render(<EditJobDialog job={job({})} onClose={() => {}} onSaved={() => {}} />);
    expect(disabledValues()).toEqual([]);
    expect(screen.queryByTestId("category-tax-lock-hint")).toBeNull();
  });

  it("the server trigger's taxable list is salesTax.ts's", () => {
    const sql = readFileSync(resolve(__dirname, "../../../supabase/migrations/20260924082243_funded_category_tax_class_lock.sql"), "utf8");
    const arr = sql.match(/taxable CONSTANT text\[\] := ARRAY\[([^\]]*)\]/)?.[1] ?? "";
    const list = [...arr.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(list.length).toBeGreaterThan(1); // assembly + handyman on 2026-09-24
    expect(list).toEqual([...TAXABLE_CATEGORIES].sort());
  });
});
