/**
 * Helpr Guarantee (owner 2026-10-27, "Redo first, then refund"; migration 20261027200455).
 *
 * Within 48 hours of a job being done, its poster can say "Not done right" with a note and photos. The Helpr
 * picks a day to fix it (within 3 days) or says they can't; while the request is open the Helpr's pay for the job
 * stays held. Fixed and confirmed (or no answer from the poster in 48 hours): closed, the Helpr is paid.
 * Otherwise Helpr decides it as a dispute, and a refund is of the job price only.
 *
 * Every rule is the server's; this module reads the request and calls the four RPCs. No fee numbers anywhere.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isNotDeployedYet } from "@/lib/seriesDates";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { storageExtFor } from "@/lib/storageExt";
import { PROOF_PHOTO_TYPES, isAllowedUploadType } from "@/lib/uploadTypes";
import { report } from "@/lib/errorLogger";
import { rpcErrorMessage } from "./errorCopy";
import { GUARANTEE_RULES } from "./rules";
import { sameDayStartTime } from "@/lib/sameDayJob";

/** An RPC refusal in plain words (the code's copy), else a generic line; the original is reported, never dropped. */
class GuaranteeError extends Error {}
const GENERIC = "We couldn't save that. Check your connection and try again.";
/** What a failed guarantee action says: the copy this module wrote (GuaranteeError), never a platform error's own text. */
export function guaranteeErrorText(e: unknown): string {
  return e instanceof GuaranteeError ? e.message : GENERIC;
}
function refusal(words: string | null, error: unknown, source: string): GuaranteeError {
  if (!words) report(error, { tags: { source } });
  return new GuaranteeError(words ?? GENERIC);
}

type GuaranteeStatus = "awaiting_helpr" | "fix_scheduled" | "fixed" | "escalating" | "closed" | "disputed";

export interface GuaranteeClaim {
  id: string;
  job_id: string;
  poster_id: string | null;
  helper_id: string | null;
  note: string;
  photo_paths: string[];
  status: GuaranteeStatus;
  helpr_answer_by: string;
  fix_date: string | null;
  fixed_at: string | null;
  poster_answer_by: string | null;
  closed_at: string | null;
  close_reason: string | null;
  poster_reject_note: string | null;
  created_at: string;
}

/** The window and limits, the same numbers as guarantee_rules() (./rules, which the Terms page reads too). */
export { GUARANTEE_RULES };

const COLUMNS =
  "id, job_id, poster_id, helper_id, note, photo_paths, status, helpr_answer_by, fix_date, fixed_at, poster_answer_by, closed_at, close_reason, poster_reject_note, created_at";

/** This job's claim, readable by its two parties (RLS), or null. */
export async function fetchGuaranteeClaim(jobId: string): Promise<GuaranteeClaim | null> {
  const result = await supabase.from("job_guarantee_claims").select(COLUMNS).eq("job_id", jobId).maybeSingle();
  // The table is not deployed yet (migration lag): no claim can exist.
  if (isNotDeployedYet(result.error)) return null;
  return (unwrap(result) as GuaranteeClaim | null) ?? null;
}

/** The job fields the panel reads to decide what to offer the poster. */
export interface GuaranteeJob {
  id: string;
  customer_id: string | null;
  helper_id?: string | null;
  status: string | null;
  payment_status: string | null;
  is_group_job: boolean | null;
  helper_completed_at?: string | null;
  poster_completed_at?: string | null;
  completed_at?: string | null;
  has_active_dispute?: boolean | null;
}

/** When the job was done: jobs.completed_at, the column the server's 48-hour rule reads; else the later done stamp. */
function jobDoneAt(job: GuaranteeJob): Date | null {
  if (job.completed_at) return new Date(job.completed_at);
  const stamps = [job.helper_completed_at, job.poster_completed_at].filter((s): s is string => !!s).map((s) => new Date(s).getTime());
  return stamps.length ? new Date(Math.max(...stamps)) : null;
}

/** "Not done right" is offered to the poster of a finished one-Helpr job, unpaid out, within 48 hours, with no claim yet. */
/** The live work statuses where the poster's guarantee explainer applies (JA-28). */
const EXPLAINER_LIVE = new Set(["in_progress", "revision_requested"]);

/**
 * Whether the poster's Helpr Guarantee EXPLAINER belongs on the job (audit 11-01 JA-28): from Working until the
 * 48-hour window after Done closes. Never on a job that cannot use it (posted, booked, cancelled, expired, a
 * no-show) and never while a dispute is open (the advice would be wrong). An open claim shows its own view instead.
 */
export function guaranteeExplainerApplies(job: GuaranteeJob, now: Date = new Date()): boolean {
  if (job.has_active_dispute || job.status === "disputed") return false;
  if (EXPLAINER_LIVE.has(job.status ?? "")) return true;
  if (job.status !== "completed") return false;
  const done = jobDoneAt(job);
  return !!done && now.getTime() - done.getTime() < GUARANTEE_RULES.claimWindowHours * 3600_000;
}

export function canAskForFix(job: GuaranteeJob, viewerId: string, claim: GuaranteeClaim | null, now: Date = new Date()): boolean {
  if (claim) return false;
  if (job.customer_id !== viewerId || job.status !== "completed" || job.payment_status !== "payout_pending") return false;
  if (job.is_group_job || !job.helper_id) return false;
  const done = jobDoneAt(job);
  return !!done && now.getTime() - done.getTime() < GUARANTEE_RULES.claimWindowHours * 3600_000;
}

/** Upload the poster's photos where the dispute-evidence rule accepts them; returns the storage PATHS. */
export async function uploadGuaranteePhotos(uid: string, jobId: string, files: File[]): Promise<string[]> {
  const paths: string[] = [];
  // A type the proof-photos bucket refuses (a GIF, a PDF) is refused here first, with the same copy (Q54).
  if (files.some((f) => !isAllowedUploadType(f, PROOF_PHOTO_TYPES))) {
    throw refusal(rpcErrorMessage("rpc_guarantee_open", "guarantee_bad_photo"), new Error("unsupported_upload_type"), "guarantee.uploadPhoto");
  }
  for (const file of files) {
    const ext = storageExtFor(file, "jpg");
    const path = `${uid}/disputes/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("proof-photos").upload(path, file, { cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL });
    // Every photo or none: a request filed short of its evidence is worse than a retry.
    if (error) throw refusal(rpcErrorMessage("rpc_guarantee_open", "guarantee_bad_photo"), error, "guarantee.uploadPhoto");
    paths.push(path);
  }
  return paths;
}

export async function openGuaranteeClaim(jobId: string, note: string, photoPaths: string[]): Promise<string> {
  const { data, error } = await supabase.rpc("rpc_guarantee_open", { _job_id: jobId, _note: note, _photo_paths: photoPaths });
  if (error) throw refusal(rpcErrorMessage("rpc_guarantee_open", error), error, "guarantee.open");
  return data as string;
}

export async function helprAnswerGuarantee(claimId: string, accept: boolean, fixDate: string | null): Promise<string> {
  const { data, error } = await supabase.rpc("rpc_guarantee_helpr_answer", {
    _claim_id: claimId,
    _accept: accept,
    ...(fixDate ? { _fix_date: fixDate } : {}),
  });
  if (error) throw refusal(rpcErrorMessage("rpc_guarantee_helpr_answer", error), error, "guarantee.helprAnswer");
  return data as string;
}

export async function markGuaranteeFixed(claimId: string): Promise<string> {
  const { data, error } = await supabase.rpc("rpc_guarantee_mark_fixed", { _claim_id: claimId });
  if (error) throw refusal(rpcErrorMessage("rpc_guarantee_mark_fixed", error), error, "guarantee.markFixed");
  return data as string;
}

export async function posterAnswerGuarantee(claimId: string, fixed: boolean, note: string | null): Promise<string> {
  const { data, error } = await supabase.rpc("rpc_guarantee_poster_answer", {
    _claim_id: claimId,
    _fixed: fixed,
    ...(note ? { _note: note } : {}),
  });
  if (error) throw refusal(rpcErrorMessage("rpc_guarantee_poster_answer", error), error, "guarantee.posterAnswer");
  return data as string;
}

/**
 * The days the Helpr may pick: today and the next 3, as YYYY-MM-DD in Louisiana time (the server's window,
 * rpc_guarantee_helpr_answer). TODAY ONLY WHILE A VISIT TODAY IS STILL POSSIBLE (audit 2026-10-28 F31: at
 * 11:20 PM the picker still offered that day): the app's own same-day rule, sameDayStartTime (2 hours' notice,
 * a start by 9:00 PM), the one "Need it today" uses when posting.
 */
export function fixDateChoices(now: Date = new Date()): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, m, d] = fmt.format(now).split("-").map(Number);
  const days = Array.from({ length: GUARANTEE_RULES.fixWithinDays + 1 }, (_, i) => {
    const day = new Date(Date.UTC(y, m - 1, d + i));
    return day.toISOString().slice(0, 10);
  });
  return sameDayStartTime(now) === null ? days.slice(1) : days;
}

/** "Thu, Oct 29" for a YYYY-MM-DD (pinned to UTC so the day never slides). */
export function fixDateLabel(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${ymd}T00:00:00Z`),
  );
}
