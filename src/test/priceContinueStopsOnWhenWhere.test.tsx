/**
 * A3-106 (audit 11-01): on Post a job, when "When and where" was already filled (the AI path with a day and time and a
 * saved address, a Repost, a template), one tap on Continue on Price skipped When and where and opened Review. The
 * action bar was ONE <Button> whose props changed in place: on Price it was type="button" onClick={goOn}; goOn set
 * page 4, React re-rendered the same DOM button as type="submit" during the click, and the browser's default action
 * then submitted the form. Now each branch is its own button (its own key), so the click ends on the button it began
 * on: Continue on Price shows When and where and submits nothing.
 *
 * The REAL useJobDerived feeds the REAL FormStep, with the page held in real state.
 *
 * @mutate src/pages/post-job/FormStep.tsx |               key="post-job-next" |               key="post-job-submit"
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { flushSync } from "react-dom";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

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

if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};
afterEach(cleanup);

// Every screen complete, the way the AI path, a Repost or a template leaves it: a day, a time, an address.
const FIELDS = {
  category: "yard_work", title: "Mow the front lawn", description: "Mow and edge the front lawn, bag the clippings.",
  budget: "100", isUrgent: false, urgentFee: "0", onboardingFeePaid: true, onboardingFeeCents: 0,
  streetAddress: "1 Main St", city: "Houma", addrState: "LA", zipCode: "70360", dateNeeded: "2026-11-07", parish: "Terrebonne",
  startTime: "09:00", isFlexibleSchedule: false,
};

function renderAtPrice() {
  const { result } = renderHook(() => useJobDerived(FIELDS as Parameters<typeof useJobDerived>[0]));
  const noop = () => {};
  const handleReview = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
  const pages: number[] = [];
  const base = {
    ...FIELDS, ...result.current,
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
    openJobCount: 0, setQuoteReview: noop, handleReview,
  };
  function Harness() {
    const [formPage, setFormPage] = useState(3);
    const form = { ...base, formPage, setFormPage: (p: number) => { pages.push(p); setFormPage(p); } } as unknown as ReturnType<typeof usePostJobForm>;
    return <FormStep form={form} />;
  }
  render(<Harness />);
  return { handleReview, pages };
}

// A real tap is dispatched by the browser, which runs the microtask checkpoint after EACH listener, so React's
// re-render (queued as a microtask by the click handler) lands BEFORE the button's activation behavior (submit or
// not). fireEvent dispatches from script, where that checkpoint waits until dispatchEvent returns, so the bug would
// stay hidden. A window listener (after React's root listener) flushes React's queued work, as the browser does.
function tap(el: HTMLElement) {
  const flush = () => flushSync(() => {});
  window.addEventListener("click", flush);
  try { fireEvent.click(el); } finally { window.removeEventListener("click", flush); }
}

const bar = () => screen.getByTestId("post-job-action-bar");
const barButton = () => bar().querySelector("button")!;
const shown = (n: number) => !(document.querySelector<HTMLElement>(`[data-form-page="${n}"]`)!.hidden);

describe("A3-106: Continue on Price stops on When and where, even when it is already filled", () => {
  it("the harness reads something: Price is showing, with a Continue that can be pressed", () => {
    renderAtPrice();
    expect(shown(3)).toBe(true);
    expect(barButton().textContent).toContain("Continue");
    expect(barButton()).toBeEnabled();
    expect(barButton()).toHaveAttribute("type", "button");
  });

  it("one tap on Continue shows When and where and submits nothing", async () => {
    const { handleReview, pages } = renderAtPrice();
    await act(async () => { tap(barButton()); });
    expect(pages).toEqual([4]);
    expect(shown(4)).toBe(true);
    expect(handleReview).not.toHaveBeenCalled();
    // The poster is now on the last screen, whose button is the submit one.
    expect(barButton()).toHaveAttribute("type", "submit");
  });

  it("the next tap, on When and where, is what opens Review", async () => {
    const { handleReview } = renderAtPrice();
    await act(async () => { tap(barButton()); });
    await act(async () => { tap(barButton()); });
    expect(handleReview).toHaveBeenCalledTimes(1);
  });
});
