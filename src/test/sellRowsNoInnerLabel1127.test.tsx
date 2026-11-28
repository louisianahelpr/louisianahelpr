/**
 * Polish audit 11-27 #121: Sell's inline editors repeated their label: the open row's heading "Condition · Done", then
 * "Condition" again over the chips (Category and Size the same), and Details opened as "Details" over "Anything else?
 * (optional)". Now the open row draws only its heading; the chips / drill-down keep the word as their accessible name,
 * and the Details box says what goes in it ("Anything else buyers should know (optional)"), named by the row heading.
 *
 * @mutate src/components/declutter/SellSummaryCard.tsx | <ChipGroup labelHidden label={t("sell.condition")} | <ChipGroup label={t("sell.condition")}
 * @mutate src/components/declutter/SellSummaryCard.tsx | groups={CATEGORY_GROUPS} labelHidden value={form.category} | groups={CATEGORY_GROUPS} value={form.category}
 * @mutate src/components/declutter/DeclutterSellSteps.tsx |       {!labelHidden && <p className="text-ds-14 font-semibold text-foreground">{label}</p>} |       <p className="text-ds-14 font-semibold text-foreground">{label}</p>
 * @mutate src/components/declutter/SellSummaryCard.tsx | <Textarea id="sell-desc" aria-labelledby="sell-row-description-title" | <Textarea id="sell-desc"
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { ChipGroup } from "@/components/declutter/DeclutterSellSteps";
import { en } from "@/lib/i18n/en";

const card = blankComments(readFileSync("src/components/declutter/SellSummaryCard.tsx", "utf8"));

describe("Sell's open rows say their name once (polish audit 11-27 #121)", () => {
  it("is not vacuous: the card has the three chip/drill-down rows and the Details box", () => {
    expect(card).toContain('title={t("sell.condition")}');
    expect(card).toContain('title={t("sell.category")}');
    expect(card).toContain('title={t("sell.size")}');
    expect(card).toContain('<Textarea id="sell-desc"');
  });

  it("Condition, Category and Size draw no second label inside the open row", () => {
    expect(card).toContain('<ChipGroup labelHidden label={t("sell.condition")}');
    expect(card).toContain('<ChipGroup labelHidden label={t("sell.size")}');
    expect(card).toMatch(/<CategoryDrillDown label=\{t\("sell\.category"\)\} groups=\{CATEGORY_GROUPS\} labelHidden /);
  });

  it("a hidden label still names the chips for a screen reader, and is not drawn", () => {
    render(<ChipGroup labelHidden label="Condition" options={[{ value: "5", label: "New" }]} value="5" onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Condition" })).toBeTruthy();
    expect(screen.queryByText("Condition")).toBeNull();
  });

  it("Details: no 'Anything else?' label; the box is named by the row heading and asks in its placeholder", () => {
    expect(card).not.toMatch(/FieldLabel htmlFor="sell-desc"/);
    expect(card).toContain('<Textarea id="sell-desc" aria-labelledby="sell-row-description-title"');
    expect(card).toContain('id={`sell-row-${field}-title`}');
    expect((en as Record<string, string>)["sell.detailsPlaceholder"]).toBe("Anything else buyers should know (optional)");
  });
});
