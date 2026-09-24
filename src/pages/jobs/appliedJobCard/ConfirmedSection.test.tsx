/**
 * VN-18 (owner, 2026-09-14): the back-out shown after the Helpr confirms and
 * before On the Way is labelled "Cancel Job". The confirmed-but-not-started
 * card (status 'accepted' + helper_confirmed_at) renders THIS section, and it
 * still said "Can't Make It" / "Cancel This Booking?" / "Cancel My Booking"
 * while the in-progress card (ActiveJobSection) said "Cancel Job" — one exit,
 * two names, depending on a status the Helpr cannot see.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AppliedApp, Job } from "../../../components/job-card/activityConstants";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn(), hapticWarning: vi.fn() }));
vi.mock("./HelperTrackerPanel", () => ({ HelperTrackerPanel: () => null }));
vi.mock("@/components/job-card/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("@/pages/jobs/JobPetCareSheet", () => ({ JobPetCareSheet: () => null }));

import { ConfirmedSection } from "./ConfirmedSection";

const job = {
  id: "job-1",
  title: "Pressure wash the driveway",
  status: "accepted",
  location: "123 Main St, Lafayette, LA 70503",
  customer_id: "poster-1",
  /* RELATIVE, never a calendar literal. This was hardcoded "2026-09-20" —
     comfortably future when the spec was written on 2026-09-14, and TODAY on
     2026-09-20, at which point the 09:00 start had passed and `hasJobStarted`
     correctly hid the Cancel chip. Both tests above went red on a product that
     was behaving exactly as specified; the fixture had simply aged into the
     window the section is supposed to suppress.

     `jobLocalDateISO` resolves the day in the PLATFORM's zone (America/Chicago),
     which is the same clock `hasJobStarted` and `helper_cancel_booking` use — a
     UTC-built date would reintroduce the off-by-one-day bug that made eight
     other specs green all morning and red after 19:00 Pacific. */
  date_needed: jobLocalDateISO(7),
  start_time: "09:00",
  helper_confirmed_at: "2026-09-14T12:00:00Z",
} as unknown as Job;
const app = { id: "app-1", job_id: "job-1", status: "accepted" } as unknown as AppliedApp;

const renderSection = () =>
  render(<ConfirmedSection app={app} job={job} userId="helper-1" navigate={() => {}} />);

describe("ConfirmedSection back-out is 'Cancel Job' (VN-18)", () => {
  it("labels the chip Cancel Job, never Can't Make It", () => {
    renderSection();
    const chip = screen.getByRole("button", { name: /^Cancel Job — / });
    expect(chip).toHaveTextContent("Cancel Job");
    expect(screen.queryByText(/can[’']t make it/i)).toBeNull();
  });

  it("opens the same dialog wording the in-progress card uses", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /^Cancel Job — / }));
    expect(screen.getByRole("heading", { name: "Cancel This Job?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel Job" })).toBeInTheDocument();
    // The dismiss stays "Cancel" — the popup grammar guard (dialogShell.test.ts).
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByText(/booking/i)).toBeNull();
  });
});

// The chip must not be offered once helper_cancel_booking would refuse it
// (job_already_started). Same clock as the RPC: start = date_needed +
// COALESCE(start_time,'00:00') in America/Chicago. Proven RED before the
// hasJobStarted guard — the chip rendered in the refused window.
describe("ConfirmedSection hides Cancel Job once the start has passed", () => {
  const renderWith = (patch: Partial<Job>) =>
    render(
      <ConfirmedSection
        app={app}
        job={{ ...job, ...patch } as Job}
        userId="helper-1"
        navigate={() => {}}
      />,
    );

  it("hides the chip for a job whose scheduled start is in the past", () => {
    renderWith({ date_needed: "2020-01-01", start_time: "09:00" });
    expect(screen.queryByRole("button", { name: /^Cancel Job/ })).toBeNull();
  });

  it("hides the chip for a null-start (flexible) job on a past day (RPC treats null as midnight)", () => {
    renderWith({ date_needed: "2020-01-01", start_time: null });
    expect(screen.queryByRole("button", { name: /^Cancel Job/ })).toBeNull();
  });

  it("still offers the chip for a clearly future job", () => {
    renderWith({ date_needed: "2099-01-01", start_time: "09:00" });
    expect(screen.getByRole("button", { name: /^Cancel Job/ })).toBeInTheDocument();
  });
});

// Two production lines carry this file: the VN-18 label, and the start-time
// gate that stops the app offering a cancel helper_cancel_booking would refuse.
// @mutate src/pages/jobs/appliedJobCard/ConfirmedSection.tsx | const startPassed = hasJobStarted(job.date_needed, job.start_time); | const startPassed = false;
// @mutate src/pages/jobs/appliedJobCard/ConfirmedSection.tsx | label="Cancel Job" | label="Can't Make It"
