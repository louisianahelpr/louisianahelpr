/**
 * A GUEST SEES A JOB'S TITLE, CATEGORY, PARISH AND TAKE-HOME, THEN "SIGN UP TO APPLY" (JOBS-29, lead decision
 * 2026-10-31, under the owner's 9-2 rule "Guests see shared jobs: no poster, address, coordinates").
 * The figure is the guest Browse card's own ("You'd take home $74"), never "Budget $85" beside a card that said $74
 * (lead 10-31, b49's finding); the sheet has its X and no drag bar (owner 10-31 14:22).
 * The 10-30 jobs audit: on guest Browse, tapping a card went straight to the sign-up form with no job shown first.
 * Holds, for both guest surfaces (the Browse tap and a shared /jobs/:id link, guestOpensSharedJobLink covers the link):
 *  - the preview prints exactly the four facts and the title, nothing from the description, poster or address;
 *  - "Sign Up to Apply" carries the job's id; the X closes;
 *  - the take-home equals the guest card's JobPrice chip for the same row (flat stamp, crew split, rush fee);
 *  - guest Browse's card tap opens that preview (it no longer navigates to sign-up), and its dialog is the preview.
 *
 * @mutate src/components/dashboard/GuestJobPreview.tsx |   if (area) facts.push({ label: "Parish", value: area }); |
 * @mutate src/components/dashboard/GuestJobPreview.tsx |   return parish ? parishLabel(parish) : town; |   return town;
 * @mutate src/components/dashboard/GuestJobPreview.tsx | onClick={() => onSignUp(job.id)} | onClick={() => onSignUp("")}
 * @mutate src/pages/home/DashboardGuest.tsx |     setDetailJob(job);\n | \n
 * @mutate src/components/dashboard/GuestJobPreview.tsx |   const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1; |   const helpers = 1;
 * @mutate src/components/dashboard/GuestJobPreview.tsx | computeNet(job.budget, GUEST_FEE_PERCENT, job.urgent_fee ?? 0, helpers, fee, job) | computeNet(job.budget, GUEST_FEE_PERCENT, job.urgent_fee ?? 0, helpers, fee, null)
 * @mutate src/components/dashboard/GuestJobPreview.tsx |   if (net != null) facts.push({ label: isGiveawayFixedPayJob(job) ? "Pay" : "You'd take home", value: `$${formatPriceFloor(net)}` }); |   if (job.budget) facts.push({ label: "Budget", value: `$${job.budget}` });
 * @mutate src/components/dashboard/GuestJobPreview.tsx |         <DialogFooter>\n | <DialogFooter><button onClick={onClose}>Not Now</button>\n
 * @mutate src/pages/home/DashboardGuest.tsx | <GuestJobPreview job={detailJob} | <GuestJobPreview job={{ ...detailJob, title: detailJob.description ?? "" }}
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { GuestJobPreview, guestJobArea, guestJobFacts, guestTakeHome, GUEST_FEE_PERCENT, GUEST_JOB_FIELDS } from "@/components/dashboard/GuestJobPreview";
import { JobPrice } from "@/components/dashboard/JobPrice";

// A guest has no profile, so the one-time setup fee they would lose is 0 on the card and in the preview alike
// (useFirstPayoutFeeCents returns 0 with no profile); both read this one hook.
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
import { TIER_PERKS } from "@/lib/subscriptionTiers";

const JOB = {
  id: "3f0c9a4e-0000-4000-8000-0000000000b9",
  title: "Haul off an old couch",
  category: "moving",
  budget: 85,
  location: "Lafayette, LA",
  // What a wider row could carry: none of it may print.
  description: "Gate code 4411, 12 Oak St, call 337-555-0100",
  customer_id: "00000000-0000-4000-8000-0000000000a1",
  posterName: "Ann Guidry",
  latitude: 30.22,
  longitude: -92.02,
};

describe("the guest job preview", () => {
  it("prints the title and the four facts, and nothing else from the row", () => {
    render(<GuestJobPreview job={JOB} onClose={vi.fn()} onSignUp={vi.fn()} />);
    const sheet = document.querySelector("[data-guest-job-preview]") as HTMLElement;
    expect(sheet).toBeTruthy();
    expect(screen.getByText("Haul off an old couch")).toBeTruthy();
    const facts = guestJobFacts(JOB);
    expect(facts.map((f) => f.label)).toEqual(["Category", "Parish", "You'd take home"]);
    expect(facts.find((f) => f.label === "Parish")?.value).toBe("Lafayette Parish");
    expect(facts.find((f) => f.label === "You'd take home")?.value).toBe(`$${Math.floor(guestTakeHome(JOB)!)}`);
    expect(sheet.textContent).not.toContain("$85");
    for (const f of facts) expect(sheet.textContent).toContain(f.value);
    for (const secret of ["Oak St", "4411", "337-555", "Ann", "Guidry", "30.22", "-92.02", JOB.customer_id]) {
      expect(sheet.textContent, secret).not.toContain(secret);
    }
    expect([...GUEST_JOB_FIELDS]).toEqual([
      "id", "title", "category", "budget", "location",
      "urgent_fee", "is_group_job", "helpers_needed", "helper_fee_flat_cents", "helper_fee_percent",
    ]);
  });

  it("Sign Up to Apply carries the job; the X closes; no drag bar", () => {
    const onSignUp = vi.fn();
    const onClose = vi.fn();
    render(<GuestJobPreview job={JOB} onClose={onClose} onSignUp={onSignUp} />);
    const sheet = document.querySelector("[data-guest-job-preview]") as HTMLElement;
    expect(sheet.querySelector("[data-sheet-handle]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Not Now" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign Up to Apply" }));
    expect(onSignUp).toHaveBeenCalledWith(JOB.id);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the same figure as the guest Browse card's price chip, row for row", () => {
    // The guest card prices at the free tier (DashboardGuest passes it to every guest JobCard).
    const guest = readFileSync(resolve(import.meta.dirname, "../pages/home/DashboardGuest.tsx"), "utf8");
    expect(guest).toContain("effectiveFee={TIER_PERKS.free.platformFeePercent}");
    expect(GUEST_FEE_PERCENT).toBe(TIER_PERKS.free.platformFeePercent);
    const rows = [
      { ...JOB, budget: 85, helper_fee_flat_cents: 70, helper_fee_percent: 5 },
      { ...JOB, budget: 300, is_group_job: true, helpers_needed: 3, helper_fee_flat_cents: 70, helper_fee_percent: 5 },
      { ...JOB, budget: 120, urgent_fee: 25 },
      { ...JOB, budget: 60 },
    ];
    for (const row of rows) {
      const { container, unmount } = render(
        <JobPrice budget={row.budget} effectiveFee={TIER_PERKS.free.platformFeePercent} urgentFee={row.urgent_fee ?? 0}
          helpersNeeded={row.is_group_job && row.helpers_needed ? row.helpers_needed : 1} feeStamp={row} variant="chip" />,
      );
      const chip = (container.textContent ?? "").replace(/[^0-9]/g, "");
      unmount();
      const value = guestJobFacts(row).find((f) => f.label === "You'd take home")?.value;
      expect(value, JSON.stringify(row)).toBe(`$${chip}`);
      expect(value).not.toBe(`$${row.budget}`);
    }
  });

  it("a town that names no parish shows the town; no town, no area; no budget, no budget line", () => {
    expect(guestJobArea("Baton Rouge, LA")).toBe("East Baton Rouge Parish");
    expect(guestJobArea("Nowhere Special, LA")).toBe("Nowhere Special");
    expect(guestJobArea(null)).toBeNull();
    expect(guestJobFacts({ ...JOB, budget: null, location: null }).map((f) => f.label)).toEqual(["Category"]);
  });
});

describe("guest Browse's card tap shows the job first", () => {
  const src = blankComments(readFileSync(resolve(import.meta.dirname, "../pages/home/DashboardGuest.tsx"), "utf8"));
  const body = (name: string) => {
    const start = src.indexOf(`const ${name} = useCallback(`);
    expect(start, name).toBeGreaterThan(0);
    return src.slice(start, src.indexOf("}, [", start));
  };

  it("the card's onSelect opens the preview and does not go to sign-up", () => {
    const cards = [...src.matchAll(/<JobCard\b[\s\S]*?\/>/g)].map((m) => m[0]);
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c).toContain("onSelect={openDetailJob}");
    const open = body("openDetailJob");
    expect(open).toContain("setDetailJob(job)");
    expect(open).not.toMatch(/navigate\(|signupUrlFor/);
  });

  it("the dialog it opens is the guest preview, fed the tapped job, with sign-up carrying it", () => {
    expect(src).toMatch(/<GuestJobPreview job=\{detailJob\} onClose=\{closeDetailJob\} onSignUp=\{requireSignup\} \/>/);
    expect(src).not.toContain("<JobDetailDialog");
  });
});
