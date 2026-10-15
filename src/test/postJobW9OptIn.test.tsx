/**
 * Q1680 (owner 2026-10-14: the W-9 "should be asked if they want to choose it
 * on post"): Post a Job offers "Require a W-9 From the Helpr", off by default,
 * to every account, and the choice reaches jobs.requires_w9. Before this,
 * useJobSubmit passed `requiresW9: false`, so no job could ever ask
 * (measured on prod 2026-10-14: 0 jobs with requires_w9, 0 helper_w9_records).
 *
 * @mutate src/pages/post-job/useJobSubmit.ts |         requiresW9,\n |         requiresW9: false,\n
 * @mutate src/components/postjob/DetailsSection.tsx |       <W9Toggle requiresW9={requiresW9} setRequiresW9={setRequiresW9} /> |
 * @mutate src/pages/post-job/usePostJobForm.ts |   const [requiresW9, setRequiresW9] = useState(false); |   const [requiresW9, setRequiresW9] = useState(true);
 */
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { W9Toggle } from "@/components/postjob/detailsSection/W9Toggle";
import { buildJobInsertPayload, type BuildJobInsertPayloadInput } from "@/pages/post-job/jobSubmitHelpers";
import { blankComments } from "./helpers/blankNonCode";

const base: BuildJobInsertPayloadInput = {
  userId: "u1", businessId: null, title: "Paint a fence", description: "Two coats",
  category: "painting", streetAddress: "1 Main", city: "Houma", addrState: "LA",
  zipCode: "70360", parish: "Terrebonne",
  dateNeeded: "2026-11-07", startTime: "09:00", isFlexibleSchedule: false,
  estimatedHours: "3", budget: "120", materialsNote: null,
  isRecurring: false, recurrenceInterval: "weekly", recurrenceEndDate: "",
  recurrenceDays: [], recurrenceWeeks: 4,
  isGroupJob: false, helpersNeeded: "1", isUrgent: false, urgentFee: "0",
  salesTaxRate: 0, offerToHelperId: null,
};

const code = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("Post a Job asks whether the Helpr must sign a W-9 (Q1680)", () => {
  it("the switch is plain-worded, off by default and reports the choice", () => {
    const set = vi.fn();
    render(<W9Toggle requiresW9={false} setRequiresW9={set} />);
    const sw = screen.getByRole("switch", { name: /Require a W-9 From the Helpr/i });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(set).toHaveBeenCalledWith(true);
  });

  it("an opted-in job writes requires_w9 = true; an untouched one leaves the column default", () => {
    expect((buildJobInsertPayload({ ...base, requiresW9: true }) as Record<string, unknown>).requires_w9).toBe(true);
    expect("requires_w9" in (buildJobInsertPayload({ ...base, requiresW9: false }) as Record<string, unknown>)).toBe(false);
  });

  it("the form owns the choice (default off), shows it to everyone, and the submit sends it", () => {
    const form = code("src/pages/post-job/usePostJobForm.ts");
    expect(form).toContain("const [requiresW9, setRequiresW9] = useState(false);");
    expect(code("src/pages/post-job/FormStep.tsx")).toContain("requiresW9={form.requiresW9}");
    const details = code("src/components/postjob/DetailsSection.tsx");
    // Not inside any condition: every account posts, so no role or category gate.
    expect(details).toMatch(/\n\s*<W9Toggle requiresW9=\{requiresW9\} setRequiresW9=\{setRequiresW9\} \/>/);
    const submit = code("src/pages/post-job/useJobSubmit.ts");
    expect(submit).not.toMatch(/requiresW9:\s*false/);
    expect(submit.match(/\brequiresW9\b/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
