/**
 * Owner pop-up 2026-11-06 ~9:40 AM (from the post-a-job video: Yard showed "Is this one of these jobs?"): the
 * sales-tax question shows ONLY in categories where the answer can change the tax (asksTaxKind,
 * src/lib/salesTax.ts): Cleaning and the repair-type categories where a movable item can be fixed. It is hidden for
 * every never-taxed category and for auto and appliance repair (taxed anyway). Hidden = jobs.tax_kind NULL, also after
 * a poster answered in Cleaning and then switched to Yard work.
 *   1. EVERY category in the app's own list (JOB_CATEGORY_VALUES) renders Details and is checked shown vs hidden;
 *   2. the real form hook (usePostJobForm): answer in Cleaning, switch to Yard work -> its taxKind reads null, and the
 *      row it builds (buildJobInsertPayload) carries no tax_kind (NULL) and no sales tax; back in Cleaning the
 *      question starts unanswered;
 *   3. the row builder itself drops an answer a non-asking category cannot have (defence in depth).
 *
 * @mutate src/lib/salesTax.ts |   "cleaning",\n  "handyman", |   "cleaning",\n  "yard_work",\n  "handyman",
 * @mutate src/lib/salesTax.ts |   "carpentry",\n |
 * @mutate src/components/postjob/DetailsSection.tsx |       {setTaxKind && asksTaxKind(category) && ( |       {setTaxKind && category && (
 * @mutate src/pages/post-job/usePostJobForm.ts |     if (!asksTaxKind(category)) setTaxKind(null); |     void 0;
 * @mutate src/pages/post-job/jobSubmitHelpers.ts |   const taxKind = asksTaxKind(category) ? (taxKindAnswer ?? null) : null; |   const taxKind = taxKindAnswer ?? null;
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useFeature", () => ({
  useFeature: () => false,
  useFeatureStatus: () => ({ on: false, settled: true, lastAnswer: false }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: { id: "u1" }, isLoading: false }) }));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ useRecentPostedJobs: () => ({ data: [], isLoading: false }), usePostedBefore: () => false }));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {} }));
// No network: every Supabase read the form makes on mount answers empty (none bears on the tax answer).
vi.mock("@/integrations/supabase/client", () => {
  const done = Promise.resolve({ data: null, error: null });
  const chain: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? done.then.bind(done) : chain),
    apply: () => chain,
  });
  return { supabase: chain };
});

import { JOB_CATEGORY_VALUES } from "@/lib/jobCategories";
import { DetailsSection } from "@/components/postjob/DetailsSection";
import { usePostJobForm } from "@/pages/post-job/usePostJobForm";
import { buildJobInsertPayload } from "@/pages/post-job/jobSubmitHelpers";

// Measured 2026-11-06 against the owner's rule; any change to the set is a tax decision and must change this list.
const ASKED = ["cleaning", "handyman", "carpentry", "welding", "electrical", "other"];

const props = (category: string) => ({
  stepNumber: 1, title: "", setTitle: () => {}, description: "", setDescription: () => {},
  category, setCategory: () => {}, imagePreviews: [], imageFiles: [], onImageSelect: () => {},
  onRemoveImage: () => {}, detailsComplete: false, credentialTier: 0, setCredentialTier: () => {},
  requirePhotoProof: true, setRequirePhotoProof: () => {}, taxKind: null, setTaxKind: () => {},
});

const base = {
  userId: "u1", businessId: null, title: "Rake leaves", description: "Front yard", streetAddress: "1 Main St", city: "Baton Rouge",
  addrState: "LA", zipCode: "70801", parish: "East Baton Rouge", dateNeeded: "2026-11-20", startTime: "09:00",
  isFlexibleSchedule: false, estimatedHours: "2", budget: "100", isRecurring: false, recurrenceInterval: "weekly",
  recurrenceEndDate: "", isGroupJob: false, helpersNeeded: 1, isUrgent: false, urgentFee: "0", salesTaxRate: 10,
} as unknown as Parameters<typeof buildJobInsertPayload>[0];

describe("the sales-tax question shows only where its answer can change the tax (owner 11-06)", () => {
  it("every category in the app's list: shown for the asking ones, hidden for every other", () => {
    const shown: string[] = [];
    for (const c of JOB_CATEGORY_VALUES) {
      const { unmount, container } = render(<DetailsSection {...props(c)} />);
      if (container.querySelector("[data-tax-kind-question]")) shown.push(c);
      unmount();
    }
    // Inventory floor: the whole category list was walked (27 measured 2026-11-06).
    expect(JOB_CATEGORY_VALUES.length).toBeGreaterThan(20);
    expect(shown.sort()).toEqual([...ASKED].sort());
    for (const never of ["yard_work", "moving", "errands", "pet_care", "auto_repair", "appliance_repair"]) expect(shown).not.toContain(never);
  });

  it("answer in Cleaning, switch to Yard work: the form reads null and the row sends tax_kind NULL with no tax", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}><MemoryRouter initialEntries={["/post-job"]}>{children}</MemoryRouter></QueryClientProvider>
    );
    const { result } = renderHook(() => usePostJobForm(), { wrapper });
    act(() => result.current.setCategory("cleaning"));
    act(() => result.current.setTaxKind("fabric_cleaning"));
    expect(result.current.taxKind).toBe("fabric_cleaning");
    act(() => result.current.setCategory("yard_work"));
    expect(result.current.taxKind).toBeNull();
    const row = buildJobInsertPayload({ ...base, category: result.current.category, taxKind: result.current.taxKind }) as Record<string, unknown>;
    expect(row.category).toBe("yard_work");
    expect(row).not.toHaveProperty("tax_kind");
    expect(row.sales_tax_amount ?? 0).toBe(0);
    // The stale answer was cleared, not just hidden: back in Cleaning the question starts unanswered.
    act(() => result.current.setCategory("cleaning"));
    expect(result.current.taxKind).toBeNull();
  });

  it("the row builder drops an answer a non-asking category cannot have, and keeps one that can", () => {
    const yard = buildJobInsertPayload({ ...base, category: "yard_work", taxKind: "item_repair" }) as Record<string, unknown>;
    expect(yard).not.toHaveProperty("tax_kind");
    expect(yard.sales_tax_amount ?? 0).toBe(0);
    const cleaning = buildJobInsertPayload({ ...base, category: "cleaning", taxKind: "fabric_cleaning" }) as Record<string, unknown>;
    expect(cleaning.tax_kind).toBe("fabric_cleaning");
    expect(Number(cleaning.sales_tax_amount)).toBeGreaterThan(0);
  });
});
