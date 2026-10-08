/**
 * Q1204 (owner, 2026-10-03): once a Helpr is booked, a job's place and details
 * are locked, like its date and time. The server refuses the PATCH
 * (enforce_poster_jobs_money_lock; src/test/pglite/bookedJobLocked.pglite.mjs),
 * and the edit dialog must not OFFER it: every locked input is disabled, one
 * plain line says why, and a save sends only what the lock leaves open
 * (turning photo proof off, never back on).
 *
 * @mutate src/pages/posts/EditJobDialog.tsx | const payload: TablesUpdate<"jobs"> = job.helper_id ? { require_photo_proof: requirePhotoProof } : updateData; | const payload: TablesUpdate<"jobs"> = updateData;
 * @mutate src/pages/posts/EditJobDialog.tsx | The place and details are locked once a Helpr is booked. | These fields can change.
 * @mutate src/pages/posts/EditJobDialog.tsx | <Input aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} disabled={hasHelper} | <Input aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} disabled={false}
 * @mutate src/pages/posts/EditJobDialog.tsx | disabled={hasHelper && !savedPhotoProof} | disabled={false}
 * @mutate src/pages/posts/EditJobDialog.tsx | maxLength={500} disabled={jobEnded} | maxLength={500} disabled={hasHelper}
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";
import type { Job } from "../../components/job-card/activityConstants";

const update = vi.fn();
// Q1461: the Access & Parking note is a network read once a card opens; none here.
vi.mock("@/hooks/useJobAccessNote", () => ({ useJobAccessNote: () => null, fetchJobAccessNote: async () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => <div data-testid="category-select" aria-disabled={disabled ? "true" : "false"}>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SelectItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (data: unknown) => {
        update(data);
        return { eq: () => ({ select: async () => ({ data: [{ id: "j1" }], error: null }) }) };
      },
    }),
  },
}));

const { EditJobDialog } = await import("./EditJobDialog");

const job = (over: Partial<Job>) =>
  ({ id: "j1", title: "Shelves", description: "Hang two", category: "cleaning", location: "Baton Rouge  ", date_needed: jobLocalDateISO(7),
     start_time: "09:00", materials_note: "Ladder in the garage", helper_id: null, payment_status: "unpaid", stripe_session_id: null,
     is_flexible_schedule: false, require_photo_proof: true, ...over }) as unknown as Job;

const saveAndConfirm = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  const both = await screen.findAllByRole("button", { name: "Save Changes" });
  fireEvent.click(both[both.length - 1]);
};

Element.prototype.scrollTo = () => {};
beforeEach(() => update.mockClear());

// Q1461 (owner answer 3): the line also says the access notes stay editable.
const LOCK_LINE = "The place and details are locked once a Helpr is booked. You can still update the access and parking notes here; your Helpr is told.";

describe("a booked job's place and details are not offered for editing (Q1204)", () => {
  it("booked: every locked input is disabled and the one line says why", () => {
    render(<EditJobDialog job={job({ helper_id: "h1" })} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText(LOCK_LINE)).toBeTruthy();
    for (const name of ["Job title", "Description", "Location", "Materials I'll provide"]) {
      expect((screen.getByLabelText(name) as HTMLInputElement).disabled, name).toBe(true);
    }
    // Owner answer 3 (Q1461, 2026-10-06): the access notes stay editable after booking.
    expect((screen.getByLabelText("Access and parking notes") as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByTestId("category-select").getAttribute("aria-disabled")).toBe("true");
    expect((screen.getByRole("switch", { name: "Flexible schedule" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("open: nothing is locked and no line is shown", () => {
    render(<EditJobDialog job={job({})} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.queryByText(LOCK_LINE)).toBeNull();
    expect((screen.getByLabelText("Location") as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("switch", { name: "Flexible schedule" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("booked: Save is off until the one open change (photo proof off) is made, then sends only that", async () => {
    render(<EditJobDialog job={job({ helper_id: "h1" })} onClose={() => {}} onSaved={() => {}} />);
    expect((screen.getByRole("button", { name: "Save Changes" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Require before and after photos" }));
    expect((screen.getByRole("button", { name: "Save Changes" }) as HTMLButtonElement).disabled).toBe(false);
    await saveAndConfirm();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0]).toEqual({ require_photo_proof: false });
  });

  it("booked with photo proof already off: the switch is disabled (the server refuses turning it on)", () => {
    render(<EditJobDialog job={job({ helper_id: "h1", require_photo_proof: false } as Partial<Job>)} onClose={() => {}} onSaved={() => {}} />);
    expect((screen.getByRole("switch", { name: "Require before and after photos" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("open: a save still sends the whole edit", async () => {
    render(<EditJobDialog job={job({})} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Shelves, three" } });
    await saveAndConfirm();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0]).toMatchObject({ title: "Shelves, three", location: "Baton Rouge", require_photo_proof: true });
  });
});
