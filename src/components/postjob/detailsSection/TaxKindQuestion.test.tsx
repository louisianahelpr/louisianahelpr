/**
 * Q2083 (owner Option 1): outside auto and appliance repair, Post a Job asks
 * whether the job fixes a movable item, cleans carpet, rugs or furniture,
 * washes or cleans clothes, or alters clothes (jobs.tax_kind; La. R.S.
 * 47:301.3 items 5 and 7).
 *
 * @mutate src/components/postjob/DetailsSection.tsx |       {setTaxKind && category && !TAXABLE_CATEGORIES.has(category) && ( |       {false && (
 * @mutate src/components/postjob/detailsSection/TaxKindQuestion.tsx |           setTaxKind(next === NONE ? null : (next as JobTaxKind)); |           setTaxKind(null);
 * @mutate src/components/postjob/detailsSection/TaxKindQuestion.tsx |   { value: "clothes_cleaning", label: "It washes or cleans clothes", sub: "Laundry, ironing, dry cleaning, or washing linens." },\n |
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TaxKindQuestion } from "./TaxKindQuestion";
import { DetailsSection } from "../DetailsSection";

vi.mock("@/lib/haptics", () => ({ hapticLight: () => {} }));

describe("TaxKindQuestion", () => {
  it("offers None of these, fixes an item, cleans carpet/rugs/furniture, cleans clothes, alters clothes; a tap sets the answer", () => {
    const set = vi.fn();
    render(<TaxKindQuestion taxKind={null} setTaxKind={set} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^None of these/),
      expect.stringMatching(/^It fixes an item/),
      expect.stringMatching(/^It cleans carpet, rugs or furniture/),
      expect.stringMatching(/^It washes or cleans clothes/),
      expect.stringMatching(/^It alters clothes/),
    ]);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    fireEvent.click(radios[2]);
    expect(set).toHaveBeenCalledWith("fabric_cleaning");
    fireEvent.click(radios[1]);
    expect(set).toHaveBeenCalledWith("item_repair");
    fireEvent.click(radios[3]);
    expect(set).toHaveBeenCalledWith("clothes_cleaning");
    fireEvent.click(radios[4]);
    expect(set).toHaveBeenCalledWith("clothing_alterations");
  });
});

describe("Post a Job asks it outside the movable-repair categories", () => {
  const props = (category: string) => ({
    stepNumber: 1, title: "", setTitle: () => {}, description: "", setDescription: () => {},
    category, setCategory: () => {}, imagePreviews: [], imageFiles: [], onImageSelect: () => {},
    onRemoveImage: () => {}, detailsComplete: false, credentialTier: 0, setCredentialTier: () => {},
    requirePhotoProof: true, setRequirePhotoProof: () => {}, taxKind: null, setTaxKind: () => {},
  });

  it("shown for cleaning (a sofa or a house: the poster says which)", () => {
    render(<DetailsSection {...props("cleaning")} />);
    expect(document.querySelector("[data-tax-kind-question]")).not.toBeNull();
  });

  it("shown for handyman (a wall is untaxed, a chair is taxed: the poster says which)", () => {
    render(<DetailsSection {...props("handyman")} />);
    expect(document.querySelector("[data-tax-kind-question]")).not.toBeNull();
  });

  it("hidden for a taxed category (auto repair is taxed anyway)", () => {
    render(<DetailsSection {...props("auto_repair")} />);
    expect(document.querySelector("[data-tax-kind-question]")).toBeNull();
  });
});
