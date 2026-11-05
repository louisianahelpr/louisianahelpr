import { Eye, Pencil, XCircle } from "lucide-react";
import { JobActionRow, JobActionChip } from "../../../components/job-card/JobActionRow";
import { formatShortDate } from "@/lib/format";
import type { AppliedApp, Job } from "../../../components/job-card/activityConstants";
import type { AppliedJobCardProps, ApplicationViewFields } from "./types";

/** The pending application's band under the card: the "Seen" chip, and Edit / Withdraw once open. Moved verbatim from AppliedJobCard (Q806). */
export function HelperPendingActions({
  app, job, viewedApp, isMinimalCard, isPending, isExpanded, editingMessageAppId, toggleExpandedJobId, setEditingMessageAppId, setEditMessageText, withdrawingAppId, setWithdrawTarget,
}: Pick<AppliedJobCardProps, "app" | "editingMessageAppId" | "toggleExpandedJobId" | "setEditingMessageAppId" | "setEditMessageText" | "withdrawingAppId" | "setWithdrawTarget"> & {
  job: Job; viewedApp: AppliedApp & ApplicationViewFields; isMinimalCard: boolean; isPending: boolean; isExpanded: boolean;
}) {
  return (
    <>
          {/* Pending actions — Edit alongside Withdraw, in the same
              icon-over-label chip row the posted card uses.

              Withdraw used to be the only thing here, and it was the only thing
              a waiting applicant could do: pull out entirely. The owner asked
              for the obvious middle option — "they should be able to edit app
              and withdraw" — and the editing surface already existed, it was
              just unreachable without knowing that "View details" hides it.
              PendingApplicationSection (rendered above, gated on `isExpanded`)
              owns the message editor, the bid editor and the attachment list;
              this chip expands the card AND opens the message editor, so Edit
              lands the user IN the editor rather than merely near it. No new
              editing surface was invented.

              Two chips at 2-up cost exactly the height one chip cost at 1-up,
              so the added affordance is free in vertical space. Spec v2 (audit #48,
              board 59): Edit application is neutral and Withdraw the quiet destructive
              outline (no yellow, no pink fill); the face says "View application". */}
          {/* While the inline editor (PendingApplicationSection) is open it
              owns Save/Cancel, so the outer Edit/Withdraw pair is hidden —
              two Cancel-shaped controls a few rows apart, one of which
              withdraws the whole application, is a trap. The Seen chip is
              information and stays; when there is none the band is dropped
              entirely rather than drawing an empty bordered strip. */}
          {!isMinimalCard && isPending && ((isExpanded && editingMessageAppId !== app.id) || viewedApp.poster_viewed_at) && (
            <div
              className="px-4 py-2.5 space-y-1.5"
              style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* "Seen" trust chip — visible when the poster has opened
                  the applicant list and viewed this application. Subtle
                  olivewood colour so it reads as informational, not urgent. */}
              {viewedApp.poster_viewed_at && (
                // The date was in a `title=` only. Touch has no hover, and iOS
                // is the primary surface, so on the device most helpers use
                // there was no route to it at all. It's short enough to just
                // say.
                <span
                  className="flex items-center gap-1 text-ds-10 font-medium"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  <Eye className="w-3 h-3" aria-hidden="true" /> Seen {formatShortDate(viewedApp.poster_viewed_at)}
                </span>
              )}
              {/* THE CONTROLS ARE BEHIND THE EXPAND; THE "Seen" CHIP IS NOT.
                  My call, per the owner's ruling that Jobs collapses like
                  Posts. Edit and Withdraw are an action row — two controls in
                  a `JobActionRow` — and the standing rule on the other card is
                  that controls live inside the expanded card while the
                  collapsed card only SIGNALS (that is exactly what
                  the collapsed status strip does on My Posts). The "Seen" chip is
                  the opposite: information, no tap, and the single most
                  useful thing a waiting applicant can learn at a glance. So
                  the chip stays collapsed and the pair does not.

                  The band still drops entirely when it would be empty — the
                  existing rule, and the reason a collapsed pending card with
                  no "Seen" stamp draws no bordered strip at all. */}
              {editingMessageAppId !== app.id && isExpanded && (
              <JobActionRow columns={2}>
                <JobActionChip
                  icon={Pencil}
                  label="Edit application"
                  ariaLabel="Edit your application"
                  tone="neutral"
                  onClick={() => {
                    if (!isExpanded) toggleExpandedJobId(app.job_id);
                    setEditingMessageAppId(app.id);
                    setEditMessageText(app.message || "");
                  }}
                />
                <JobActionChip
                  icon={XCircle}
                  label={withdrawingAppId === app.id ? "Withdrawing…" : "Withdraw"}
                  ariaLabel="Withdraw application"
                  tone="quietDanger"
                  disabled={withdrawingAppId === app.id}
                  onClick={() => setWithdrawTarget({ appId: app.id, jobTitle: job.title || "a job", jobId: job.id ?? null })}
                />
              </JobActionRow>
              )}
            </div>
          )}
    </>
  );
}
