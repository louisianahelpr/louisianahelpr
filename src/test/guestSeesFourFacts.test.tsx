/**
 * A GUEST SEES A JOB'S TITLE, CATEGORY, PARISH AND TAKE-HOME, THEN "SIGN UP TO APPLY" (JOBS-29, lead decision
 * 2026-10-31, under the owner's 9-2 rule "Guests see shared jobs: no poster, address, coordinates").
 * The figure is the guest Browse card's own ("You'd earn after fees $74"), never "Budget $85" beside a card that said $74
 * (lead 10-31, b49's finding); the sheet has its X and no drag bar (owner 10-31 14:22).
 * The 10-30 jobs audit: on guest Browse, tapping a card went straight to the sign-up form with no job shown first.
 * RE-POINTED 2026-11-12 (F268a, owner decision in OWNER-DECISIONS): a shared /jobs/:id link opened signed out is now the
 * job's own read-only page with the description (GuestJobPage; guarded by guestOpensSharedJobLink.test.tsx and the
 * server-side mask by guestsReadMaskedJobDescription.pglite.mjs). This guard now holds the guest BROWSE sheet only,
 * which keeps the four facts and no description. The JobDetail @mutate below still checks that the shared page's
 * read carries the day and time the facts print.
 * Holds, for the guest Browse tap:
 *  - the preview prints exactly the four facts and the title, nothing from the description, poster or address;
 *  - "Sign up to apply" carries the job's id; the X closes;
 *  - the take-home equals the guest card's JobPrice chip for the same row (flat stamp, crew split, rush fee);
 *  - guest Browse's card tap opens that preview (it no longer navigates to sign-up), and its dialog is the preview.
 *
 * @mutate src/components/dashboard/GuestJobPreview.tsx |   if (area) facts.push({ label: "Parish", value: area }); |
 * @mutate src/components/dashboard/GuestJobPreview.tsx |   return parish ? parishLabel(parish) : town; |   return town;
 * @mutate src/components/dashboard/GuestJobPreview.tsx | onClick={() => onSignUp(job.id)} | onClick={() => onSignUp("")}
 * @mutate src/pages/home/useGuestJobSheet.ts |     setDetailJob(job);\n | \n
 * @mutate src/components/dashboard/GuestJobPreview.tsx |   const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1; |   const helpers = 1;
 * @mutate src/components/dashboard/GuestJobPreview.tsx | computeNet(job.budget, GUEST_FEE_PERCENT, job.urgent_fee ?? 0, helpers, firstPayoutFee, job) | computeNet(job.budget, GUEST_FEE_PERCENT, job.urgent_fee ?? 0, helpers, firstPayoutFee, null)
 * F217 (whole-app audit 2026-11-10): the sheet also prints the card's town, day and time ("When"), and the pay reads
 * "You'd earn after fees", never "take home" beside the card's bare price.
 * @mutate src/components/dashboard/GuestJobPreview.tsx |   if (when) facts.push({ label: "When", value: when }); |
 * @mutate src/components/dashboard/GuestJobPreview.tsx |   if (town && area && area !== town) facts.push({ label: "Town", value: town }); |
 * @mutate src/components/dashboard/GuestJobPreview.tsx | const GUEST_PAY_LABEL = "You'd earn after fees"; | const GUEST_PAY_LABEL = "You'd take home";
 * @mutate src/pages/jobs/JobDetail.tsx | date_needed, date_window_end, start_time, is_flexible_schedule, status, expires_at, parish", | status, expires_at, parish",
 * @mutate src/components/dashboard/GuestJobPreview.tsx |   if (net != null) facts.push({ label: isGiveawayFixedPayJob(job) ? "Pay" : GUEST_PAY_LABEL, value: `$${formatPriceFloor(net)}` }); |   if (job.budget) facts.push({ label: "Budget", value: `$${job.budget}` });
 * @mutate src/components/dashboard/GuestJobPreview.tsx |         <DialogFooter>\n | <DialogFooter><button onClick={onClose}>Not now</button>\n
 * @mutate src/pages/home/DashboardGuest.tsx | <GuestJobPreview job={detailJob} | <GuestJobPreview job={{ ...detailJob, title: detailJob.description ?? "" }}
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { GuestJobPreview, guestJobArea, guestJobFacts, guestTakeHome, GUEST_FEE_PERCENT, GUEST_JOB_FIELDS, type GuestJob } from "@/components/dashboard/GuestJobPreview";
import { JobPrice } from "@/components/dashboard/JobPrice";

// A guest has no profile, so the one-time setup fee they would lose is 0 on the card and in the preview alike
// (useFirstPayoutFeeCents returns 0 with no profile); both read this one hook.
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import { jobLocalDateISO } from "./helpers/jobLocalDate";
import { formatJobDate } from "@/lib/dateUtils";

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
    expect(facts.map((f) => f.label)).toEqual(["Category", "Town", "Parish", "When", "You'd earn after fees"]);
    expect(facts.find((f) => f.label === "Town")?.value).toBe("Lafayette");
    expect(facts.find((f) => f.label === "When")?.value).toBe("Flexible");
    expect(facts.find((f) => f.label === "Parish")?.value).toBe("Lafayette Parish");
    expect(facts.find((f) => f.label === "You'd earn after fees")?.value).toBe(`$${Math.floor(guestTakeHome(JOB)!)}`);
    expect(sheet.textContent).not.toContain("$85");
    for (const f of facts) expect(sheet.textContent).toContain(f.value);
    for (const secret of ["Oak St", "4411", "337-555", "Ann", "Guidry", "30.22", "-92.02", JOB.customer_id]) {
      expect(sheet.textContent, secret).not.toContain(secret);
    }
    expect([...GUEST_JOB_FIELDS]).toEqual([
      "id", "title", "category", "budget", "location",
      "urgent_fee", "is_group_job", "helpers_needed", "helper_fee_flat_cents", "helper_fee_percent",
      "date_needed", "date_window_end", "start_time", "is_flexible_schedule",
    ]);
  });

  it("Sign up to apply carries the job; the X closes; no drag bar", () => {
    const onSignUp = vi.fn();
    const onClose = vi.fn();
    render(<GuestJobPreview job={JOB} onClose={onClose} onSignUp={onSignUp} />);
    const sheet = document.querySelector("[data-guest-job-preview]") as HTMLElement;
    expect(sheet.querySelector("[data-sheet-handle]")).toBeNull();
    expect(screen.queryByRole("button", { name: /^not now$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign up to apply" }));
    expect(onSignUp).toHaveBeenCalledWith(JOB.id);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the same figure as the guest Browse card's price chip, row for row", () => {
    // The guest card prices at the free tier (DashboardGuest passes it to every guest JobCard).
    const guest = readFileSync(resolve(import.meta.dirname, "../pages/home/DashboardGuest.tsx"), "utf8");
    expect(guest).toContain("effectiveFee={TIER_PERKS.free.platformFeePercent}");
    expect(GUEST_FEE_PERCENT).toBe(TIER_PERKS.free.platformFeePercent);
    const rows: Array<GuestJob & { budget: number }> = [
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
      const value = guestJobFacts(row).find((f) => f.label === "You'd earn after fees")?.value;
      expect(value, JSON.stringify(row)).toBe(`$${chip}`);
      expect(value).not.toBe(`$${row.budget}`);
    }
  });

  it("a town that names no parish shows the town; no town, no area; no budget, no budget line", () => {
    expect(guestJobArea("Baton Rouge, LA")).toBe("East Baton Rouge Parish");
    expect(guestJobArea("Nowhere Special, LA")).toBe("Nowhere Special");
    expect(guestJobArea(null)).toBeNull();
    expect(guestJobFacts({ ...JOB, budget: null, location: null }).map((f) => f.label)).toEqual(["Category", "When"]);
    // A town that is its own area is not printed twice.
    expect(guestJobFacts({ ...JOB, location: "Nowhere Special, LA" }).map((f) => f.label)).toEqual(["Category", "Parish", "When", "You'd earn after fees"]);
  });

  it("F217: the sheet prints the card's day and time, and the pay never says take home", () => {
    const day = jobLocalDateISO(3);
    const facts = guestJobFacts({ ...JOB, date_needed: day, start_time: "14:30:00" });
    expect(facts.find((f) => f.label === "When")?.value).toBe(`${formatJobDate(day)} · 2:30 PM`);
    expect(guestJobFacts({ ...JOB, date_needed: day }).find((f) => f.label === "When")?.value).toBe(formatJobDate(day));
    render(<GuestJobPreview job={{ ...JOB, date_needed: day, start_time: "14:30:00" }} onClose={vi.fn()} onSignUp={vi.fn()} />);
    const sheet = document.querySelector("[data-guest-job-preview]") as HTMLElement;
    expect(sheet.textContent).toContain(`${formatJobDate(day)} · 2:30 PM`);
    expect(sheet.textContent).toContain("Lafayette Parish");
    expect(sheet.textContent).toContain("You'd earn after fees");
    expect(sheet.textContent).not.toMatch(/take home/i);
  });
});

describe("guest Browse's card tap shows the job first", () => {
  const src = blankComments(readFileSync(resolve(import.meta.dirname, "../pages/home/DashboardGuest.tsx"), "utf8"));
  // F260u: the open/close pair moved to useGuestJobSheet (the sheet is its own history entry).
  const hookSrc = blankComments(readFileSync(resolve(import.meta.dirname, "../pages/home/useGuestJobSheet.ts"), "utf8"));
  const body = (name: string) => {
    const start = hookSrc.indexOf(`const ${name} = useCallback(`);
    expect(start, name).toBeGreaterThan(0);
    return hookSrc.slice(start, hookSrc.indexOf("}, [", start));
  };

  it("the card's onSelect opens the preview and does not go to sign-up", () => {
    const cards = [...src.matchAll(/<JobCard\b[\s\S]*?\/>/g)].map((m) => m[0]);
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c).toContain("onSelect={openDetailJob}");
    const open = body("openDetailJob");
    expect(open).toContain("setDetailJob(job)");
    // Its one navigate stays on this page (pushes ?job=), never to sign-up.
    expect(open).not.toMatch(/signupUrlFor|\/signup/);
    expect(open).toMatch(/navigate\(\s*\{ pathname: location\.pathname,/);
  });

  it("the dialog it opens is the guest preview, fed the tapped job, with sign-up carrying it", () => {
    // F268a: and Log in for a member, back to the same job.
    expect(src).toMatch(/<GuestJobPreview job=\{detailJob\} onClose=\{closeDetailJob\} onSignUp=\{requireSignup\} onLogIn=\{\(id\) => navigate\(guestLogInUrl\(id\)\)\} \/>/);
    expect(src).not.toContain("<JobDetailDialog");
  });
});
