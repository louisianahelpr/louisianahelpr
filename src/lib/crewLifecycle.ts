import { supabase } from "@/integrations/supabase/client";
import { withCardHoldCapture } from "@/lib/cardHoldCapture";
import { identityRefusal, openIdentityCheck } from "@/lib/identityCheck";
import { arrivalVerdictFromRpc, type ArrivalVerdict } from "@/lib/arrivalGate";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { doneFloorStart } from "@/lib/doneFloor";
import type { AcceptMissing } from "@/lib/awardGate";
import { applicationStatusLabel } from "@/lib/statusLabels";

/**
 * A CREW MEMBER'S OWN LIFECYCLE (Q1382, owner 2026-10-05: group jobs ON at
 * launch).
 *
 * A crew has no lead (Q407). Each member's confirm / on-the-way / arrival /
 * done lives on their OWN roster row (`group_job_helpers`, 20260919192559),
 * stamped only by these definer RPCs (the row's lifecycle columns are
 * server-owned: `enforce_group_member_lifecycle_server_owned`). The job's own
 * scalar stamps belong to nobody on a crew, so a member's card must read its
 * step from the roster row, never from `jobs.helper_*`.
 *
 * Before this module no client called any of the five lifecycle RPCs below, so
 * a crew could be hired and then never worked or completed (Q1382). Guard:
 * src/test/crewLifecycleRpcsHaveCallers.test.ts.
 *
 * Every wrapper THROWS a CrewActionError on a refusal and on a body that does
 * not show the write landed: a null `error` from an RPC that answers with a
 * jsonb stamp is not proof of a write (CLAUDE.md, "a null error is not a
 * write").
 */

/** The roster columns a member's card and the poster's roster both read. */
export const CREW_SLOT_COLUMNS =
  "id, job_id, helper_id, status, helper_confirmed_at, helper_on_the_way_at, helper_arrived_at, helper_arrival_verified_at, poster_confirmed_arrival_at, poster_confirmed_working_at, helper_completed_at, proof_before_urls, proof_after_urls";

export interface CrewSlot {
  id: string;
  job_id: string;
  helper_id: string | null;
  status: string;
  helper_confirmed_at: string | null;
  helper_on_the_way_at: string | null;
  helper_arrived_at: string | null;
  helper_arrival_verified_at: string | null;
  poster_confirmed_arrival_at: string | null;
  poster_confirmed_working_at: string | null;
  helper_completed_at: string | null;
  proof_before_urls: string[] | null;
  proof_after_urls: string[] | null;
}

type StepStamps = Pick<
  CrewSlot,
  "helper_confirmed_at" | "helper_on_the_way_at" | "helper_arrived_at" | "poster_confirmed_arrival_at" | "helper_completed_at"
>;

/**
 * Where ONE member is, read off their own row.
 *
 *   confirm          spot not confirmed yet (rpc_group_member_confirm)
 *   waiting_for_crew confirmed, but the crew is not full: the job is still
 *                    'open' and on-the-way / arrival refuse `job_not_active`
 *   set_out          confirmed, crew booked, not on the way yet
 *   arrive           on the way, not arrived
 *   awaiting_poster  arrived; the poster's per-member "Confirm they've arrived" is
 *                    the gate the server enforces before Done
 *   finish           arrival confirmed: photos, the 30-minute floor, then Done
 *   done             this member's part is marked done
 */
export type CrewMemberStep =
  | "confirm"
  | "waiting_for_crew"
  | "set_out"
  | "arrive"
  | "awaiting_poster"
  | "finish"
  | "done";

export function crewMemberStep(slot: StepStamps, jobStatus: string | null | undefined): CrewMemberStep {
  if (slot.helper_completed_at) return "done";
  if (!slot.helper_confirmed_at) return "confirm";
  if (slot.helper_arrived_at) return slot.poster_confirmed_arrival_at ? "finish" : "awaiting_poster";
  if (jobStatus === "open") return "waiting_for_crew";
  if (slot.helper_on_the_way_at) return "arrive";
  return "set_out";
}

/** The 30-minute floor the completion trigger measures from this member's own
 *  clock (`enforce_group_member_completion_gates`): minutes still to wait, 0 when open. */
export function crewMinutesUntilDone(
  slot: Pick<CrewSlot, "poster_confirmed_working_at" | "helper_arrived_at">,
  nowMs = Date.now(),
): number {
  const from = doneFloorStart(slot.poster_confirmed_working_at, slot.helper_arrived_at);
  if (!from) return 0;
  const left = Date.parse(from) + 30 * 60_000 - nowMs;
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

/**
 * The job AS THIS MEMBER LIVES IT: the job row with their own roster stamps in
 * place of the job's scalar ones (which belong to nobody on a crew). Lets the
 * shared single-Helpr readers (the collapsed card's status line) describe a
 * crew member's own step without a crew copy of each of them.
 */
export function withCrewSlotStamps<J extends object>(job: J, slot: CrewSlot | null | undefined): J {
  if (!slot) return job;
  return {
    ...job,
    helper_confirmed_at: slot.helper_confirmed_at,
    helper_on_the_way_at: slot.helper_on_the_way_at,
    helper_arrived_at: slot.helper_arrived_at,
    helper_arrival_verified_at: slot.helper_arrival_verified_at,
    poster_confirmed_arrival_at: slot.poster_confirmed_arrival_at,
    helper_completed_at: slot.helper_completed_at,
  };
}

/** The poster's roster pill for one member: work confirmed, their step (when the row carries stamps), else the hire status. */
export function crewRosterPill(h: Partial<StepStamps> & { status: string; poster_confirmed_completion_at?: string | null }): string {
  if (h.status === "accepted" && h.poster_confirmed_completion_at) return "Work confirmed";
  if (h.status === "accepted" && h.helper_confirmed_at !== undefined) {
    return crewMemberStatusLabel({
      helper_confirmed_at: h.helper_confirmed_at ?? null,
      helper_on_the_way_at: h.helper_on_the_way_at ?? null,
      helper_arrived_at: h.helper_arrived_at ?? null,
      poster_confirmed_arrival_at: h.poster_confirmed_arrival_at ?? null,
      helper_completed_at: h.helper_completed_at ?? null,
    });
  }
  return applicationStatusLabel(h.status);
}

/** What one roster member is doing, for the poster's roster. */
export function crewMemberStatusLabel(slot: StepStamps): string {
  if (slot.helper_completed_at) return "Done";
  if (slot.poster_confirmed_arrival_at) return "Working";
  if (slot.helper_arrived_at) return "Arrived";
  if (slot.helper_on_the_way_at) return "On the way";
  if (slot.helper_confirmed_at) return "Confirmed";
  return "Not confirmed yet";
}

/**
 * A refusal or a silent no-op from one of the crew RPCs. `copy` is the
 * sentence from RPC_ERROR_COPY when the server named a reason we have words
 * for (shown as is, not reported: it is the rule working); null means an
 * unexpected failure the caller reports and words generically.
 */
export class CrewActionError extends Error {
  readonly copy: string | null;
  readonly original: unknown;
  constructor(copy: string | null, original: unknown, fallback: string) {
    super(copy ?? fallback);
    this.name = "CrewActionError";
    this.copy = copy;
    this.original = original;
  }
}

function stampOrThrow(data: unknown, key: string, rpc: string): string {
  const v = (data as Record<string, unknown> | null)?.[key];
  if (typeof v !== "string" || !v) {
    throw new CrewActionError(null, data, `${rpc} answered without ${key}: the write may not have landed`);
  }
  return v;
}

/**
 * A member's Confirm. Payouts or ID not done yet: the server RECORDS the Confirm
 * and completes it when Stripe reports payouts ready (20261007011530, owner
 * 2026-10-06: anyone can be hired, they set payouts up after accepting), and
 * answers `pending_setup` with what is missing, like a single job's Accept.
 */
export type CrewConfirmResult = { confirmedAt: string } | { pendingMissing: AcceptMissing[] };

export async function confirmCrewSpot(jobId: string): Promise<CrewConfirmResult> {
  // Q2399: the first confirmed spot on a held card is the hire, so the card is charged first.
  const { data, error, holdMessage } = await withCardHoldCapture(jobId, () => supabase.rpc("rpc_group_member_confirm", { _job_id: jobId }));
  if (error) throw new CrewActionError(holdMessage ?? rpcErrorMessage("rpc_group_member_confirm", error), error, error.message);
  const answer = (data ?? {}) as { action?: string; missing?: AcceptMissing[] };
  if (answer.action === "pending_setup") {
    return { pendingMissing: answer.missing?.length ? answer.missing : ["payout_setup"] };
  }
  return { confirmedAt: stampOrThrow(data, "helper_confirmed_at", "rpc_group_member_confirm") };
}

export async function crewMemberOnTheWay(
  jobId: string,
  loc: { lat: number; lng: number } | null,
): Promise<string> {
  const { data, error } = await supabase.rpc("rpc_group_member_on_the_way", {
    _job_id: jobId,
    p_lat: loc?.lat ?? undefined,
    p_lng: loc?.lng ?? undefined,
  });
  if (error) {
    if (identityRefusal(error)) openIdentityCheck("start");
    throw new CrewActionError(rpcErrorMessage("rpc_group_member_on_the_way", error), error, error.message);
  }
  return stampOrThrow(data, "helper_on_the_way_at", "rpc_group_member_on_the_way");
}

export async function crewMemberMarkArrival(
  jobId: string,
  loc: { lat: number; lng: number } | null,
): Promise<ArrivalVerdict> {
  const { data, error } = await supabase.rpc("rpc_group_member_mark_arrival", {
    _job_id: jobId,
    p_lat: loc?.lat ?? undefined,
    p_lng: loc?.lng ?? undefined,
  });
  if (error) {
    if (identityRefusal(error)) openIdentityCheck("start");
    throw new CrewActionError(rpcErrorMessage("rpc_group_member_mark_arrival", error), error, error.message);
  }
  // Same jsonb verdict shape as the single-Helpr mark_helper_arrival.
  const verdict = arrivalVerdictFromRpc(data);
  if (!verdict || !verdict.arrivalRecorded) {
    throw new CrewActionError(null, data, "rpc_group_member_mark_arrival answered without a recorded arrival");
  }
  return verdict;
}

export interface CrewDoneResult {
  alreadyDone: boolean;
  /** Members still to finish (null on an already-done repeat). */
  crewRemaining: number | null;
  /** This was the last part: the job itself is now marked done. */
  jobComplete: boolean;
}

/**
 * The per-member completion gates. They are raised by the roster TRIGGER
 * `enforce_group_member_completion_gates` on the UPDATE inside
 * rpc_group_member_mark_done, not by the RPC body, so the RPC copy inventory
 * (rpcErrorCopyCoverage.test.ts) cannot see them; their words live here.
 */
const CREW_DONE_GATE_COPY: Record<string, string> = {
  job_not_completable: "This job isn't active any more, so your part can't be marked done. Refresh the page.",
  completion_requires_confirmed_arrival:
    `The person who posted this job has to tap "Confirm they've arrived" for you before you can mark your part done.`,
  completion_requires_proof_photos: "Add before and after photos of your part before marking it done.",
  completion_min_work_time: "You can mark your part done 30 minutes after you arrived.",
};

function crewDoneGateCopy(error: { message?: string } | null): string | null {
  const raw = error?.message ?? "";
  for (const [code, copy] of Object.entries(CREW_DONE_GATE_COPY)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return copy;
  }
  return null;
}

export async function crewMemberMarkDone(jobId: string): Promise<CrewDoneResult> {
  const { data, error } = await supabase.rpc("rpc_group_member_mark_done", { _job_id: jobId });
  if (error) {
    throw new CrewActionError(
      crewDoneGateCopy(error) ?? rpcErrorMessage("rpc_group_member_mark_done", error),
      error,
      error.message,
    );
  }
  stampOrThrow(data, "helper_completed_at", "rpc_group_member_mark_done");
  const d = data as Record<string, unknown>;
  const remaining = Number(d.crew_remaining);
  return {
    alreadyDone: d.already_done === true,
    crewRemaining: d.crew_remaining == null || !Number.isFinite(remaining) ? null : remaining,
    jobComplete: d.job_complete === true,
  };
}

export async function posterConfirmMemberArrival(jobId: string, helperId: string): Promise<string> {
  const { data, error } = await supabase.rpc("rpc_poster_confirm_member_arrival", {
    _job_id: jobId,
    _helper_id: helperId,
  });
  if (error) {
    throw new CrewActionError(rpcErrorMessage("rpc_poster_confirm_member_arrival", error), error, error.message);
  }
  return stampOrThrow(data, "poster_confirmed_arrival_at", "rpc_poster_confirm_member_arrival");
}

/**
 * THE POSTER'S PER-MEMBER NO-SHOW (JOBS-3, owner 2026-10-31: "a no-show member
 * gets nothing + a strike; others are never held up"). After the start, on a
 * member who confirmed but never checked in: rpc_poster_report_member_no_show
 * (20261101031804) closes their spot, records the one no-show strike, tells
 * them, and completes the crew at once if everyone else is already done. Their
 * share goes back to the poster with the unfilled spots' refund at payout.
 */
/**
 * JOBS-3 (owner 2026-10-31: crew members are paid individually once the poster confirms they worked): the poster
 * confirms ONE member's work. rpc_poster_approve_member (20261101044659) stamps their roster row and the payout cron
 * pays them crew_member_payout_delay() (3 days) later, on their own. Returns when they are paid.
 */
export const CREW_APPROVE_NOT_READY = "Confirming one Helpr's work isn't available yet. Please try again in a few minutes.";
export async function posterApproveMember(jobId: string, memberId: string): Promise<{ approvedAt: string; payoutDueAt: string }> {
  const { data, error } = await supabase.rpc("rpc_poster_approve_member", { _job_id: jobId, _member_id: memberId });
  if (error) {
    if (isMissingRpcNamed(error, "rpc_poster_approve_member")) {
      throw new CrewActionError(CREW_APPROVE_NOT_READY, error, error.message);
    }
    throw new CrewActionError(rpcErrorMessage("rpc_poster_approve_member", error), error, error.message);
  }
  const d = (data ?? null) as Record<string, unknown> | null;
  // The body names the member it confirmed; anything else is not proof the stamp landed.
  if (!d || d.helper_id !== memberId || typeof d.payout_due_at !== "string" || typeof d.approved_at !== "string") {
    throw new CrewActionError(null, data, "rpc_poster_approve_member returned no approval");
  }
  return { approvedAt: d.approved_at, payoutDueAt: d.payout_due_at };
}

export const CREW_NO_SHOW_NOT_READY = "Reporting a crew no-show isn't available yet. Please try again in a few minutes.";

export async function posterReportMemberNoShow(jobId: string, memberId: string): Promise<{ jobComplete: boolean }> {
  const { data, error } = await supabase.rpc("rpc_poster_report_member_no_show", {
    _job_id: jobId,
    _member_id: memberId,
  });
  if (error) {
    // PGRST202: the app is newer than the database (the migration has not deployed yet). Expected for a few
    // minutes after a release, so it is said plainly and not reported as a fault.
    if (isMissingRpcNamed(error, "rpc_poster_report_member_no_show")) {
      throw new CrewActionError(CREW_NO_SHOW_NOT_READY, error, error.message);
    }
    throw new CrewActionError(rpcErrorMessage("rpc_poster_report_member_no_show", error), error, error.message);
  }
  const d = (data ?? null) as Record<string, unknown> | null;
  // The body names the member it struck; anything else is not proof the report landed.
  if (!d || d.helper_id !== memberId) {
    throw new CrewActionError(null, data, "rpc_poster_report_member_no_show returned no report");
  }
  return { jobComplete: d.job_complete === true };
}

/**
 * JOBS-3 follow-up (lead verdict 10-31): every confirmed member of an under-way crew was reported a no-show, so
 * nobody is left on the roster and nobody can finish. The roll-up never completes, so the poster's way out is
 * Cancel: poster_cancel_job (newest 20261031220849) accepts in_progress, prices no share for an empty roster
 * (v_committed false, no crew_cancellation_fee_shares row, fee 0, not late, no poster strike) and refunds in full.
 * Each no-show already had their strike from rpc_poster_report_member_no_show. `rosterKnown` is false until the
 * roster has loaded, so a crew whose members are still loading is never offered this.
 * Guard: src/test/crewAllNoShowCanCancel.test.tsx.
 */
export function crewNobodyLeft(
  jobStatus: string | null | undefined,
  roster: ReadonlyArray<{ helper_id: string | null }>,
  rosterKnown: boolean,
  started = false,
): boolean {
  // A3-31 (audit 11-01): a crew turns in_progress only when a member sets out or checks in, so a crew whose every
  // member was a no-show never set out and is still "accepted". Once its start has passed it is the same case.
  const underWay = jobStatus === "in_progress" || (jobStatus === "accepted" && started);
  return rosterKnown && underWay && !roster.some((m) => m.helper_id != null);
}
