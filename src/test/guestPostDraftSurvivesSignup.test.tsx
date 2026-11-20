/**
 * Owner 2026-11-20 (ease batch, item 1): a guest can START a job post before signing up. The draft stays on the device
 * through sign-up and email verification, and the verified sign-up comes back to it.
 *
 * The chain a guest walks, each link real code:
 *   FormStep's last step, signed out -> "Sign up to post" -> form.finishAsGuest (usePostJobForm: writes the draft now,
 *   then /signup?redirect=/post-job?resume=draft&reason=post) -> Signup keeps the redirect (rememberSignupRedirect) and
 *   says the post is kept -> after verification postAuthDestination spends it -> /post-job?resume=draft loads the
 *   draft once and opens Budget.
 *
 * @mutate src/pages/post-job/FormStep.tsx | if (form.isGuest) {\n            e.preventDefault(); | if (false) {\n            e.preventDefault();
 * @mutate src/lib/guestPostDraft.ts | export const GUEST_POST_RESUME_PATH = "/post-job?resume=draft"; | export const GUEST_POST_RESUME_PATH = "/post-job";
 * @mutate src/pages/post-job/usePostJobForm.ts |     setFormPage(loadDraftAndContinue() ? 4 : 1); |     setFormPage(1);
 * @mutate src/App.tsx | <ProtectedRoute fullProfile allowGuest><PostJob /></ProtectedRoute> | <ProtectedRoute fullProfile><PostJob /></ProtectedRoute>
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

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

import { FormStep } from "@/pages/post-job/FormStep";
import { useJobDerived } from "@/pages/post-job/useJobDerived";
import type { usePostJobForm } from "@/pages/post-job/usePostJobForm";
import { GUEST_POST_RESUME_PATH, guestPostSignupUrl, wantsDraftResume } from "@/lib/guestPostDraft";
import { postAuthDestination, rememberSignupRedirect, signupSubtitle } from "@/lib/jobIntent";
import { safeStorage } from "@/lib/safeStorage";
import { enCore } from "@/lib/i18n/enCore";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const FILLED = {
  budget: "60", isUrgent: false, urgentFee: "0", onboardingFeePaid: true, onboardingFeeCents: 0,
  category: "yard_work", title: "Mow the lawn", description: "Front and back.",
  streetAddress: "123 Main St", city: "Lafayette", addrState: "LA", zipCode: "70501",
  dateNeeded: tomorrowISO(), startTime: "09:00", isFlexibleSchedule: false, parish: "Lafayette",
};

function renderLastStep(isGuest: boolean, finishAsGuest = vi.fn(), handleReview = vi.fn((e: { preventDefault: () => void }) => e.preventDefault())) {
  const { result } = renderHook(() => useJobDerived(FILLED));
  const noop = () => {};
  const form = {
    ...FILLED, ...result.current,
    setTitle: noop, setDescription: noop, setCategory: noop, imagePreviews: [], imageFiles: [], handleImageSelect: noop,
    removeImage: noop, reorderImages: noop, uploadProgressByIndex: {}, credentialTier: 0, setCredentialTier: noop,
    requirePhotoProof: false, setRequirePhotoProof: noop, scopeVideoPreviewUrl: null, handleVideoSelect: noop, clearVideo: noop,
    setStreetAddress: noop, setCity: noop, setAddrState: noop, setZipCode: noop, setDateNeeded: noop, setStartTime: noop,
    setIsFlexibleSchedule: noop, specialRequirements: "", setSpecialRequirements: noop, isRecurring: false, setIsRecurring: noop,
    recurrenceDays: [], setRecurrenceDays: noop, recurrenceWeeks: "1", setRecurrenceWeeks: noop, isGroupJob: false,
    setIsGroupJob: noop, helpersNeeded: "1", setHelpersNeeded: noop, selectedPetIds: [], togglePet: noop,
    includeMaterials: false, setIncludeMaterials: noop, materialsNote: "", setMaterialsNote: noop, setBudget: noop,
    setIsUrgent: noop, setUrgentFee: noop, customUrgentFee: "", setCustomUrgentFee: noop, offerToHelperId: null,
    offerToHelperName: null, clearOffer: noop, offerResponseHours: 24, setOfferResponseHours: noop, openJobCount: 0,
    formPage: 4, setFormPage: noop, setQuoteReview: noop, handleReview, isGuest, finishAsGuest,
  } as unknown as ReturnType<typeof usePostJobForm>;
  render(<FormStep form={form} />);
  return { finishAsGuest, handleReview };
}

beforeEach(() => safeStorage.removeItem("helpr.signupRedirect"));
afterEach(cleanup);

describe("a guest's job post survives sign-up and email verification (owner 11-20)", () => {
  it("signed out, the last step's button is 'Sign up to post' and keeps the draft instead of paying", () => {
    const { finishAsGuest, handleReview } = renderLastStep(true);
    const cta = screen.getByRole("button", { name: /Sign up to post/ });
    expect(cta).toBeEnabled();
    fireEvent.click(cta);
    expect(finishAsGuest).toHaveBeenCalledTimes(1);
    expect(handleReview).not.toHaveBeenCalled();
  });

  it("control: signed in, the same step reviews and pays as before", () => {
    const { finishAsGuest, handleReview } = renderLastStep(false);
    fireEvent.click(screen.getByRole("button", { name: /Review, then pay/ }));
    expect(handleReview).toHaveBeenCalledTimes(1);
    expect(finishAsGuest).not.toHaveBeenCalled();
  });

  it("sign-up carries the way back, says the post is kept, and the verified sign-up returns to the draft", () => {
    const url = new URL(guestPostSignupUrl(), "https://x.invalid");
    expect(url.pathname).toBe("/signup");
    expect(url.searchParams.get("redirect")).toBe(GUEST_POST_RESUME_PATH);
    expect(signupSubtitle(url.searchParams.get("reason"), url.searchParams.get("redirect"))).toBe(enCore["signup.postSubtitle"]);
    // Signup stores the redirect (useSignupEntry); SignupPending spends it once the email is verified.
    rememberSignupRedirect(url.searchParams.get("redirect"));
    const back = postAuthDestination("/home");
    expect(back).toBe("/post-job?resume=draft");
    expect(wantsDraftResume(new URL(back, "https://x.invalid").searchParams)).toBe(true);
    // Spent: an unrelated later sign-in goes home.
    expect(postAuthDestination("/home")).toBe("/home");
  });

  it("the draft lives in the tracked device key (survives a reload and an app restart) and is written before leaving", () => {
    expect(read("src/hooks/useDraftJob.ts")).toContain('const DRAFT_KEY = "helpr_draft_job";');
    expect(read("src/lib/safeStorage.ts")).toContain('"helpr_draft_job",');
    const form = read("src/pages/post-job/usePostJobForm.ts");
    expect(form).toMatch(/const finishAsGuest = useCallback\(\(\) => \{\s*saveDraftNow\(\);[\s\S]*?navigate\(guestPostSignupUrl\(\)\);/);
    // Back signed in: the draft loads once and opens Budget (page 4), the last step.
    expect(form).toMatch(/if \(resumeDone\.current \|\| !user \|\| !draftLoaded \|\| !wantsDraftResume\(searchParams\)\) return;/);
    expect(form).toContain("setFormPage(loadDraftAndContinue() ? 4 : 1);");
    expect(read("src/pages/post-job/useJobFormEffects.ts")).toMatch(/const saveDraftNow = useCallback\(\(\) => \{ autoSave\(\); flushDraft\(\); \}/);
  });

  it("guests can open Post a job: the route lets them in and the account-only ways to start are hidden", () => {
    expect(read("src/App.tsx")).toContain("<ProtectedRoute fullProfile allowGuest><PostJob /></ProtectedRoute>");
    const entry = read("src/pages/post-job/EntryChoice.tsx");
    expect(entry).toContain('!form.isGuest && entryLink("offer"');
    expect(entry).toContain('!form.isGuest && entryLink("ai"');
  });
});
