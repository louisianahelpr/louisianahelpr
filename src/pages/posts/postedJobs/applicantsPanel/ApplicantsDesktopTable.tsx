import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { ApplicantSuggestedTime } from "./ApplicantSuggestedTime";
import { useEffect, useState } from "react";
import { ArrowUp, Ban, Flag, MapPin, NotebookPen, Sparkles, Star } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { AttachmentLink } from "@/components/AttachmentLink";
import { IconActionButton } from "@/components/dashboard/IconActionButton";
import { MessageApplicantButton, canMessageApplicant } from "@/components/jobs/MessageApplicantButton";
import type { EnrichedApplication } from "@/components/job-card/activityConstants";
import { applicantIdNote } from "@/lib/awardGate";
import { hapticLight } from "@/lib/haptics";
import { STAR_ON_CLS } from "@/lib/starColor";
import { formatName } from "@/lib/utils";
import { ApplicantStatusBadge } from "../ApplicantStatusBadge";
import type { DistanceBand } from "../useApplicantSignals";
import { ApplicantAvailableNow } from "./ApplicantAvailableNow";
import { CompareCheck } from "./ApplicantCompare";
import { ApplicantHireRow } from "./ApplicantHireRow";
import { ApplicantPrivateNote } from "./ApplicantPrivateNote";
import { ApplicantProofLine } from "./ApplicantProofLine";
import { ApplicantsCompareCard } from "./ApplicantsCompareCard";
import { ApplicantVerificationChip } from "./ApplicantVerificationChip";
import { helperInitialsFrom, isImageAttachment } from "./applicantsPanelHelpers";

/**
 * Board 170: on a wide screen the Applicants list is a table (Compare, Helpr,
 * Price, Their note, then Message and Hire), with the compare card beside it,
 * sticky, from 1400px. Below 1280px the phone cards stay (ApplicantsPanel).
 *
 * Every fact here is one the phone card shows, from the same row: the table is
 * a second layout, not a second source. A pending row hires through the card's
 * own ApplicantHireRow (offer, payout gate and decline unchanged). Report and
 * Block sit on every row (Q366), and a note the contact scanner hid is never
 * shown (applications_scan_contact_info). Applications carry no price of their
 * own (bidding was removed), so Price reads "At your price", and there is no
 * "When" column: an application has no time of its own. Guard:
 * src/test/applicantsDesktopTableBoard170.test.tsx.
 */
export const APPLICANTS_TABLE_QUERY = "(min-width: 1280px)";

/** True from 1280px wide: the Applicants list renders as the table. One query, no native branch (one surface). */
export function useApplicantsTable(): boolean {
  const read = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(APPLICANTS_TABLE_QUERY).matches;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(APPLICANTS_TABLE_QUERY);
    const apply = () => setWide(mql.matches);
    apply();
    mql.addEventListener?.("change", apply);
    return () => mql.removeEventListener?.("change", apply);
  }, []);
  return wide;
}

export type ApplicantTableRow = { app: EnrichedApplication; distanceBand: DistanceBand | null; promotedByTier: boolean };

export type ApplicantNotesState = {
  applicantNotes: Record<string, string>;
  noteEditing: string | null;
  setNoteEditing: (id: string | null) => void;
  noteDraft: string;
  setNoteDraft: (v: string) => void;
  saveNote: (id: string) => void;
};

const TH = "px-3 py-3 text-left text-ds-11 font-semibold uppercase tracking-wider text-muted-foreground";

export function ApplicantsDesktopTable({
  rows,
  applications,
  topHelperId,
  jobId,
  category,
  jobStartTime,
  completedCountsMap,
  categoryCounts,
  compare,
  notes,
  onAcceptApplication,
  onDecline,
  onReport,
  onBlock,
}: {
  /** The rows to draw (the panel's sorted list, already cut to "Show more"). */
  rows: ApplicantTableRow[];
  /** Every application on the job: the compare picks are read from here. */
  applications: EnrichedApplication[];
  /** The recommended top pick, when the list is sorted that way and has 2+ applicants. */
  topHelperId: string | null;
  jobId: string;
  category: string;
  /** The job's own start time: a day-only suggestion keeps it (owner 2026-10-23). */
  jobStartTime?: string | null;
  completedCountsMap: Map<string, number>;
  categoryCounts: Map<string, number> | null | undefined;
  compare: { ids: string[]; toggle: (id: string) => void; clear: () => void };
  notes: ApplicantNotesState;
  onAcceptApplication: (app: EnrichedApplication) => void;
  onDecline: (app: EnrichedApplication) => void;
  onReport: (app: EnrichedApplication) => void;
  onBlock: (app: EnrichedApplication) => void;
}) {
  // The "verifies their ID when they accept" note only while the ID check is on (owner 2026-10-23: off).
  const idOn = useIdentityCheckOnStore();
  const completed = (a: EnrichedApplication) => completedCountsMap.get(a.helper_id) ?? 0;
  const inCategory = (a: EnrichedApplication) => (categoryCounts ? categoryCounts.get(a.helper_id) ?? 0 : undefined);
  const distanceOf = (a: EnrichedApplication) => rows.find((r) => r.app.id === a.id)?.distanceBand?.label ?? null;
  const picked = compare.ids.map((id) => applications.find((a) => a.id === id)).filter((a): a is EnrichedApplication => !!a);

  return (
    <div className="min-[1400px]:grid min-[1400px]:grid-cols-[minmax(0,1fr)_300px] min-[1400px]:items-start min-[1400px]:gap-4" data-applicants-table="">
      <div className="overflow-hidden rounded-ds-lg border border-border bg-card">
        <table className="w-full table-fixed border-collapse text-ds-13">
          <thead>
            <tr className="border-b border-border">
              {applications.length > 1 && <th scope="col" className={`${TH} w-24`}>Compare</th>}
              <th scope="col" className={`${TH} w-[210px]`}>Helpr</th>
              <th scope="col" className={`${TH} w-[92px]`}>Price</th>
              <th scope="col" className={TH}>Their note</th>
              <th scope="col" className={`${TH} w-[252px]`}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ app, distanceBand, promotedByTier }) => {
              const helperName = formatName(app.profiles?.full_name, "Helpr");
              const jobs = completed(app);
              const reviews = app.reviewCount ?? 0;
              return (
                <tr key={app.id} className="border-b border-border align-top last:border-b-0" data-applicant-row={app.id}>
                  {applications.length > 1 && (
                    <td className="px-3 py-3">
                      {app.status === "pending" && <CompareCheck id={app.id} name={helperName} ids={compare.ids} toggle={compare.toggle} labelHidden />}
                    </td>
                  )}
                  <td className="px-3 py-3">
                    {app.helper_id === topHelperId && (
                      <span className="mb-1 flex items-center gap-1 text-ds-10 font-semibold uppercase tracking-wider text-foreground">
                        <Sparkles className="h-3 w-3" aria-hidden />Helpr Recommended
                      </span>
                    )}
                    {promotedByTier && (
                      <span className="mb-1 flex items-center gap-1 text-ds-10 font-semibold uppercase tracking-wider text-muted-foreground">
                        <ArrowUp className="h-3 w-3" aria-hidden />Priority placement
                      </span>
                    )}
                    <div className="flex items-start gap-2.5">
                      <a href={`/user/${app.helper_id}`} aria-label={`View ${helperName}'s profile`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full">
                        <UserAvatar userId={app.helper_id} src={app.profiles?.avatar_url} name={helperName} initials={helperInitialsFrom(helperName)} pixelSize={44} aria-hidden className="h-full w-full" fallbackClassName="text-ds-14 ring-0" />
                      </a>
                      <div className="min-w-0">
                        <a href={`/user/${app.helper_id}`} title={helperName} className="block truncate text-ds-15 font-bold hover:text-primary">{helperName}</a>
                        <span
                          className="flex items-center gap-1 text-ds-12 text-muted-foreground"
                          title={reviews > 0 ? `${(app.avgRating ?? 0).toFixed(1)} from ${reviews} public review${reviews === 1 ? "" : "s"}. A new review shows once both sides have reviewed, or after 14 days.` : undefined}
                        >
                          {reviews > 0 ? (
                            <>
                              <Star className={`h-3 w-3 ${STAR_ON_CLS}`} aria-hidden />
                              {(app.avgRating ?? 0).toFixed(1)}<span className="sr-only"> stars from</span> ({reviews})
                            </>
                          ) : (
                            "New"
                          )}
                          {" · "}
                          {jobs} job{jobs === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <ApplicantVerificationChip idVerified={app.profiles?.is_id_verified === true} payoutReady={app.profiles?.is_payout_ready === true} />
                      {distanceBand && (
                        <span className="inline-flex items-center gap-1 text-ds-11 font-semibold text-foreground">
                          <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                          {distanceBand.label}
                        </span>
                      )}
                      <ApplicantAvailableNow until={app.profiles?.available_until} />
                    </span>
                    <ApplicantProofLine categoryCount={inCategory(app)} totalCount={jobs} idVerified={app.profiles?.is_id_verified === true} category={category} />
                    <ApplicantSuggestedTime app={app} jobStartTime={jobStartTime} />
                    {idOn && app.profiles && app.profiles.is_id_verified !== true && (
                      <span className="mt-0.5 block text-ds-11 text-muted-foreground" data-applicant-id-note="">
                        {applicantIdNote(formatName(app.profiles.full_name, ""))}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-ds-13">At your price</td>
                  <td className="px-3 py-3">
                    {app.flagged_hidden ? (
                      <p className="text-ds-13 leading-snug" style={{ color: "hsl(var(--amber-ink))" }}>
                        This note was hidden — it looked like contact or payment details. Keep the conversation on Helpr so your payment stays protected.
                      </p>
                    ) : app.message ? (
                      <p className="line-clamp-3 text-ds-13 leading-snug">{app.message}</p>
                    ) : (
                      <span className="text-muted-foreground">No note</span>
                    )}
                    {(app.attachment_urls || []).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {(app.attachment_urls || []).map((url: string, i: number) => (
                          <AttachmentLink key={i} url={url} index={i} variant={isImageAttachment(url) ? "thumb" : "chip"} />
                        ))}
                      </div>
                    )}
                    <ApplicantPrivateNote
                      editing={notes.noteEditing === app.id}
                      note={notes.applicantNotes[app.id]}
                      draft={notes.noteDraft}
                      setDraft={notes.setNoteDraft}
                      onSave={() => notes.saveNote(app.id)}
                      onCancel={() => notes.setNoteEditing(null)}
                      onEdit={() => { notes.setNoteEditing(app.id); notes.setNoteDraft(notes.applicantNotes[app.id] ?? ""); }}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex gap-0.5">
                        <IconActionButton bare compact icon={<NotebookPen className="h-4 w-4" />}
                          ariaLabel={notes.applicantNotes[app.id] ? `Edit your private note on ${helperName}` : `Add a private note on ${helperName}`}
                          onClick={() => { hapticLight(); notes.setNoteEditing(app.id); notes.setNoteDraft(notes.applicantNotes[app.id] ?? ""); }} />
                        <IconActionButton bare compact icon={<Flag className="h-4 w-4" />} ariaLabel={`Report ${helperName}'s application`} onClick={() => { hapticLight(); onReport(app); }} />
                        <IconActionButton bare compact icon={<Ban className="h-4 w-4" style={{ color: "hsl(var(--danger-ink))" }} />} ariaLabel={`Block ${helperName}`} onClick={() => { hapticLight(); onBlock(app); }} />
                      </div>
                      {app.status === "pending" ? (
                        <ApplicantHireRow jobId={jobId} helperId={app.helper_id} helperName={helperName} payoutReady={app.profiles?.is_payout_ready === true}
                          onAcceptApplication={() => onAcceptApplication(app)} onDecline={() => onDecline(app)} />
                      ) : (
                        canMessageApplicant(app.status) && <MessageApplicantButton jobId={jobId} helperId={app.helper_id} helperName={helperName} />
                      )}
                      <ApplicantStatusBadge app={app} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="hidden min-[1400px]:block">
        <ApplicantsCompareCard picked={picked} completedCount={completed} categoryCount={inCategory} category={category} distanceOf={distanceOf} onHire={onAcceptApplication} clear={compare.clear} />
      </div>
    </div>
  );
}
