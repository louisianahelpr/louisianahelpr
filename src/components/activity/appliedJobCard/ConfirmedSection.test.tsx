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
import type { AppliedApp, Job } from "../activityConstants";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn(), hapticWarning: vi.fn() }));
vi.mock("./HelperTrackerPanel", () => ({ HelperTrackerPanel: () => null }));
vi.mock("@/components/activity/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("@/components/activity/JobPetCareSheet", () => ({ JobPetCareSheet: () => null }));

import { ConfirmedSection } from "./ConfirmedSection";

const job = {
  id: "job-1",
  title: "Pressure wash the driveway",
  status: "accepted",
  location: "123 Main St, Lafayette, LA 70503",
  customer_id: "poster-1",
  date_needed: "2026-09-20",
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
