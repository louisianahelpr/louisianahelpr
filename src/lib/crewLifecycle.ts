import { supabase } from "@/integrations/supabase/client";
import { arrivalVerdictFromRpc, type ArrivalVerdict } from "@/lib/arrivalGate";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

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
 *   awaiting_poster  arrived; the poster's per-member "Confirm They Arrived" is
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
  const from = slot.poster_confirmed_working_at ?? slot.helper_arrived_at;
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

export async function confirmCrewSpot(jobId: string): Promise<string> {
  const { data, error } = await supabase.rpc("rpc_group_member_confirm", { _job_id: jobId });
  if (error) throw new CrewActionError(rpcErrorMessage("rpc_group_member_confirm", error), error, error.message);
  return stampOrThrow(data, "helper_confirmed_at", "rpc_group_member_confirm");
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
  if (error) throw new CrewActionError(rpcErrorMessage("rpc_group_member_on_the_way", error), error, error.message);
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
  if (error) throw new CrewActionError(rpcErrorMessage("rpc_group_member_mark_arrival", error), error, error.message);
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
  job_not_completable: "This job isn't active any more, so your part can't be marked done. Pull to refresh.",
  completion_requires_confirmed_arrival:
    'The person who posted this job has to tap "Confirm They Arrived" for you before you can mark your part done.',
  completion_requires_proof_photos: "Add before and after photos of your part before marking it done.",
  completion_min_work_time: "A part can't be marked done within 30 minutes of starting.",
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
