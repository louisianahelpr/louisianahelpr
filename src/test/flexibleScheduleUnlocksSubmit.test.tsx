import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderHook, screen, cleanup } from "@testing-library/react";

import { useJobDerived } from "@/pages/postjob/useJobDerived";
import { FormStep } from "@/pages/postjob/FormStep";
import { buildJobInsertPayload } from "@/pages/postjob/jobSubmitHelpers";
import type { usePostJobForm } from "@/pages/postjob/usePostJobForm";

/**
 * "THEY ALSO NEED TIMES UNLESS THEY WERE CHECKED OFF AS FLEXIBLE" (owner,
 * 2026-09-19).
 *
 * THE BUG THIS EXISTS TO STOP COMING BACK. The Post-a-Task form carried a
 * "Flexible Schedule" checkbox and a submit handler that treated it as a
 * SUBSTITUTE for a start time ("Start time is required (or mark the schedule
 * as flexible)"), while `useJobDerived`'s `logisticsComplete` required
 * `startTime` UNCONDITIONALLY. `logisticsComplete` drives `submitDisabled`, so
 * the stricter of the two always won: ticking Flexible and leaving the time
 * empty left the CTA DISABLED, reading "Pick a Start Time to Continue". The
 * submit branch that mentions flexible was unreachable from the UI, and the
 * result was visible in prod — 0 of 260 jobs carried the flag.
 *
 * WHY THIS IS NOT A UNIT TEST ON `logisticsComplete`. That boolean going true
 * proves nothing a poster can see. The failure was an interaction between three
 * files, so the assertion is the chain a poster actually walks:
 *
 *     useJobDerived (the real hook, real inputs)
 *       -> FormStep (the real component, really rendered)
 *         -> the submit button's disabled state and its contextual label
 *           -> buildJobInsertPayload (the real row that reaches Postgres)
 *
 * A guard that stopped at the first arrow would have been GREEN throughout the
 * entire life of the bug.
 *
 * THE INVENTORY IS DERIVED FROM THE WORLD. The set of "…to Continue" labels the
 * CTA can wear is read out of FormStep.tsx itself rather than restated here, so
 * a newly-added blocking gate is covered the day it lands instead of the day
 * someone remembers this file. It is asserted non-empty (see FLOOR below):
 * CLAUDE.md's "inventory from source, minus what was checked, must be empty" is
 * worth nothing if the inventory can quietly become `[]`.
 */

const REPO = process.cwd();
const FORM_STEP_SRC = readFileSync(join(REPO, "src/pages/postjob/FormStep.tsx"), "utf8");

/**
 * Every contextual label FormStep can put on the submit button, read out of its
 * source. "Review & Pay" is the ready state; everything else is a refusal that
 * names a field the poster still has to fill.
 */
const ALL_CTA_LABELS = [...FORM_STEP_SRC.matchAll(/submitLabel = "([^"]+)"/g)].map((m) => m[1]);
const BLOCKING_CTA_LABELS = ALL_CTA_LABELS.filter((l) => l !== "Review & Pay");

/**
 * FLOOR — the inventory must not be empty, and must not silently collapse to
 * one or two entries because the regex above stopped matching after a refactor.
 * Eight labels exist today (one ready + seven refusals); the floor is set below
 * that so legitimate removals do not fail, but a broken scan does.
 */
const CTA_LABEL_FLOOR = 6;

/** Tomorrow, so `isScheduleInThePast` can never be what blocks the form. */
function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A fully-filled form except for the one axis under test: the start time. */
const FILLED = {
  budget: "100",
  isUrgent: false,
  urgentFee: "0",
  customerFee: 12,
  onboardingFeePaid: true,
  onboardingFeeCents: 0,
  category: "yard_work",
  title: "Mow the lawn",
  description: "Front and back, bag the clippings.",
  streetAddress: "123 Main St",
  city: "Baton Rouge",
  addrState: "LA",
  zipCode: "70801",
  dateNeeded: tomorrowISO(),
  parish: "East Baton Rouge",
};

/**
 * Runs the REAL derived-state hook, then renders the REAL FormStep on top of
 * its output. Only the setters and the handful of values FormStep reads that
 * `useJobDerived` does not produce are stubbed — every gate decision in the
 * chain is live code.
 */
function renderFormWith({
  startTime,
  isFlexibleSchedule,
  forceLogisticsIncomplete = false,
}: {
  startTime: string;
  isFlexibleSchedule: boolean;
  /** Reaches FormStep's label ladder directly — see the test that uses it. */
  forceLogisticsIncomplete?: boolean;
}) {
  const { result } = renderHook(() => useJobDerived({ ...FILLED, startTime, isFlexibleSchedule }));
  const derived = forceLogisticsIncomplete
    ? { ...result.current, logisticsComplete: false }
    : result.current;

  const noop = () => {};
  const form = {
    ...FILLED,
    ...derived,
    startTime,
    isFlexibleSchedule,
    // Everything below is inert view state FormStep passes straight through.
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
    setBudget: noop, setIsUrgent: noop, setUrgentFee: noop,
    customUrgentFee: "", setCustomUrgentFee: noop,
    offerToHelperId: null, offerToHelperName: null, clearOffer: noop,
    offerResponseHours: 24, setOfferResponseHours: noop,
    openJobCount: 0,
    handleReview: (e: { preventDefault: () => void }) => e.preventDefault(),
  } as unknown as ReturnType<typeof usePostJobForm>;

  render(<FormStep form={form} />);
  const cta = screen.getByRole("button", { name: /Continue|Review & Pay|Has Passed/i });
  return { cta, derived };
}

// TimePickerWheel scrolls its own column to the selected value on mount.
// jsdom implements no scrolling at all, so the effect throws and takes the
// whole render down — nothing to do with the behaviour under test.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}

afterEach(cleanup);

describe("Flexible Schedule is a SUBSTITUTE for a start time, end to end", () => {
  it("has a non-empty inventory of CTA gate labels read from FormStep", () => {
    expect(ALL_CTA_LABELS.length).toBeGreaterThanOrEqual(CTA_LABEL_FLOOR);
    expect(BLOCKING_CTA_LABELS.length).toBeGreaterThan(0);
    expect(ALL_CTA_LABELS).toContain("Review & Pay");
  });

  it("ENABLES the submit CTA with Flexible ticked and no start time", () => {
    const { cta, derived } = renderFormWith({ startTime: "", isFlexibleSchedule: true });

    expect(derived.logisticsComplete).toBe(true);
    expect(cta).toBeEnabled();
    expect(cta.getAttribute("aria-disabled")).toBe("false");
    // Not merely enabled — it must no longer be asking for the time it no
    // longer needs, nor for anything else. The label is checked against the
    // whole world-derived inventory, so a future gate cannot sneak in here.
    for (const label of BLOCKING_CTA_LABELS) {
      expect(cta.textContent).not.toContain(label);
    }
    expect(cta.textContent).toContain("Review & Pay");
  });

  /**
   * DEFENCE IN DEPTH, AND WHY IT NEEDS ITS OWN TEST.
   *
   * `npm run vacuity` proved the FormStep half of this fix cannot fail through
   * the route above: once `useJobDerived` accepts the flag, `logisticsComplete`
   * is true, so the entire `else if (!form.logisticsComplete)` label ladder is
   * skipped and the start-time branch is never evaluated. Reverting the
   * FormStep edit left every assertion above GREEN.
   *
   * The edit is kept anyway, because a label ladder that independently demands
   * a start time is HOW THIS BUG HAPPENED: two files holding different
   * definitions of "flexible", with the stricter one winning silently. So the
   * ladder is asserted on its own terms — given a form that is incomplete for
   * some other reason, FormStep must still not name a field the poster has
   * opted out of. `logisticsComplete` is forced false here deliberately; that
   * combination is unreachable from `useJobDerived` TODAY, and this is the
   * guard that says so if it ever stops being.
   */
  it("never names the start time in the CTA label while Flexible is ticked", () => {
    const { cta } = renderFormWith({
      startTime: "",
      isFlexibleSchedule: true,
      forceLogisticsIncomplete: true,
    });
    expect(cta).toBeDisabled();
    expect(cta.textContent).not.toContain("Pick a Start Time to Continue");
  });

  it("still BLOCKS the CTA with no start time and Flexible unticked", () => {
    const { cta, derived } = renderFormWith({ startTime: "", isFlexibleSchedule: false });

    expect(derived.logisticsComplete).toBe(false);
    expect(cta).toBeDisabled();
    expect(cta.textContent).toContain("Pick a Start Time to Continue");
  });

  it("still ENABLES the CTA the ordinary way — a real start time, no flag", () => {
    const { cta } = renderFormWith({ startTime: "09:00", isFlexibleSchedule: false });
    expect(cta).toBeEnabled();
    expect(cta.textContent).toContain("Review & Pay");
  });

  it("drops the required * from the Start Time label while Flexible is ticked", () => {
    renderFormWith({ startTime: "", isFlexibleSchedule: true });
    expect(screen.getByText("Start Time").textContent).toBe("Start Time");

    cleanup();
    renderFormWith({ startTime: "", isFlexibleSchedule: false });
    expect(screen.getByText(/^Start Time/).textContent).toContain("*");
  });

  it("writes is_flexible_schedule = true and start_time = null for that job", () => {
    const row = buildJobInsertPayload({
      userId: "u1",
      businessId: null,
      title: FILLED.title,
      description: FILLED.description,
      category: FILLED.category,
      streetAddress: FILLED.streetAddress,
      city: FILLED.city,
      addrState: FILLED.addrState,
      zipCode: FILLED.zipCode,
      parish: FILLED.parish,
      dateNeeded: FILLED.dateNeeded,
      startTime: "",
      isFlexibleSchedule: true,
      estimatedHours: "2",
      budget: FILLED.budget,
      specialRequirements: "",
      isRecurring: false,
      recurrenceInterval: "",
      recurrenceEndDate: "",
      isGroupJob: false,
      helpersNeeded: "1",
      isUrgent: false,
      urgentFee: "0",
      platformFee: 12,
      salesTaxRate: 0,
      offerToHelperId: null,
    }) as Record<string, unknown>;

    expect(row.start_time).toBeNull();
    expect(row.is_flexible_schedule).toBe(true);
  });
});

// The three edits that make Flexible a substitute, each proven load-bearing.
// @mutate src/pages/postjob/useJobDerived.ts | (startTime \|\| isFlexibleSchedule) | startTime
// @mutate src/pages/postjob/FormStep.tsx | !form.startTime && !form.isFlexibleSchedule | !form.startTime
// @mutate src/components/postjob/LogisticsSection.tsx | {!isFlexibleSchedule && <span | {true && <span
