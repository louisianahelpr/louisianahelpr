/**
 * /rentals/requests/:id — one maintenance request, for both sides. The record
 * (Q46) shows every date. The landlord approves (then posts the pre-filled
 * job and pays, Q39) or declines with a reason the tenant sees (Q46); the
 * tenant withdraws an undecided request or answers "Was it fixed?" once work
 * has started (Q42), and the landlord sees that answer before paying.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { answerFixed, approveRequest, declineRequest, fetchRequest, fetchRequestJobState, fetchRequestPhotos, signedFileUrl, withdrawRequest } from "@/lib/rentals/api";
import {
  DECLINE_REASON_LABEL,
  REQUEST_STATUS_LABEL,
  URGENCY_LABEL,
  maintenanceCategory,
  rentalsErrorMessage,
  type DeclineReason,
  type Urgency,
} from "@/lib/rentals/copy";
import { RentalsCard, fmtDate } from "./rentalsUi";

function Photo({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    signedFileUrl(path).then(
      (u) => live && setUrl(u),
      () => live && setUrl(""),
    );
    return () => {
      live = false;
    };
  }, [path]);
  if (url === "") return <span className="text-xs text-muted-foreground">Photo unavailable</span>;
  if (!url) return <span className="block h-24 w-24 rounded-lg bg-muted" aria-hidden />;
  return /\.(mp4|mov)$/i.test(path) ? (
    <video src={url} controls className="h-24 w-24 rounded-lg object-cover" />
  ) : (
    <img src={url} alt="Problem photo" className="h-24 w-24 rounded-lg object-cover" />
  );
}

export default function MaintenanceRequestView() {
  const { id = "" } = useParams();
  const { user } = useCurrentUser();
  const uid = user?.id ?? "";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [reason, setReason] = useState<DeclineReason | "">("");
  const [reasonText, setReasonText] = useState("");
  const [note, setNote] = useState("");

  const q = useQuery({
    queryKey: ["rentals-request", id],
    enabled: !!id && !!uid,
    queryFn: async () => ({ r: await fetchRequest(id), photos: await fetchRequestPhotos(id), job: await fetchRequestJobState(id) }),
  });
  const done = () => qc.invalidateQueries({ queryKey: ["rentals-request", id] });
  const onError = (e: unknown) => toast.error(rentalsErrorMessage(e));
  const approve = useMutation({ mutationFn: () => approveRequest(id), onSuccess: done, onError });
  const decline = useMutation({ mutationFn: () => declineRequest(id, reason, reasonText), onSuccess: done, onError });
  const withdraw = useMutation({ mutationFn: () => withdrawRequest(id), onSuccess: done, onError });
  const fixed = useMutation({ mutationFn: (yes: boolean) => answerFixed(id, yes, note), onSuccess: done, onError });

  if (q.isError) return <AppPage title="Repair request" backTo="/rentals"><ErrorState onRetry={() => q.refetch()} /></AppPage>;
  if (!q.data) return <AppPage title="Repair request" backTo="/rentals"><p className="text-sm text-muted-foreground" role="status">Loading…</p></AppPage>;
  const r = q.data.r;
  if (!r) return <AppPage title="Repair request" backTo="/rentals"><p className="text-sm">This request isn't available.</p></AppPage>;

  const isLandlord = r.landlord_id === uid;
  const isTenant = r.tenant_id === uid;
  // The link is written before payment: only a FUNDED job is "booked"
  // (rentals_request_job_state; lh-money-escrow review #1).
  const job = q.data.job;
  const workStarted = job.booking === "booked" && ["in_progress", "pending_approval", "completed", "revision_requested", "disputed"].includes(job.jobStatus ?? "");

  return (
    <AppPage title="Repair request" backTo="/rentals">
      <div className="space-y-4">
        <RentalsCard title={maintenanceCategory(r.category).label}>
          <p className="text-sm font-semibold">{REQUEST_STATUS_LABEL[r.status] ?? r.status}{r.auto_approved ? " (auto-approved)" : ""}</p>
          <p className="text-sm whitespace-pre-wrap">{r.description}</p>
          <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Where</dt>
            <dd>{r.property_label}{r.unit_label ? `, ${r.unit_label}` : ""}</dd>
            <dt className="text-muted-foreground">Urgency</dt>
            <dd>{URGENCY_LABEL[r.urgency as Urgency] ?? r.urgency}</dd>
            <dt className="text-muted-foreground">Come in</dt>
            <dd>{r.access_windows || "Not given"}</dd>
            <dt className="text-muted-foreground">Pets</dt>
            <dd>{r.pets_on_site ? "Pets at home" : "No pets"}</dd>
            <dt className="text-muted-foreground">Entry</dt>
            <dd>{r.ok_to_enter_alone ? "OK to enter without the tenant" : "Tenant wants to be home"}</dd>
            <dt className="text-muted-foreground">Sent</dt>
            <dd>{fmtDate(r.created_at)}</dd>
            {r.decided_at && (
              <>
                <dt className="text-muted-foreground">Answered</dt>
                <dd>{fmtDate(r.decided_at)}</dd>
              </>
            )}
          </dl>
          {q.data.photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {q.data.photos.map((p) => (
                <Photo key={p.id} path={p.storage_path} />
              ))}
            </div>
          )}
          {r.status === "declined" && r.decline_reason_code && (
            <p className="text-sm">
              <span className="font-semibold">Landlord's reason: </span>
              {DECLINE_REASON_LABEL[r.decline_reason_code as DeclineReason]}
              {r.decline_reason_text ? ` — ${r.decline_reason_text}` : ""}
            </p>
          )}
          {r.tenant_answered_at && (
            <p className="text-sm">
              <span className="font-semibold">Was it fixed? </span>
              {r.tenant_says_fixed ? "Tenant says yes" : "Tenant says NO"} ({fmtDate(r.tenant_answered_at)})
              {r.tenant_fixed_note ? ` — ${r.tenant_fixed_note}` : ""}
            </p>
          )}
        </RentalsCard>

        {isLandlord && r.status === "submitted" && (
          <RentalsCard title="Your answer">
            <button type="button" className="btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold" disabled={approve.isPending} onClick={() => approve.mutate()}>
              Approve
            </button>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium mb-1">Or say no, with a reason your tenant will see</legend>
              {(Object.keys(DECLINE_REASON_LABEL) as DeclineReason[]).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="decline-reason" checked={reason === k} onChange={() => setReason(k)} />
                  {DECLINE_REASON_LABEL[k]}
                </label>
              ))}
              <textarea
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                rows={2}
                maxLength={500}
                aria-label="Reason details"
                placeholder={reason === "other" ? "Explain (required)" : "Add details (optional)"}
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
              />
              <button
                type="button"
                className="rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                disabled={!reason || decline.isPending}
                onClick={() => decline.mutate()}
              >
                Decline request
              </button>
            </fieldset>
          </RentalsCard>
        )}

        {isLandlord && r.status === "approved" && job.booking === "none" && (
          <RentalsCard title="Post the job">
            <p className="text-sm">We filled in a job from this request. Check the price, then post and pay like any job.</p>
            <button type="button" className="btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold" onClick={() => navigate(`/post-job?maintenance=${r.id}`)}>
              Post the repair job
            </button>
          </RentalsCard>
        )}
        {isLandlord && job.booking === "paying" && (
          <p className="text-sm">Checkout started. If you closed it, you can post the job again within the hour.</p>
        )}
        {isLandlord && job.booking === "refunding" && <p className="text-sm">Refund in progress.</p>}
        {isLandlord && job.booking === "booked" && job.jobId && (
          <p className="text-sm">
            Booked. <Link to={`/jobs/${job.jobId}`} className="underline font-semibold">Open the job</Link>
          </p>
        )}
        {isTenant && r.status === "approved" && (
          <p className="text-sm">{job.booking === "booked" ? "A Helpr job is booked for this repair." : "Approved, not booked yet."}</p>
        )}

        {isTenant && r.status === "submitted" && (
          <button type="button" className="rounded-full border border-border px-4 py-2 text-sm" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
            Withdraw request
          </button>
        )}
        {isTenant && r.status === "approved" && workStarted && (
          <RentalsCard title="Was it fixed?">
            <p className="text-xs text-muted-foreground">Answer once the Helpr has been. Your landlord sees your answer before confirming the job.</p>
            <textarea
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              rows={2}
              maxLength={500}
              aria-label="Note for your landlord"
              placeholder="Optional note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex gap-2">
              <button type="button" className="btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold" disabled={fixed.isPending} onClick={() => fixed.mutate(true)}>
                Yes, it's fixed
              </button>
              <button type="button" className="rounded-full border border-border px-4 py-2 text-sm font-semibold" disabled={fixed.isPending} onClick={() => fixed.mutate(false)}>
                No, not fixed
              </button>
            </div>
          </RentalsCard>
        )}
      </div>
    </AppPage>
  );
}
