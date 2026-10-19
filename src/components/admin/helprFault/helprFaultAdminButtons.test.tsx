/**
 * Q2082 (b), owner 2026-10-18 ("J4"): the admin "Helpr at fault" refund, in
 * both places the owner named: the admin jobs refund dialog
 * (admin_refund_general) and the dispute tools (admin_refund_dispute).
 * Each sends `helprFault: { helperId, kind, note }` and never an amount, finds
 * the Helpr for the admin (the job's Helpr, else the no-show / backout strike
 * on the job), refuses to offer it when there is no Helpr, and says out loud
 * when billing the Helpr failed or the Helpr's account is gone.
 *
 * @mutate src/components/admin/AdminJobs.tsx |           ...(fault ? { helprFault: fault } : {}), |
 * @mutate src/components/admin/helprFault/HelprFaultDisputeDialog.tsx | body: { action: "admin_refund_dispute", jobId: job.id, helprFault: body }, | body: { action: "admin_refund_dispute", jobId: job.id },
 * @mutate src/components/admin/helprFault/HelprFaultFields.tsx |   if (!helperId) { |   if (false) {
 * @mutate src/components/admin/helprFault/helprFault.ts |   } else if (outcome.billFailed) { |   } else if (false) {
 * @mutate src/components/admin/AdminDisputes.tsx |               openHelprFault={setFaultJob} |
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import AdminJobs from "../AdminJobs";
import { HelprFaultDisputeDialog } from "./HelprFaultDisputeDialog";
import { NO_HELPR_COPY } from "./helprFault";
import { blankComments } from "@/test/helpers/blankNonCode";

const JOB_ID = "job-hf-1";
const POSTER_ID = "poster-hf";
const HELPER_ID = "helper-hf";

let jobRow: Record<string, unknown>;
let strikeRows: Array<{ user_id: string }>;
let invokeAnswer: { data: unknown; error: unknown };
let invokeCalls: Array<{ fn: string; body: Record<string, unknown> }>;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
    rpc: async () => ({ data: false, error: null }),
    functions: {
      invoke: async (fn: string, opts: { body: Record<string, unknown> }) => {
        invokeCalls.push({ fn, body: opts.body });
        return invokeAnswer;
      },
    },
    from: (table: string) => {
      if (table === "jobs") {
        return { select: () => ({ order: async () => ({ data: [jobRow], error: null }) }) };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            in: async () => ({
              data: [{ user_id: POSTER_ID, full_name: "Marie Beaumont" }, { user_id: HELPER_ID, full_name: "Eli Trahan" }],
              error: null,
            }),
          }),
        };
      }
      if (table === "applications") {
        return { select: () => ({ eq: async () => ({ count: 0, error: null }) }) };
      }
      if (table === "payout_transfers") {
        return { select: () => ({ eq: () => ({ in: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) };
      }
      if (table === "user_violations") {
        return {
          select: () => ({
            eq: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: strikeRows, error: null }) }) }) }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
    message: vi.fn(),
  },
}));
vi.mock("@/hooks/useJobAccessNote", () => ({ useJobAccessNote: () => null, fetchJobAccessNote: async () => null }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/adminAudit", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/biometricGate", () => ({ requireBiometric: async () => true }));

beforeEach(() => {
  jobRow = {
    id: JOB_ID, title: "Rake and bag leaves", customer_id: POSTER_ID, helper_id: HELPER_ID,
    status: "assigned", payment_status: "escrow", budget: 60, location: "Lafayette, LA",
    category: "Yard Work", description: "Front yard.", created_at: "2026-10-10T12:00:00Z",
    date_needed: "2026-10-12", flag_reasons: null,
  };
  strikeRows = [];
  invokeCalls = [];
  invokeAnswer = { data: { success: true, helprFault: { cardFeeBilledCents: 204, billFailed: false, helprGone: false } }, error: null };
  toastError.mockReset();
  toastSuccess.mockReset();
  toastWarning.mockReset();
  window.localStorage.clear();
});

async function openRefundWithFault() {
  render(
    <MemoryRouter initialEntries={[`/admin?view=jobs&job=${JOB_ID}`]}>
      <AdminJobs />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Refund Poster/i }));
  fireEvent.click(await screen.findByLabelText("Helpr at fault"));
}

describe("admin jobs refund dialog: Helpr at fault", () => {
  it("sends helprFault (the job's Helpr, kind, note) with admin_refund_general and no amount", async () => {
    await openRefundWithFault();
    const confirm = await screen.findByRole("button", { name: "Refund (Helpr at fault)" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true); // no note yet
    fireEvent.click(screen.getByLabelText("Backed out"));
    fireEvent.change(screen.getByLabelText("Helpr at fault note"), { target: { value: "  Poster reported, Helpr confirmed  " } });
    expect(screen.queryByLabelText("Refund amount")).toBeNull();
    fireEvent.click(confirm);
    await waitFor(() => expect(invokeCalls.length).toBe(1));
    expect(invokeCalls[0].fn).toBe("create-payment");
    expect(invokeCalls[0].body).toMatchObject({
      action: "admin_refund_general",
      jobId: JOB_ID,
      helprFault: { helperId: HELPER_ID, kind: "backout", note: "Poster reported, Helpr confirmed" },
    });
    expect(invokeCalls[0].body).not.toHaveProperty("amountCents");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("finds the Helpr on the job's no-show strike when the report unassigned them", async () => {
    jobRow = { ...jobRow, helper_id: null, status: "open" };
    strikeRows = [{ user_id: "struck-helpr" }];
    await openRefundWithFault();
    fireEvent.change(await screen.findByLabelText("Helpr at fault note"), { target: { value: "No-show confirmed" } });
    fireEvent.click(screen.getByRole("button", { name: "Refund (Helpr at fault)" }));
    await waitFor(() => expect(invokeCalls.length).toBe(1));
    expect((invokeCalls[0].body.helprFault as { helperId: string }).helperId).toBe("struck-helpr");
  });

  it("offers nothing to send when there is no Helpr (account gone)", async () => {
    jobRow = { ...jobRow, helper_id: null, status: "open" };
    strikeRows = [];
    await openRefundWithFault();
    expect(await screen.findByText(NO_HELPR_COPY)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Refund (Helpr at fault)" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says out loud when billing the Helpr failed", async () => {
    invokeAnswer = { data: { success: true, helprFault: { cardFeeBilledCents: null, billFailed: true, helprGone: false } }, error: null };
    await openRefundWithFault();
    fireEvent.change(await screen.findByLabelText("Helpr at fault note"), { target: { value: "No-show" } });
    fireEvent.click(screen.getByRole("button", { name: "Refund (Helpr at fault)" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Refund sent; billing the Helpr failed. Open the job in Admin > Jobs and press Bill the Helpr."));
  });
});

describe("dispute tools: Helpr at fault", () => {
  const job = { id: JOB_ID, title: "Rake and bag leaves", helper_id: HELPER_ID };

  it("sends helprFault with admin_refund_dispute", async () => {
    const onDone = vi.fn();
    render(<HelprFaultDisputeDialog job={job} profiles={{ [HELPER_ID]: "Eli Trahan" }} onClose={vi.fn()} onDone={onDone} />);
    expect(screen.getByText("Eli Trahan")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Helpr at fault note"), { target: { value: "Never arrived" } });
    fireEvent.click(screen.getByRole("button", { name: "Refund (Helpr at fault)" }));
    await waitFor(() => expect(invokeCalls.length).toBe(1));
    expect(invokeCalls[0].body).toEqual({
      action: "admin_refund_dispute",
      jobId: JOB_ID,
      helprFault: { helperId: HELPER_ID, kind: "no_show", note: "Never arrived" },
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("offers nothing to send when there is no Helpr", async () => {
    render(<HelprFaultDisputeDialog job={{ ...job, helper_id: null }} profiles={{}} onClose={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByText(NO_HELPR_COPY)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Refund (Helpr at fault)" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says out loud when billing failed, and when the Helpr's account is gone", async () => {
    invokeAnswer = { data: { helprFault: { cardFeeBilledCents: null, billFailed: true, helprGone: false } }, error: null };
    const { unmount } = render(<HelprFaultDisputeDialog job={job} profiles={{}} onClose={vi.fn()} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Helpr at fault note"), { target: { value: "No-show" } });
    fireEvent.click(screen.getByRole("button", { name: "Refund (Helpr at fault)" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Refund sent; billing the Helpr failed. Open the job in Admin > Jobs and press Bill the Helpr."));
    unmount();
    invokeAnswer = { data: { helprFault: { cardFeeBilledCents: 0, billFailed: false, helprGone: true } }, error: null };
    render(<HelprFaultDisputeDialog job={job} profiles={{}} onClose={vi.fn()} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Helpr at fault note"), { target: { value: "No-show" } });
    fireEvent.click(screen.getByRole("button", { name: "Refund (Helpr at fault)" }));
    await waitFor(() => expect(toastWarning).toHaveBeenCalledWith("Helpr's account is gone: the card fee was kept from the refund."));
  });

  it("the dispute screen wires the dialog to the card's button", () => {
    const src = blankComments(readFileSync("src/components/admin/AdminDisputes.tsx", "utf8"));
    const wired = ["openHelprFault={setFaultJob}", "<HelprFaultDisputeDialog"].filter((s) => src.includes(s));
    expect(wired.length).toBeGreaterThan(1);
  });
});
