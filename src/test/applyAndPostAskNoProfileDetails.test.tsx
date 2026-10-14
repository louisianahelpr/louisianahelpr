/**
 * APPLY AND POST GO STRAIGHT THROUGH: NO PHOTO, PHONE OR BIRTHDAY PROMPT
 * (owner, 2026-10-14, pop-up answer "no later prompt"; "we don't use" the phone).
 *
 * From 2026-10-09 a member's first Apply and first job post opened a "Finish
 * your profile" / "Add a profile photo?" prompt (src/components/PhotoPrompt.tsx)
 * asking for a photo, a phone number and a birthday, with "Not Now". The owner
 * removed it: the Apply and Post flows ask for none of these. Sign-up step 1's
 * "I'm 18 or older" box stays the age check; a birthday a member saves on their
 * own (Complete Profile, Profile) still drives the under-18 grey-out
 * (useAgeGate, Q1586(c)), which is not a prompt and is untouched.
 *
 * Two halves:
 *  1. Behaviour. A signed-in member with NO photo, NO phone and NO birthday
 *     taps Apply Now / Continue to Payment: the action runs at once, and no
 *     prompt, phone field or birthday field appears.
 *  2. The class. Every source file the Apply flow (ApplyConfirmDialog) and the
 *     Post flow (PostJob) can reach by import, inventoried from the source, is
 *     read; none may import the old prompt, render a phone input, render a
 *     birthday field, or write `phone` / `date_of_birth` to a row.
 *
 * Red on the old code (PhotoPrompt still wired into ApplyBody and
 * CheckoutStepView), green after.
 *
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyBody.tsx | setSaveAsTemplate(false);\n    handleApplyConfirm(); | setSaveAsTemplate(false);
 * @mutate src/pages/post-job/CheckoutStepView.tsx | onSubmit={form.handleSubmit} | onSubmit={() => undefined}
 * @mutate src/pages/post-job/CheckoutStepView.tsx | <div key="checkout-step" className="space-y-section"> | <div key="checkout-step" className="space-y-section"><input type="tel" aria-label="Phone number" />
 * @mutate src/components/dashboard/applyConfirmDialog/ApplyBody.tsx | <ViolationDialog violations={pendingViolations} | <label htmlFor="dob">Birthday</label><ViolationDialog violations={pendingViolations}
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, act } from "@testing-library/react";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useAwardBlockReason", () => ({ useAwardBlockReason: () => null }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => 0 }));
vi.mock("@/hooks/useStripeSalesTax", () => ({
  useStripeSalesTax: () => ({ salesTax: 0, loading: false, jurisdiction: null }),
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { ApplyConfirmDialog } from "@/components/dashboard/ApplyConfirmDialog";
import { CheckoutStepView } from "@/pages/post-job/CheckoutStepView";
import type { usePostJobForm } from "@/pages/post-job/usePostJobForm";
import type { EnrichedJob } from "@/components/dashboard/types";
import { queryClient } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";

/** A member with nothing the old prompt asked for: no photo, no phone, no birthday. */
function cacheBareProfile() {
  queryClient.setQueryData(queryKeys.currentUser.byId("u1"), {
    profile: { avatar_url: null, phone: null, date_of_birth: null },
  });
}

/** Anything the old prompt rendered, or any phone / birthday ask at all. */
function expectNoProfilePrompt() {
  expect(screen.queryByText(/Finish your profile|Add a profile photo\?/)).toBeNull();
  expect(screen.queryByText("Not Now")).toBeNull();
  expect(screen.queryByLabelText(/phone/i)).toBeNull();
  expect(screen.queryByLabelText(/birthday|date of birth/i)).toBeNull();
  expect(document.querySelector('input[type="tel"]')).toBeNull();
}

function applyProps() {
  return {
    open: true,
    onClose: vi.fn(),
    confirmApplyJob: { id: "job-1", title: "Fix the fence", budget: 100, is_group_job: false, helpers_needed: 1, urgent_fee: 0 } as unknown as EnrichedJob,
    platformFee: 10,
    applyMessage: "",
    setApplyMessage: vi.fn(),
    applyFiles: [] as File[],
    setApplyFiles: vi.fn(),
    applyLoading: false,
    handleApplyConfirm: vi.fn(),
  };
}

function postForm(): ReturnType<typeof usePostJobForm> {
  return {
    setStep: vi.fn(),
    title: "Clean my room",
    description: "Help clean my room, about two hours of work.",
    categoryLabel: "Cleaning",
    category: "cleaning",
    imagePreviews: [],
    streetAddress: "314 Lynn St",
    city: "Delcambre",
    addrState: "LA",
    zipCode: "70528",
    dateNeeded: "2026-11-03",
    startTime: "09:00",
    estimatedHours: "",
    isFlexibleSchedule: false,
    specialRequirements: "",
    isRecurring: false,
    recurrenceInterval: "",
    recurrenceEndDate: "",
    recurrenceDays: [],
    recurrenceWeeks: 0,
    isUrgent: false,
    urgentFeeNum: 0,
    budgetNum: 30,
    helprActivity: null,
    customerFeeAmount: 2,
    onboardingFeeAmount: 0,
    totalCharge: 32,
    hasGift: false,
    giftAppliedAmount: 0,
    giftCreditAmount: 0,
    giftLoading: false,
    giftUnavailable: false,
    confirmed: true,
    setConfirmed: vi.fn(),
    saveCardForFuture: false,
    setSaveCardForFuture: vi.fn(),
    saving: false,
    redirecting: false,
    uploading: false,
    uploadProgress: null,
    handleSubmit: vi.fn(),
    parish: "Vermilion",
  } as unknown as ReturnType<typeof usePostJobForm>;
}

beforeEach(() => {
  queryClient.removeQueries({ queryKey: queryKeys.currentUser.all });
  try {
    window.localStorage.clear();
  } catch {
    // jsdom always has localStorage; a blocked one only means nothing was remembered.
  }
});

describe("Apply and Post ask for no photo, phone or birthday (owner, 2026-10-14)", () => {
  it("Apply Now applies at once for a member with no photo, phone or birthday", async () => {
    cacheBareProfile();
    const props = applyProps();
    render(<ApplyConfirmDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply Now" }));
    await act(async () => {});
    expect(props.handleApplyConfirm).toHaveBeenCalledTimes(1);
    expectNoProfilePrompt();
  });

  it("Continue to Payment posts at once for a member with no photo, phone or birthday", async () => {
    cacheBareProfile();
    const form = postForm();
    render(<CheckoutStepView form={form} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue to Payment" }));
    await act(async () => {});
    expect(form.handleSubmit).toHaveBeenCalledTimes(1);
    expectNoProfilePrompt();
  });
});

// ── The class: every file the Apply and Post flows can reach ────────────────

const ROOT = process.cwd();
const ENTRIES = ["src/components/dashboard/ApplyConfirmDialog.tsx", "src/pages/post-job/PostJob.tsx"];
const EXTS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.join(path.dirname(fromFile), spec);
  else return null; // a package
  for (const ext of EXTS) {
    const candidate = base + ext;
    const abs = path.join(ROOT, candidate);
    if (/\.(ts|tsx)$/.test(candidate) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return candidate;
  }
  return null;
}

/** Every src file reachable by static or dynamic import from the entries. */
function reachable(entries: string[]): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file) || /\.test\.tsx?$/.test(file)) continue;
    const code = blankComments(fs.readFileSync(path.join(ROOT, file), "utf8"));
    seen.set(file, code);
    const specs = [
      ...code.matchAll(/\bfrom\s+["']([^"']+)["']/g),
      ...code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
      ...code.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ].map((m) => m[1]);
    for (const spec of specs) {
      const next = resolveImport(file, spec);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

/** What asking for a phone or a birthday (or the old prompt) looks like in source. */
const ASKS: Array<[string, RegExp]> = [
  ["imports the old PhotoPrompt", /["'][^"']*\/PhotoPrompt["']/],
  ["renders a phone input", /type=["']tel["']|inputMode=["']tel["']|autoComplete=["']tel/],
  ["renders a birthday field", /htmlFor=["'][^"']*(dob|birth)[^"']*["']|id=["'][^"']*(dob|birth)[^"']*["']|>\s*(Birthday|Date of birth)\s*</i],
  ["writes phone or date_of_birth to a row", /\.(update|upsert|insert)\(\s*\{[^}]*\b(phone|date_of_birth)\b/],
];

describe("the Apply and Post flows, inventoried from source, ask for no phone or birthday", () => {
  const files = reachable(ENTRIES);

  it("reads the whole flow, not a fragment of it", () => {
    // Floor: both entries reached 216 files on 2026-10-14 (a node walk of the same imports).
    expect(files.size).toBeGreaterThan(150);
    for (const f of [
      "src/components/dashboard/applyConfirmDialog/ApplyBody.tsx",
      "src/pages/post-job/CheckoutStepView.tsx",
      "src/components/postjob/CheckoutStep.tsx",
      "src/pages/post-job/FormStep.tsx",
    ]) expect(files.has(f), f).toBe(true);
  });

  it("no reachable file asks for a phone, a birthday, or opens the old prompt", () => {
    const hits: string[] = [];
    for (const [file, code] of files) {
      for (const [what, re] of ASKS) if (re.test(code)) hits.push(`${file}: ${what}`);
    }
    expect(hits).toEqual([]);
  });
});
