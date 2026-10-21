/**
 * Owner bugs, 2026-10-21:
 *  - after a post, "Post another" opened Post a job filled with the job just
 *    posted (it linked ?rebook=<id>). It must start fresh.
 *  - picking a template kept fields from the previous job, even across
 *    categories. A template resets the job first (title, description,
 *    category, photos, price EMPTY, urgent, crew, schedule, offer) and then
 *    applies only its own fields; the poster's address stays.
 *
 * @mutate src/pages/post-job/PaymentSuccess.tsx |     navigate("/post-job");\n  };\n\n  const handleViewApplicants | navigate(`/post-job?rebook=${resolvedJobId}`);\n  };\n\n  const handleViewApplicants
 * @mutate src/pages/post-job/useJobEntry.ts |     resetJobFields();\n    setCategory(sample.category); |     setCategory(sample.category);
 * @mutate src/pages/post-job/useJobEntry.ts |     setIsUrgent(false); setUrgentFee("5"); |     setUrgentFee("5");
 * @mutate src/pages/post-job/useJobEntry.ts |     resetOtherFields?.();\n  }; |   };
 * @mutate src/pages/post-job/useJobMediaUpload.ts |     setImageFiles([]);\n    setImagePreviews([]); |     setImageFiles([]);
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook } from "@testing-library/react";
import { useJobEntry, type UseJobEntryParams } from "@/pages/post-job/useJobEntry";
import { sampleJobs } from "@/data/sampleJobs";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

function harness() {
  // A form already filled from a previous job.
  const state: Record<string, unknown> = {
    title: "Haul a sofa", description: "Old one", category: "moving", streetAddress: "12 Oak St", city: "Lafayette",
    dateNeeded: "2037-01-02", startTime: "09:00", estimatedHours: "3", budget: "120", specialRequirements: "Bring a dolly",
    isRecurring: true, recurrenceInterval: "monthly", recurrenceEndDate: "2037-03-01", isGroupJob: true, helpersNeeded: "3",
    offerToHelperId: "h1", offerToHelperName: "Hal H.", isFlexibleSchedule: true, isUrgent: true, urgentFee: "15",
    credentialTier: 2, includeMaterials: true, materialsNote: "Tarp",
  };
  const set = (k: string) => (v: unknown) => { state[k] = v; };
  const resetOtherFields = vi.fn();
  const params = {
    draft: {} as never, hasDraft: false, setStep: vi.fn(), setDraftConsumed: vi.fn(),
    setTitle: set("title"), setDescription: set("description"), setCategory: set("category"),
    setStreetAddress: set("streetAddress"), setCity: set("city"), setAddrState: set("addrState"), setZipCode: set("zipCode"),
    setDateNeeded: set("dateNeeded"), setStartTime: set("startTime"), setEstimatedHours: set("estimatedHours"), setBudget: set("budget"),
    setSpecialRequirements: set("specialRequirements"), setIsRecurring: set("isRecurring"), setRecurrenceInterval: set("recurrenceInterval"),
    setRecurrenceEndDate: set("recurrenceEndDate"), setIsGroupJob: set("isGroupJob"), setHelpersNeeded: set("helpersNeeded"),
    setOfferToHelperId: set("offerToHelperId"), setOfferToHelperName: set("offerToHelperName"), setIsFlexibleSchedule: set("isFlexibleSchedule"),
    setIsUrgent: set("isUrgent"), setUrgentFee: set("urgentFee"), setCredentialTier: set("credentialTier"),
    setIncludeMaterials: set("includeMaterials"), setMaterialsNote: set("materialsNote"), resetOtherFields,
  } as UseJobEntryParams;
  const { result } = renderHook(() => useJobEntry(params));
  return { state, resetOtherFields, entry: result.current };
}

describe("a template starts a new job", () => {
  it("only the template's fields remain; price empty; address kept", () => {
    const { state, resetOtherFields, entry } = harness();
    const sample = sampleJobs.find((s) => s.category !== "moving")!;
    entry.applyTemplateFields(sample);
    expect(state.title).toBe(sample.title);
    expect(state.description).toBe(sample.description);
    expect(state.category).toBe(sample.category);
    expect(state.budget).toBe("");
    expect(state).toMatchObject({
      dateNeeded: "", startTime: "", specialRequirements: "", isRecurring: false, recurrenceInterval: "weekly", recurrenceEndDate: "",
      isGroupJob: false, helpersNeeded: "2", offerToHelperId: null, offerToHelperName: "", isFlexibleSchedule: false,
      isUrgent: false, urgentFee: "5", credentialTier: 0, includeMaterials: false, materialsNote: "",
    });
    expect(resetOtherFields).toHaveBeenCalledTimes(1); // photos, video, pets, series days
    expect(state.streetAddress).toBe("12 Oak St");
    expect(state.city).toBe("Lafayette");
  });
});

describe("Post another starts fresh", () => {
  it("navigates to a plain /post-job, never ?rebook=", () => {
    const src = readFileSync(resolve(__dirname, "../pages/post-job/PaymentSuccess.tsx"), "utf8");
    const body = src.slice(src.indexOf("const handlePostAnother"), src.indexOf("const handleViewApplicants"));
    expect(body.length).toBeGreaterThan(50);
    expect(body).toContain('navigate("/post-job");');
    expect(body.replace(/\/\/.*$/gm, "")).not.toMatch(/rebook/);
  });

  it("the media hook can clear every photo (the template reset uses it)", () => {
    const src = readFileSync(resolve(__dirname, "../pages/post-job/usePostJobForm.ts"), "utf8");
    expect(src).toMatch(/resetOtherFields: \(\) => \{\s*clearMedia\(\);/);
    const media = readFileSync(resolve(__dirname, "../pages/post-job/useJobMediaUpload.ts"), "utf8");
    const clear = media.slice(media.indexOf("const clearMedia"), media.indexOf("};", media.indexOf("const clearMedia")));
    for (const call of ["setImageFiles([])", "setImagePreviews([])", "clearVideo()"]) expect(clear, call).toContain(call);
  });
});
