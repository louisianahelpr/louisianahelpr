/**
 * Owner 2026-10-23 (#3555, "BOTH"): outside the 14 taxed categories, Post a Job
 * asks whether the job fixes an item or cleans carpet, rugs, furniture or
 * clothes (jobs.tax_kind). Shown only there; every answer is a real choice.
 *
 * @mutate src/components/postjob/DetailsSection.tsx |       {setTaxKind && category && !TAXABLE_CATEGORIES.has(category) && ( |       {false && (
 * @mutate src/components/postjob/detailsSection/TaxKindQuestion.tsx |                 setTaxKind(value); |                 setTaxKind(null);
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TaxKindQuestion } from "./TaxKindQuestion";
import { DetailsSection } from "../DetailsSection";

vi.mock("@/lib/haptics", () => ({ hapticLight: () => {} }));

describe("TaxKindQuestion", () => {
  it("offers Neither, fixes an item, and cleans fabric; a tap sets the answer", () => {
    const set = vi.fn();
    render(<TaxKindQuestion taxKind={null} setTaxKind={set} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^Neither/),
      expect.stringMatching(/^It fixes an item/),
      expect.stringMatching(/^It cleans carpet, rugs, furniture or clothes/),
    ]);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    fireEvent.click(radios[2]);
    expect(set).toHaveBeenCalledWith("fabric_cleaning");
    fireEvent.click(radios[1]);
    expect(set).toHaveBeenCalledWith("item_repair");
  });
});

describe("Post a Job asks it only outside the 14 taxed categories", () => {
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

  it("hidden for a taxed category (assembly is taxed anyway)", () => {
    render(<DetailsSection {...props("assembly")} />);
    expect(document.querySelector("[data-tax-kind-question]")).toBeNull();
  });
});
