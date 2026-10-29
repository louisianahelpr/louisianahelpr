/**
 * Accepting a job whose poster's card is only HELD (Q2399) is the hire, so the card is
 * captured first: no accept the database is certain to refuse (audit 2026-10-28 F6: every
 * held accept logged a 403 payment_not_captured, then captured and retried). And only the
 * pressed button says it is busy: Accept said "Accepting…" while Decline said "Declining…".
 *
 * @mutate src/lib/cardHoldCapture.ts |   if (opts.knownHeld) { |   if (false) {
 * @mutate src/components/job-card/activityActions/useOfferHandlers.ts | supabase.rpc("accept_job_offer", { p_job_id: app.job_id }), { knownHeld: heldCard(app) }); | supabase.rpc("accept_job_offer", { p_job_id: app.job_id }));
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx | {busy && pressed === "decline" ? "Declining…" : "Decline"} | {busy ? "Declining…" : "Decline"}
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx |   const acceptLabel = busy && pressed === "accept" ? "Accepting…" | const acceptLabel = busy ? "Accepting…"
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AppliedApp, Job } from "../components/job-card/activityConstants";
import { blankComments } from "./helpers/blankNonCode";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/hooks/useAwardBlockReason", () => ({ useAcceptGate: () => ({ loading: false, reason: null, missing: [] }), useAwardBlockReason: () => null }));
vi.mock("@/hooks/useAcceptPendingJobs", () => ({ useAcceptPendingJobs: () => new Set<string>() }));

import { withCardHoldCapture } from "@/lib/cardHoldCapture";
import { OfferedActions } from "../pages/jobs/appliedJobCard/OfferedActions";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

beforeEach(() => invoke.mockReset());

describe("a held card is captured before the accept (F6)", () => {
  it("knownHeld: capture_hold does the hire; the refused accept is never sent from here", async () => {
    invoke.mockResolvedValue({ data: { state: "accepted", result: { state: "accepted" } }, error: null });
    const run = vi.fn(async () => ({ data: null, error: { message: "payment_not_captured" } }));
    const out = await withCardHoldCapture("job-1", run, { knownHeld: true });
    expect(run).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("create-payment", { body: { action: "capture_hold", jobId: "job-1" } });
    expect(out.error).toBeNull();
    expect(out.data).toEqual({ state: "accepted" });
  });

  it("knownHeld but no longer held: the accept runs once, for its own answer", async () => {
    invoke.mockResolvedValue({ data: { state: "not_held" }, error: null });
    const run = vi.fn(async () => ({ data: { state: "accepted" }, error: null }));
    const out = await withCardHoldCapture("job-1", run, { knownHeld: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(out.data).toEqual({ state: "accepted" });
  });

  it("not known to be held: the accept goes first, as before (nothing else pays a request)", async () => {
    const run = vi.fn(async () => ({ data: { state: "accepted" }, error: null }));
    const out = await withCardHoldCapture("job-1", run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    expect(out.error).toBeNull();
  });

  it("the Working card's accept passes the job's own held state", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../components/job-card/activityActions/useOfferHandlers.ts"), "utf8"));
    expect(src).toMatch(/supabase\.rpc\("accept_job_offer", \{ p_job_id: app\.job_id \}\), \{ knownHeld: heldCard\(app\) \}\)/);
    expect(src).toMatch(/\{ knownHeld: accept && heldCard\(app\) \}/);
    expect(src).toMatch(/job\?\.payment_status === "held"/);
  });
});

describe("only the pressed button shows busy text (F6)", () => {
  const job = {
    id: "job-1", title: "Clean my room", category: "cleaning", budget: 80, customer_id: "poster-1", helper_id: "helper-1",
    location: "Lafayette, LA", date_needed: jobLocalDateISO(1), start_time: "13:50:00", payment_status: "held",
    status: "accepted", helper_confirmed_at: null, response_deadline: new Date(Date.now() + 3_600_000).toISOString(),
  } as unknown as Job;
  const app = { id: "app-1", job_id: "job-1", helper_id: "helper-1", status: "accepted", posterName: "Pierre B.", job } as unknown as AppliedApp;

  function Harness() {
    // The parent marks the card busy the moment either button calls back, as useOfferHandlers does.
    const [busyId, setBusyId] = useState<string | null>(null);
    return (
      <MemoryRouter>
        <OfferedActions app={app} job={job} onHelperResponse={() => setBusyId(app.id)} respondingHelperAppId={busyId} />
      </MemoryRouter>
    );
  }

  it("pressing Accept: Accept says Accepting…, Decline keeps its word; both are disabled", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Accept job/ }));
    expect(screen.getByRole("button", { name: /Accepting…/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Decline$/ })).toBeDisabled();
    expect(screen.queryByText(/Declining…/)).toBeNull();
  });

  it("confirming Decline: Decline says Declining…, Accept keeps its word", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^Decline$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Decline the Job" }));
    expect(screen.getByRole("button", { name: /Declining…/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Accept job/ })).toBeDisabled();
    expect(screen.queryByText(/Accepting…/)).toBeNull();
  });
});

