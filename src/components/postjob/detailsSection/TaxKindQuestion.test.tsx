/**
 * Q2083 (owner Option 1; since 2026-11-06 only in the asksTaxKind categories, src/test/taxKindOnlyWhereAsked.test.tsx): Post a Job asks
 * whether the job fixes a movable item, cleans carpet, rugs or furniture,
 * washes or cleans clothes, or alters clothes (jobs.tax_kind; La. R.S.
 * 47:301.3 items 5 and 7).
 *
 * @mutate src/components/postjob/DetailsSection.tsx |       {setTaxKind && asksTaxKind(category) && ( |       {false && (
 * @mutate src/components/postjob/detailsSection/TaxKindQuestion.tsx |           setTaxKind(next === NONE ? null : (next as JobTaxKind)); |           setTaxKind(null);
 * @mutate src/components/postjob/detailsSection/TaxKindQuestion.tsx |   { value: "clothes_cleaning", label: "It washes or cleans clothes", sub: "Laundry, ironing, dry cleaning, or washing linens." },\n |
 * @mutate src/components/postjob/detailsSection/TaxKindQuestion.tsx |   const [open, setOpen] = useState(taxKind !== null); |   const [open, setOpen] = useState(true);
 * @mutate src/components/postjob/detailsSection/TaxKindQuestion.tsx | onClick={() => setOpen(true)} data-tax-kind-change=""> | data-tax-kind-change="">
 * @mutate src/components/postjob/DetailsSection.tsx | title={tr(tradeTier ? "postJob.extras.titleTrade" : "postJob.extras.title")} | title={tr("postJob.extras.title")}
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TaxKindQuestion } from "./TaxKindQuestion";
import { DetailsSection } from "../DetailsSection";

vi.mock("@/lib/haptics", () => ({ hapticLight: () => {} }));

describe("TaxKindQuestion", () => {
  it("offers None of these, fixes an item, cleans carpet/rugs/furniture, cleans clothes, alters clothes; a tap sets the answer", () => {
    const set = vi.fn();
    render(<TaxKindQuestion category="other" taxKind={null} setTaxKind={set} />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
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

  // Audit 11-21 (S32): Electrical listed carpet, clothes and alterations; only "It fixes an item" can apply there.
  it("offers only the kinds the category's work can be", () => {
    const names = (category: string) => {
      const { unmount } = render(<TaxKindQuestion category={category} taxKind={null} setTaxKind={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "Change" }));
      const out = screen.getAllByRole("radio").map((r) => r.textContent ?? "");
      unmount();
      return out;
    };
    const electrical = names("electrical");
    expect(electrical).toHaveLength(2);
    expect(electrical[0]).toMatch(/^None of these/);
    expect(electrical[1]).toMatch(/^It fixes an item/);
    const cleaning = names("cleaning");
    expect(cleaning).toHaveLength(3);
    expect(cleaning[1]).toMatch(/^It cleans carpet/);
    expect(cleaning[2]).toMatch(/^It washes or cleans clothes/);
    expect(names("other")).toHaveLength(5);
  });
});

describe("one row until Change (Jobs audit 11-21, G12)", () => {
  it("unanswered: one row saying none of these, no cards; Change shows the five cards", () => {
    render(<TaxKindQuestion category="other" taxKind={null} setTaxKind={() => {}} />);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(document.querySelector("[data-tax-kind-collapsed]")!.textContent).toMatch(/Sales tax: none of these jobs/);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getAllByRole("radio")).toHaveLength(5);
  });

  it("an answer other than None shows the cards with it picked", () => {
    render(<TaxKindQuestion category="other" taxKind="item_repair" setTaxKind={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(5);
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
  });
});

describe("Post a Job asks it where the answer can change the tax", () => {
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

describe("Details reads title, details, the optional fold, then the tax row (Jobs audit 11-21, G12)", () => {
  const props = (category: string) => ({
    stepNumber: 1, title: "", setTitle: () => {}, description: "", setDescription: () => {},
    category, setCategory: () => {}, imagePreviews: [], imageFiles: [], onImageSelect: () => {},
    onRemoveImage: () => {}, detailsComplete: false, credentialTier: 0, setCredentialTier: () => {},
    requirePhotoProof: true, setRequirePhotoProof: () => {}, taxKind: null, setTaxKind: () => {},
  });

  it("the fold comes before the tax row", () => {
    render(<DetailsSection {...props("cleaning")} />);
    const fold = document.querySelector("[data-testid=post-job-extras]");
    const tax = document.querySelector("[data-tax-kind-question]");
    expect(fold).not.toBeNull();
    expect(tax).not.toBeNull();
    expect(fold!.compareDocumentPosition(tax!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("on a trade the fold's title names who can apply; elsewhere it is the photos title", () => {
    render(<DetailsSection {...props("handyman")} />);
    expect(document.querySelector("[data-testid=post-job-extras]")!.textContent).toMatch(/Photos, and who can apply/);
  });

  it("house cleaning keeps the photos title", () => {
    render(<DetailsSection {...props("cleaning")} />);
    expect(document.querySelector("[data-testid=post-job-extras]")!.textContent).toMatch(/Add photos and more/);
  });
});
