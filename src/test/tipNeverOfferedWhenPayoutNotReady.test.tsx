/**
 * Audit 2026-10-28 part 4, F29 (Broken): a poster was offered a tip three
 * times (the 5-star prompt, "Tip <name>" on the Done card, the tip sheet with
 * its amounts) and refused only at the last tap: create-payment 400 "This
 * Helpr hasn't set up their payout account yet and cannot receive tips". The
 * app already knew: the hire row's Select said "payout setup not finished yet"
 * (get_safe_profiles.is_payout_ready).
 *
 * Now every tip surface asks useHelprTakesTips first, from that same fact:
 * when the Helpr is not payout-ready, no tip is offered and one honest line
 * says why. Unknown (loading, read error) still offers it; create-payment stays
 * the backstop.
 *
 * @mutate src/hooks/useHelprTakesTips.ts |     return row ? { payoutReady: row.is_payout_ready === true, idVerified: row.is_id_verified === true } : null; |     return null;
 * @mutate src/hooks/useHelprTakesTips.ts |   return a.payoutReady && (!idCheckOn \|\| a.idVerified); |   return a.payoutReady;
 * @mutate src/components/TipDialog.tsx |         {takesTips === false ? ( |         {false ? (
 * @mutate src/pages/posts/postedJobCard/steps/CompletedStep.tsx |   const offerTip = tipOpen && takesTips !== false; |   const offerTip = tipOpen;
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts |       return job.is_group_job \|\| h.tipsReady === false |       return job.is_group_job
 * @mutate src/components/reviewPanel/ReviewForm.tsx |       if (rating === 5 && canTip && takesTips !== false) { |       if (rating === 5 && canTip) {
 * @mutate src/pages/posts/postedJobCard/steps/CompletedStep.tsx |   if (!m.tipped && takesTips === false) { |   if (false) {
 * @mutate src/components/CompletionPrompts.tsx |       <Dialog open={step === "tip" && offerTip && takesTips !== false} onOpenChange={() => setStep("share")}> |       <Dialog open={step === "tip" && offerTip} onOpenChange={() => setStep("share")}>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";
import { setIdentityCheckOn } from "@/lib/identityCheckSwitch";

const HELPR = "00000000-0000-4000-8000-0000000000aa";
const POSTER = "00000000-0000-4000-8000-0000000000bb";
const db = vi.hoisted(() => ({ ready: false as boolean | null, idVerified: false, rpcCalls: 0, byId: {} as Record<string, boolean> }));
const invoke = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const jobsChain = {
    select: () => jobsChain,
    eq: () => jobsChain,
    maybeSingle: async () => ({ data: { title: "Kitchen clean", budget: 40, is_group_job: false, helpers_needed: 1, helper_id: HELPR }, error: null }),
  };
  return {
    supabase: {
      rpc: async (name: string, args: { user_ids: string[] }) => {
        if (name !== "get_safe_profiles") return { data: null, error: { message: `unexpected rpc ${name}` } };
        db.rpcCalls++;
        if (db.ready === null) return { data: null, error: { message: "read failed" } };
        return { data: args.user_ids.map((id) => ({ user_id: id, is_payout_ready: id in db.byId ? db.byId[id] : db.ready, is_id_verified: db.idVerified })), error: null };
      },
      from: () => jobsChain,
      functions: { invoke: (...a: unknown[]) => invoke(...a) },
    },
  };
});
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/haptics", () => ({ hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn() }));

import { TipDialog } from "@/components/TipDialog";
import { CompletedStep } from "@/pages/posts/postedJobCard/steps/CompletedStep";
import type { PosterStepCtx } from "@/pages/posts/postedJobCard/steps/posterStepContract";
import type { Job } from "@/components/job-card/activityConstants";
import { posterFaceAction } from "@/pages/posts/postedJobCard/posterFaceAction";
import { __resetHelprTakesTipsCache, tipsNotReadyLine } from "@/hooks/useHelprTakesTips";

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const job = {
  id: "job-1", title: "Kitchen clean", customer_id: POSTER, helper_id: HELPR, is_group_job: false, helpers_needed: 1,
  status: "completed", payment_status: "released", proof_before_urls: [], proof_after_urls: [], date_needed: "2024-10-01",
} as unknown as Job;

function ctx(): PosterStepCtx {
  return {
    job, userId: POSTER, helperNames: { [HELPR]: "Hallie H." }, completedJobMeta: { "job-1": { tipped: false, reviewed: true } },
    completingJobId: null, confirmingArrivalJobId: null, confirmingWorkingJobId: null, instantReleaseOn: false, navigate: vi.fn(),
    onBoost: vi.fn(), onEdit: vi.fn(), crewBooked: false, onCancel: vi.fn(), onComplete: vi.fn(), onNoShow: vi.fn(),
    onTip: vi.fn(), onReview: vi.fn(), onDispute: vi.fn(), onReport: vi.fn(), onViewDispute: vi.fn(), onConfirmArrival: vi.fn(),
    onConfirmWorking: vi.fn(), onActionComplete: vi.fn(), completionSheetOpen: false, setCompletionSheetOpen: vi.fn(),
    disputeActing: false, resolveConfirmOpen: false, setResolveConfirmOpen: vi.fn(), escalateConfirmOpen: false,
    setEscalateConfirmOpen: vi.fn(), escalateDispute: vi.fn(), resolveDisputeAndRelease: vi.fn(),
  };
}

const LINE = tipsNotReadyLine("Hallie H.");
const tipButtons = () => screen.queryAllByRole("button", { name: /^Tip\b/ });

beforeEach(() => {
  invoke.mockReset();
  db.rpcCalls = 0;
  db.byId = {};
  __resetHelprTakesTipsCache();
});

describe("Owner 2026-10-30: tips wait until the Helpr has verified their ID", () => {
  const ID_LINE = "Hallie can receive tips once verified. You can tip them then.";
  beforeEach(() => { db.ready = true; db.idVerified = false; });
  afterEach(() => { cleanup(); setIdentityCheckOn(false); db.idVerified = false; });

  it("switch on, not verified: no amounts and no Tip button, just the line; create-payment is never called", async () => {
    setIdentityCheckOn(true);
    wrap(<TipDialog jobId="job-1" helperName="Hallie H." open onClose={() => {}} />);
    expect(await screen.findByText(ID_LINE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "$5" })).toBeNull();
    expect(tipButtons()).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("switch on, verified: the tip is offered", async () => {
    setIdentityCheckOn(true);
    db.idVerified = true;
    wrap(<TipDialog jobId="job-1" helperName="Hallie H." open onClose={() => {}} />);
    await waitFor(() => expect(tipButtons().length).toBeGreaterThan(0));
    expect(screen.queryByText(ID_LINE)).toBeNull();
  });

  it("switch off: not verified changes nothing, the tip is offered", async () => {
    wrap(<TipDialog jobId="job-1" helperName="Hallie H." open onClose={() => {}} />);
    await waitFor(() => expect(db.rpcCalls).toBeGreaterThan(0));
    await waitFor(() => expect(tipButtons().length).toBeGreaterThan(0));
    expect(screen.queryByText(ID_LINE)).toBeNull();
  });
});

describe("F29: a Helpr whose payout setup is not finished is never offered a tip", () => {
  it("the line names the Helpr and says why, in plain words", () => {
    expect(LINE).toBe("Hallie hasn't finished payout setup yet, so a tip can't reach them. You can tip once they do.");
  });

  it("tip sheet: no amounts and no Tip button, just the line; create-payment is never called", async () => {
    db.ready = false;
    wrap(<TipDialog jobId="job-1" helperName="Hallie H." open onClose={() => {}} />);
    expect(await screen.findByText(LINE)).toBeTruthy();
    expect(db.rpcCalls).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "$5" })).toBeNull();
    expect(tipButtons()).toHaveLength(0);
    expect(screen.queryByLabelText("Tip cost breakdown")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("tip sheet with a payout-ready Helpr (or an unknown answer) still offers the tip", async () => {
    for (const ready of [true, null] as const) {
      db.ready = ready;
      const { unmount } = wrap(<TipDialog jobId="job-1" helperName="Hallie H." open onClose={() => {}} />);
      await waitFor(() => expect(db.rpcCalls).toBeGreaterThan(0));
      await waitFor(() => expect(tipButtons().length).toBeGreaterThan(0));
      expect(screen.queryByText(LINE)).toBeNull();
      unmount();
      db.rpcCalls = 0;
      __resetHelprTakesTipsCache();
    }
  });

  it("Done card: no Tip button; the line takes its place", async () => {
    db.ready = false;
    wrap(<CompletedStep {...ctx()} />);
    expect(await screen.findByText(LINE)).toBeTruthy();
    expect(tipButtons()).toHaveLength(0);
  });

  it("Done card with a payout-ready Helpr keeps its Tip", async () => {
    db.ready = true;
    wrap(<CompletedStep {...ctx()} />);
    await waitFor(() => expect(db.rpcCalls).toBeGreaterThan(0));
    await waitFor(() => expect(tipButtons().length).toBeGreaterThan(0));
    expect(screen.queryByText(LINE)).toBeNull();
  });

  it("crew: each member is asked on their own; one not payout-ready gets the line, the other keeps Tip", async () => {
    const READY = "00000000-0000-4000-8000-0000000000c1";
    const NOT_READY = "00000000-0000-4000-8000-0000000000c2";
    db.ready = true;
    db.byId = { [READY]: true, [NOT_READY]: false };
    const crewJob = { ...job, helper_id: null, is_group_job: true, helpers_needed: 2 } as unknown as Job;
    const c = ctx();
    wrap(<CompletedStep {...c} job={crewJob} completedJobMeta={{
      "job-1": { tipped: false, reviewed: true, crewToReview: [], crewTips: [
        { id: READY, name: "Ana B.", tipped: false },
        { id: NOT_READY, name: "Ben C.", tipped: false },
      ] },
    }} />);
    expect(await screen.findByText(tipsNotReadyLine("Ben C."))).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Tip Ben C\./ })).toBeNull();
    expect(screen.getByRole("button", { name: /Tip Ana B\./ })).toBeTruthy();
    expect(screen.queryByText(tipsNotReadyLine("Ana B."))).toBeNull();
  });

  it("card face: 'Tip <name>' is not the face action when the Helpr can't take tips", () => {
    const h = {
      pendingApplicants: 0, helperName: "Hallie H.", confirmingArrival: false, completing: false,
      openApplicants: vi.fn(), confirmArrival: vi.fn(), approve: vi.fn(), review: vi.fn(), tip: vi.fn(), postAgain: vi.fn(),
      message: vi.fn(), manage: vi.fn(), confirm: vi.fn(), noShow: vi.fn(), cancel: vi.fn(), viewDispute: vi.fn(),
    };
    expect(posterFaceAction("done_tip_open", job, { ...h, tipsReady: true }).label).toBe("Tip Hallie");
    expect(posterFaceAction("done_tip_open", job, { ...h, tipsReady: null }).label).toBe("Tip Hallie");
    expect(posterFaceAction("done_tip_open", job, { ...h, tipsReady: false }).label).toBe("More options");
  });

  it("the 5-star prompt and the completion prompts skip the tip on the same answer", () => {
    const review = blankComments(readFileSync(join(__dirname, "../components/reviewPanel/ReviewForm.tsx"), "utf8"));
    expect(review).toContain("const takesTips = useHelprTakesTips(revieweeId, open && canTip);");
    expect(review).toContain("if (rating === 5 && canTip && takesTips !== false) {");
    const prompts = blankComments(readFileSync(join(__dirname, "../components/CompletionPrompts.tsx"), "utf8"));
    expect(prompts).toContain("const takesTips = useHelprTakesTips(revieweeId);");
    expect(prompts).toMatch(/if \(step === "tip" && \(!offerTip \|\| takesTips === false\)\) setStep\("share"\);/);
    expect(prompts).toContain('<Dialog open={step === "tip" && offerTip && takesTips !== false}');
  });
});
