import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { JobDetailFooter } from "./JobDetailFooter";
import type { EnrichedJob } from "../types";
import { queryClient } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";
import { UNDER_18_APPLY_COPY } from "@/lib/ageGate";

// @mutate src/components/dashboard/jobDetailDialog/JobDetailFooter.tsx |           onClick={gate("apply", () => onApply(job.id))} |           onClick={() => onApply(job.id)}

// Q1586(c) (owner, 2026-10-12: "Grey out the button until the age is 18 or
// over"): the job sheet's Apply Now, rendered for a member whose saved birthday
// makes them under 18, is greyed out (aria-disabled + data-age-gated, which
// index.css paints at the shared disabled opacity) and a tap says why instead
// of opening the apply step. An adult and a member with no birthday saved are
// unchanged. RED before useAgeGate: the button was plain and the tap applied.
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn(), dismiss: vi.fn(), loading: vi.fn() } }));

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const yearsAgo = (n: number, dayShift = 0) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  d.setDate(d.getDate() + dayShift);
  return ymd(d);
};

function setBirthday(dob: string | null) {
  queryClient.setQueryData(queryKeys.currentUser.byId("member-1"), { profile: { date_of_birth: dob }, isAdmin: false });
}

function renderFooter(onApply = vi.fn()) {
  render(
    <JobDetailFooter
      job={{ id: "job-1", title: "Fix the fence", budget: 100, customer_id: "poster", helper_id: null, offered_to_helper_id: null, credential_tier: 0 } as unknown as EnrichedJob}
      guest={false}
      onApply={onApply}
      navigate={vi.fn()}
      viewerUserId="member-1"
      viewerAppPosition={null}
      viewerTier={0}
      onAskQuestion={vi.fn()}
    />,
  );
  return { onApply, button: screen.getByRole("button", { name: /Apply Now/ }) };
}

describe("JobDetailFooter Apply Now under 18 (Q1586(c))", () => {
  beforeEach(() => toastError.mockReset());
  afterEach(() => {
    cleanup();
    queryClient.removeQueries({ queryKey: queryKeys.currentUser.byId("member-1") });
  });

  it("is greyed out for a 16-year-old, and a tap says why instead of applying", () => {
    setBirthday(yearsAgo(16));
    const { onApply, button } = renderFooter();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("data-age-gated")).toBe("apply");
    fireEvent.click(button);
    expect(onApply).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(UNDER_18_APPLY_COPY, expect.anything());
  });

  it("is still greyed out the day before the 18th birthday", () => {
    setBirthday(yearsAgo(18, 1));
    const { onApply, button } = renderFooter();
    fireEvent.click(button);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("opens on the 18th birthday", () => {
    setBirthday(yearsAgo(18));
    const { onApply, button } = renderFooter();
    expect(button.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(button);
    expect(onApply).toHaveBeenCalledWith("job-1");
  });

  it("is unchanged with no birthday saved yet (it is asked before the first Apply)", () => {
    setBirthday(null);
    const { onApply, button } = renderFooter();
    expect(button.getAttribute("data-age-gated")).toBeNull();
    fireEvent.click(button);
    expect(onApply).toHaveBeenCalledWith("job-1");
    expect(toastError).not.toHaveBeenCalled();
  });
});
