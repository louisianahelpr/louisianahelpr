/**
 * A GUEST SEES A JOB'S TITLE, CATEGORY, PARISH AND BUDGET, THEN "SIGN UP TO APPLY" (JOBS-29, lead decision
 * 2026-10-31, under the owner's 9-2 rule "Guests see shared jobs: no poster, address, coordinates").
 * The 10-30 jobs audit: on guest Browse, tapping a card went straight to the sign-up form with no job shown first.
 * Holds, for both guest surfaces (the Browse tap and a shared /jobs/:id link, guestOpensSharedJobLink covers the link):
 *  - the preview prints exactly the four facts and the title, nothing from the description, poster or address;
 *  - "Sign Up to Apply" carries the job's id; "Not Now" closes;
 *  - guest Browse's card tap opens that preview (it no longer navigates to sign-up), and its dialog is the preview.
 *
 * @mutate src/components/dashboard/GuestJobPreview.tsx |   if (area) facts.push({ label: "Parish", value: area }); |
 * @mutate src/components/dashboard/GuestJobPreview.tsx |   return parish ? parishLabel(parish) : town; |   return town;
 * @mutate src/components/dashboard/GuestJobPreview.tsx | onClick={() => onSignUp(job.id)} | onClick={() => onSignUp("")}
 * @mutate src/pages/home/DashboardGuest.tsx |     setDetailJob(job);\n | \n
 * @mutate src/pages/home/DashboardGuest.tsx | <GuestJobPreview job={detailJob} | <GuestJobPreview job={{ ...detailJob, title: detailJob.description ?? "" }}
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { GuestJobPreview, guestJobArea, guestJobFacts, GUEST_JOB_FIELDS } from "@/components/dashboard/GuestJobPreview";

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
    expect(facts.map((f) => f.label)).toEqual(["Category", "Parish", "Budget"]);
    expect(facts.find((f) => f.label === "Parish")?.value).toBe("Lafayette Parish");
    expect(facts.find((f) => f.label === "Budget")?.value).toBe("$85");
    for (const f of facts) expect(sheet.textContent).toContain(f.value);
    for (const secret of ["Oak St", "4411", "337-555", "Ann", "Guidry", "30.22", "-92.02", JOB.customer_id]) {
      expect(sheet.textContent, secret).not.toContain(secret);
    }
    expect([...GUEST_JOB_FIELDS]).toEqual(["id", "title", "category", "budget", "location"]);
  });

  it("Sign Up to Apply carries the job; Not now closes", () => {
    const onSignUp = vi.fn();
    const onClose = vi.fn();
    render(<GuestJobPreview job={JOB} onClose={onClose} onSignUp={onSignUp} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign Up to Apply" }));
    expect(onSignUp).toHaveBeenCalledWith(JOB.id);
    fireEvent.click(screen.getByRole("button", { name: "Not Now" }));
    expect(onClose).toHaveBeenCalled();
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
