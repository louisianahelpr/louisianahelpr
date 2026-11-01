/**
 * POST-H15 (lead 10-31): on Post a job's Details step (the "Have a Helpr list it for me" form above all), a [placeholder]
 * left in the description was shown in red from the first second, with Continue greyed out reading "Replace the
 * [placeholders] to continue". Now a neutral hint shows while placeholders remain; Continue can be pressed, and only
 * then does the red "Replace the [bracketed] placeholders" show and the first placeholder get the focus (a
 * Have-a-Helpr-list-it blank's own field, otherwise the first [bracketed] part of the description, selected).
 * Continue still never moves on with one left. Other blockers (no title, no description ...) keep it greyed.
 *
 * The REAL useJobDerived feeds the REAL FormStep (as flexibleScheduleUnlocksSubmit.test.tsx does).
 *
 * @mutate src/pages/post-job/FormStep.tsx |   const pagePressable = pageReady \|\| (placeholdersOnly && !atOpenJobLimit && !underAge); |   const pagePressable = pageReady;
 * @mutate src/pages/post-job/FormStep.tsx |     else if (placeholdersOnly && pagePressable) refusePlaceholders(); |     else if (placeholdersOnly && pagePressable) setPage?.(page + 1);
 * @mutate src/components/postjob/detailsSection/DescriptionField.tsx |   const placeholderError = placeholders && placeholdersRefused; |   const placeholderError = placeholders;
 * @mutate src/pages/post-job/focusFirstPlaceholder.ts |       if (sellForMeBlankValue(description, b) !== "") continue; |       if (sellForMeBlankValue(description, b) === null) continue;
 * @mutate src/pages/post-job/focusFirstPlaceholder.ts |   box.setSelectionRange(m.index, m.index + m[0].length); |   void m;
 * @mutate src/components/postjob/SellForMeBlanks.tsx |             <div key={b.key} className="space-y-1.5" data-blank={b.key}> |             <div key={b.key} className="space-y-1.5">
 * @mutate src/components/postjob/SellForMeBlanks.tsx |         const missing = refused && value === "" ? | const missing = false && value === "" ?
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

vi.mock("@/hooks/useFeature", () => ({
  useFeature: () => false,
  useFeatureStatus: () => ({ on: false, settled: true, lastAnswer: false }),
}));
vi.mock("@/components/postjob/PriceGuidance", () => ({ PriceGuidanceCard: () => null }));
vi.mock("@/hooks/useHelprActivity", () => ({ useHelprActivity: () => ({ activity: null, loading: false }) }));
vi.mock("@/hooks/useMapKitJs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMapKitJs")>()),
  useMapKitJs: () => "missing-token" as const,
}));

import { useJobDerived } from "@/pages/post-job/useJobDerived";
import { FormStep } from "@/pages/post-job/FormStep";
import type { usePostJobForm } from "@/pages/post-job/usePostJobForm";
import { buildSellForMePrefill, fillSellForMeBlank, SELL_FOR_ME_BLANKS } from "@/lib/declutter/sellForMe";

if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};
afterEach(cleanup);

const RED = /Replace the \[bracketed\] placeholders/;

function renderDetails(fields: { category: string; title: string; description: string }) {
  const { result } = renderHook(() => useJobDerived({
    budget: "100", isUrgent: false, urgentFee: "0", onboardingFeePaid: true, onboardingFeeCents: 0,
    streetAddress: "1 Main St", city: "Houma", addrState: "LA", zipCode: "70360", dateNeeded: "", parish: "Terrebonne",
    startTime: "", isFlexibleSchedule: true, ...fields,
  } as Parameters<typeof useJobDerived>[0]));
  const noop = () => {};
  const setFormPage = vi.fn();
  const form = {
    ...fields, ...result.current, startTime: "", isFlexibleSchedule: true,
    budget: "100", streetAddress: "1 Main St", city: "Houma", addrState: "LA", zipCode: "70360", dateNeeded: "",
    setTitle: noop, setDescription: noop, setCategory: noop,
    imagePreviews: [], imageFiles: [], handleImageSelect: noop, removeImage: noop,
    reorderImages: noop, uploadProgressByIndex: {}, credentialTier: null,
    setCredentialTier: noop, requirePhotoProof: false, setRequirePhotoProof: noop,
    scopeVideoPreviewUrl: null, handleVideoSelect: noop, clearVideo: noop,
    setStreetAddress: noop, setCity: noop, setAddrState: noop, setZipCode: noop,
    setDateNeeded: noop, setStartTime: noop, setIsFlexibleSchedule: noop,
    specialRequirements: "", setSpecialRequirements: noop,
    isRecurring: false, setIsRecurring: noop, recurrenceDays: [], setRecurrenceDays: noop,
    recurrenceWeeks: "1", setRecurrenceWeeks: noop,
    isGroupJob: false, setIsGroupJob: noop, helpersNeeded: "1", setHelpersNeeded: noop,
    selectedPetIds: [], togglePet: noop,
    includeMaterials: false, setIncludeMaterials: noop, materialsNote: "", setMaterialsNote: noop,
    setBudget: noop, setIsUrgent: noop, setUrgentFee: noop, customUrgentFee: "", setCustomUrgentFee: noop,
    offerToHelperId: null, offerToHelperName: null, clearOffer: noop, offerResponseHours: 24, setOfferResponseHours: noop,
    openJobCount: 0, formPage: 2, setFormPage,
    handleReview: (e: { preventDefault: () => void }) => e.preventDefault(),
  } as unknown as ReturnType<typeof usePostJobForm>;
  render(<FormStep form={form} />);
  const page2 = document.querySelector<HTMLElement>('[data-form-page="2"]')!;
  const cta = screen.getAllByRole("button").find((b) => /continue/i.test(b.textContent ?? "") && !page2.contains(b))!;
  return { cta, setFormPage };
}

describe("POST-H15: placeholders are a hint until Continue is pressed", () => {
  const prefill = buildSellForMePrefill();

  it("the inventory read something: the Helpr-list-it job starts with its blanks, each a [placeholder]", () => {
    // Two since POST-H3 (owner 10-31) took out the pickups line.
    expect(SELL_FOR_ME_BLANKS.length).toBeGreaterThan(1);
    expect(prefill.description.match(/\[[^\]]+\]/g)?.length).toBeGreaterThan(1);
  });

  it("before Continue: a neutral hint, no red, and Continue can be pressed", () => {
    const { cta } = renderDetails(prefill);
    expect(screen.queryByText(RED)).toBeNull();
    expect(document.querySelector("[data-placeholder-hint]")?.textContent).toMatch(/\[bracketed\]/);
    expect(screen.getByLabelText(/Description/)).not.toHaveAttribute("aria-invalid");
    expect(cta).toBeEnabled();
    expect(cta.textContent).toContain("Continue");
    expect(cta.textContent).not.toContain("Replace");
  });

  it("Continue with a blank left: red, the first unanswered blank gets the focus, and it does not move on", async () => {
    const { cta, setFormPage } = renderDetails(prefill);
    fireEvent.click(cta);
    expect(await screen.findByText(RED)).toBeInTheDocument();
    expect(screen.getByLabelText(/Description/)).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("sell-for-me-count")));
    expect(setFormPage).not.toHaveBeenCalled();
    // Each unanswered blank says so by its own field (the description's red line is below them, off a phone screen).
    expect(screen.getAllByText("Answer this to continue.")).toHaveLength(2); // two blanks since POST-H3
    expect(document.getElementById("sell-for-me-count")).toHaveAttribute("aria-invalid", "true");
  });

  it("the first blank answered: the focus goes to the next one (its first chip)", async () => {
    const answered = { ...prefill, description: fillSellForMeBlank(prefill.description, SELL_FOR_ME_BLANKS[0], "12") };
    const { cta } = renderDetails(answered);
    fireEvent.click(cta);
    await waitFor(() => expect(document.activeElement?.closest("[data-blank]")?.getAttribute("data-blank")).toBe(SELL_FOR_ME_BLANKS[1].key));
  });

  it("any other template: the first [bracketed] part of the description is focused and selected", async () => {
    const description = "Mow the front lawn. Gate code is [gate code], dog is friendly.";
    const { cta } = renderDetails({ category: "yard_work", title: "Mow the lawn", description });
    fireEvent.click(cta);
    expect(await screen.findByText(RED)).toBeInTheDocument();
    const box = document.getElementById("description") as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(description.slice(box.selectionStart, box.selectionEnd)).toBe("[gate code]");
  });

  it("other blockers still grey Continue out and name the field", () => {
    const { cta } = renderDetails({ ...prefill, title: "" });
    expect(cta).toBeDisabled();
    expect(cta.textContent).toContain("Add a title to continue");
  });
});
