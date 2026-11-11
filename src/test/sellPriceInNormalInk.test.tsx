/**
 * Audit 11-10 F328 (colour half): the sell form's big price ("$15" between the - and + steppers) was drawn in
 * burnt sienna, the orange-red the app also uses for alerts, so a correct price read like an error. It now uses the
 * normal text colour. (The "buyers pay / you get" line is the money half; it waits on the owner's 11-09 rule.)
 *
 * @mutate src/components/declutter/SellFormParts.tsx | justify-center text-ds-40 text-foreground"> | justify-center text-ds-40 text-[hsl(var(--burnt-sienna))]">
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SellPriceInput } from "@/components/declutter/SellFormParts";
import type { SellFlow } from "@/components/declutter/useSellFlowState";

const ALERT_INK = /burnt-sienna|sienna-ink|accent-ink|destructive|text-alert|text-primary/;

describe("F328: the sell price is in the normal text colour", () => {
  it("neither the price box nor its $ wear an alert colour", () => {
    const s = { form: { price: "15" }, set: vi.fn(), priceCents: 1500 } as unknown as SellFlow;
    render(<SellPriceInput s={s} />);
    const input = screen.getByLabelText("Price");
    const box = input.parentElement as HTMLElement;
    const painted = [box, input, ...Array.from(box.children)].map((el) => el.className);
    expect(painted.length).toBeGreaterThan(2);
    for (const cls of painted) expect(cls).not.toMatch(ALERT_INK);
    expect(box.className).toContain("text-foreground");
  });
});
