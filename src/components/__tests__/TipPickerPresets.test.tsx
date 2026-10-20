/**
 * Board 180's tip presets (lh-money-escrow re-review 2026-10-20, #5): 10/15/20%
 * of the Helpr's share in whole cents, and $5/$10/$20 whenever any percent
 * would be outside create-payment's $3-$1,000 bounds (a $25 job's 10% is $2.50).
 *
 * @mutate src/components/TipCostBreakdown.tsx | [10, 15, 20].map((p) => ({ label: `${p}%`, cents: Math.round(jobPriceDollars * p) })) | [10, 15, 20].map((p) => ({ label: `${p}%`, cents: Math.round(jobPriceDollars * p * 10) }))
 * @mutate src/components/TipCostBreakdown.tsx | pct.length > 0 && pct.every((x) => inBounds(x.cents)) | pct.length > 0
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { TipPicker } from "../TipCostBreakdown";

const names = () => screen.getAllByRole("button").map((b) => b.textContent);

describe("TipPicker presets (board 180)", () => {
  it("a $90 share offers 10/15/20% in whole cents", () => {
    render(<TipPicker jobPriceDollars={90} valueDollars={undefined} onChange={() => {}} />);
    expect(names()).toEqual(["10%$9.00", "15%$13.50", "20%$18.00", "Other"]);
  });
  it("picking 15% hands back the exact dollars", () => {
    const onChange = vi.fn();
    render(<TipPicker jobPriceDollars={90} valueDollars={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^15%/ }));
    expect(onChange).toHaveBeenCalledWith(13.5);
  });
  it("a $25 share (10% under the $3 minimum) falls back to $5/$10/$20", () => {
    render(<TipPicker jobPriceDollars={25} valueDollars={undefined} onChange={() => {}} />);
    expect(names()).toEqual(["$5", "$10", "$20", "Other"]);
  });
  it("no price falls back to $5/$10/$20", () => {
    render(<TipPicker jobPriceDollars={null} valueDollars={undefined} onChange={() => {}} />);
    expect(names()).toEqual(["$5", "$10", "$20", "Other"]);
  });
});
