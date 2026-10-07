import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilLine } from "lucide-react";
import { toast } from "sonner";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { hapticError } from "@/lib/haptics";
import { userFacingError } from "@/lib/userFacingError";
import { queryKeys } from "@/lib/queryKeys";
import {
  DETAIL_CHANGE_FIELDS,
  DETAIL_CHANGE_LABELS,
  fetchCrewBookedCount,
  fetchPendingDetailChange,
  previousValue,
  proposedValue,
  requestDetailChange,
  respondDetailChange,
  type DetailChangeField,
} from "@/lib/jobDetailChange";

type Details = Record<DetailChangeField, string>;

const LIMITS: Record<DetailChangeField, number> = { title: 32, description: 1000, location: 500, materials_note: 500 };

const shown = (v: string | null) => (v && v.trim() ? v : "(none)");

/**
 * Change a booked job's place or details, by request (Q1254, owner decision
 * 2026-10-07). The person who posted it asks; every Helpr booked on it (a
 * crew's every member) accepts or declines; nothing changes until the last
 * accept; one decline ends it; unanswered by the start it expires. Text only
 * (title, description, address, materials note), never photos. Same shape as
 * the date/time request (ScheduleChangeControl) beside it.
 */
export function DetailChangeControl({
  jobId,
  jobTitle,
  userId,
  viewer,
  isCrew,
  current,
}: {
  jobId: string;
  jobTitle: string | null;
  userId: string;
  viewer: "poster" | "helper";
  isCrew: boolean;
  current: Details;
}) {
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState<Details>(current);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const key = ["detail-change", jobId];

  const { data: pending } = useQuery({
    queryKey: key,
    staleTime: 30_000,
    queryFn: () => fetchPendingDetailChange(jobId),
  });
  // A crew is booked once its roster names a Helpr; the poster's Ask waits for that.
  const { data: crewBooked } = useQuery({
    queryKey: ["detail-change-crew", jobId],
    staleTime: 30_000,
    enabled: viewer === "poster" && isCrew,
    queryFn: () => fetchCrewBookedCount(jobId),
  });

  const settle = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.posted(userId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activity.applied(userId) }),
    ]);
  };

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      toast.success(await fn());
      await settle();
    } catch (err) {
      hapticError();
      toast.error(userFacingError(err, "Couldn't update the change request. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };

  const changes = Object.fromEntries(
    DETAIL_CHANGE_FIELDS.filter((f) => draft[f].trim() !== current[f].trim()).map((f) => [f, f === "materials_note" ? draft[f].trim() || null : draft[f].trim()]),
  ) as Partial<Record<DetailChangeField, string | null>>;
  const unchanged = Object.keys(changes).length === 0;
  // A changed title, description or address cannot be blank (the server says
  // so too); the materials note can be removed.
  const blank = (["title", "description", "location"] as const).some((f) => f in changes && !changes[f]);

  const mine = pending?.answers.find((a) => a.helper_id === userId);
  const askedOfMe = viewer === "helper" && mine?.answer === "pending";
  const iAccepted = viewer === "helper" && mine?.answer === "accepted";
  const askedByMe = viewer === "poster" && !!pending && pending.requested_by === userId;
  const waitingOn = pending ? pending.answers.filter((a) => a.answer !== "accepted").length : 0;
  const posterCanAsk = viewer === "poster" && (!isCrew || (crewBooked ?? 0) > 0);

  if (!askedOfMe && !iAccepted && !posterCanAsk) return null;

  const changeList = pending && (
    <ul className="space-y-1">
      {pending.changed_fields.map((f) => (
        <li key={f} className="text-ds-12 text-foreground leading-snug break-words">
          <span className="font-semibold">{DETAIL_CHANGE_LABELS[f]}:</span> {shown(previousValue(pending, f))} → <span className="font-semibold">{shown(proposedValue(pending, f))}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="px-4 py-2 border-t border-border/20 space-y-2" data-detail-change onClick={(e) => e.stopPropagation()}>
      {askedOfMe && pending && (
        <div className="space-y-2">
          <p className="text-ds-12 text-foreground leading-snug">
            <PencilLine className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-hidden />
            They asked to change the job details. Nothing changes unless {isCrew || pending.answers.length > 1 ? "everyone booked on it accepts" : "you accept"}.
          </p>
          {changeList}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const s = await respondDetailChange(pending.id, true);
                  if (s === "accepted") return "Accepted. The job has the new details.";
                  if (s === "waiting") return "Accepted. The change applies once everyone booked on it accepts.";
                  if (s === "declined") return "Someone else declined, so nothing changed.";
                  if (s === "replaced") return "They sent a newer request, so nothing changed from this one.";
                  return "That request has expired, so nothing changed.";
                })
              }
              // SECONDARY, never the gradient primary: the same reason as the
              // date/time request's Accept (offerCardHierarchy.test.tsx).
              className="min-h-[44px] px-4 rounded-ds-md text-ds-12 font-semibold border disabled:opacity-40"
              style={{ color: "hsl(var(--primary))", borderColor: "hsl(var(--primary) / 0.35)" }}
            >
              Accept
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const s = await respondDetailChange(pending.id, false);
                  if (s === "declined") return "Declined. The job stays as it is.";
                  return s === "replaced" ? "They sent a newer request, so nothing changed from this one." : "That request has expired, so nothing changed.";
                })
              }
              className="min-h-[44px] px-4 rounded-ds-md text-ds-12 font-semibold border border-border disabled:opacity-40"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {iAccepted && pending && (
        <p className="text-ds-11 text-muted-foreground leading-snug">
          You accepted the new details. They apply once everyone booked on it accepts; nothing changes if anyone declines or nobody answers before the start.
        </p>
      )}

      {askedByMe && pending && (
        <div className="space-y-1">
          <p className="text-ds-11 text-muted-foreground leading-snug">
            You asked to change the details. Waiting for {waitingOn === 1 ? "1 Helpr" : `${waitingOn} Helprs`} to accept; it lapses at the start time.
          </p>
          {changeList}
        </div>
      )}

      {posterCanAsk && (
        <button
          type="button"
          onClick={() => {
            setDraft(current);
            setAsking(true);
          }}
          className="min-h-[44px] px-1 text-ds-11 font-semibold underline underline-offset-2"
          style={{ color: "hsl(var(--bark))" }}
        >
          {askedByMe ? "Ask for a different change" : "Ask to change the details"}
        </button>
      )}

      <BrandConfirmDialog
        open={asking}
        onOpenChange={(next) => {
          if (!busy) setAsking(next);
        }}
        title={`Change the details of "${jobTitle ?? "this job"}"`}
        description="Everyone booked on it has to accept before anything changes. If anyone declines, or nobody answers before the start, the job stays as it is and the usual cancellation rules apply. Pay doesn't change, and photos can't be changed this way."
        primaryLabel={busy ? "Sending…" : "Send request"}
        primaryDisabled={busy || unchanged || blank}
        onPrimary={(e) => {
          e.preventDefault();
          void act(async () => {
            const asked = await requestDetailChange(jobId, changes);
            setAsking(false);
            return asked > 1 ? "Request sent. Nothing changes unless everyone booked on it accepts." : "Request sent. Nothing changes unless they accept.";
          });
        }}
        secondaryLabel="Cancel"
      >
        <div className="space-y-3">
          {DETAIL_CHANGE_FIELDS.map((f) => (
            <label key={f} className="block space-y-1 text-ds-12 text-foreground">
              <span className="block font-semibold">{DETAIL_CHANGE_LABELS[f]}</span>
              {f === "description" || f === "materials_note" ? (
                <Textarea
                  aria-label={DETAIL_CHANGE_LABELS[f]}
                  value={draft[f]}
                  maxLength={LIMITS[f]}
                  rows={f === "description" ? 3 : 2}
                  autoCapitalize="sentences"
                  onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                />
              ) : (
                <Input
                  aria-label={DETAIL_CHANGE_LABELS[f]}
                  value={draft[f]}
                  maxLength={LIMITS[f]}
                  autoCapitalize={f === "location" ? "words" : "sentences"}
                  onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                />
              )}
            </label>
          ))}
        </div>
      </BrandConfirmDialog>
    </div>
  );
}
