import { Button } from "@/components/ui/button";
import { Flag, Bookmark, MessageSquare, ChevronRight, ShieldCheck, Check } from "lucide-react";
import { getCity } from "@/lib/locationUtils";
import { IconActionButton } from "../IconActionButton";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import type { EnrichedJob } from "../types";
import { signupUrlFor, rememberPendingSave } from "@/lib/jobIntent";

interface JobDetailFooterProps {
  job: EnrichedJob;
  guest: boolean;
  isSaved?: boolean;
  onToggleSave?: (jobId: string, saved: boolean) => void;
  onClose: () => void;
  onApply: (jobId: string) => void | boolean | Promise<void | boolean>;
  onReport: (jobId: string) => void;
  navigate: (to: string) => void;
  viewerUserId: string | null;
  viewerAppPosition: number | null;
  viewerTier: number;
  onAskQuestion: () => void;
}

/* Footer actions — Flag · Save · Message · Apply.
   Each secondary icon button gets a hover-scale + glow ring effect
   so they feel tactile rather than static.
   Guests get a single sign-up CTA instead — apply/message/save/report
   all require an account, so we surface one clear next step. */
export const JobDetailFooter = ({
  job, guest, isSaved, onToggleSave, onClose, onApply, onReport, navigate,
  viewerUserId, viewerAppPosition, viewerTier, onAskQuestion,
}: JobDetailFooterProps) => {
  if (guest) {
    // Mirror the authenticated footer's verb so the CTA names the real action:
    // an instant-book job invites a booking, else an apply. (The third
    // "Sign up to bid" branch went away with bidding — zero production usage.)
    const guestCtaLabel = job.instant_book ? "Sign up to book" : "Sign up to apply";
    return (
      <div className="flex gap-1.5 pt-0.5 items-stretch">
      {/* Guest save — the strongest interest signal a guest can give
          shouldn't dead-end (owner, 2026-08-24). Remembers the job as a
          PENDING SAVE (tracked storage, survives the email round-trip) and
          walks them into signup; the authed bounce consumes it, saves the
          job, and says so. */}
      <button
        type="button"
        aria-label="Save this job — sign up to keep it"
        onClick={() => {
          rememberPendingSave(job.id);
          navigate(signupUrlFor(`/jobs/${job.id}`));
        }}
        className="shrink-0 w-11 h-11 sm:h-12 sm:w-12 rounded-ds-md inline-flex items-center justify-center btn-press"
        style={{
          background: "hsl(var(--bark) / 0.08)",
          border: "0.5px solid hsl(var(--bark) / 0.28)",
          color: "hsl(var(--bark))",
        }}
      >
        <Bookmark className="w-4 h-4" strokeWidth={2} />
      </button>
      <Button
        size="lg"
        // See the note on `Get verified` below: navigate() alone, never
        // navigate() + onClose().
        //
        // The job rides along as `?redirect=/jobs/<id>` so the visitor is
        // returned to it once the account is admitted, instead of having to
        // find it again on a generic dashboard. Done HERE rather than via
        // `onApply` because all three guest surfaces render this footer and
        // only one of them wires a real `onApply` (Jobs.tsx and JobDetail.tsx
        // pass a noop and rely on this button navigating itself).
        onClick={() => navigate(signupUrlFor(`/jobs/${job.id}`))}
        className="btn-liquid-fill w-full rounded-ds-md h-11 sm:h-12 px-3 group relative overflow-hidden"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--bark)) 0%, hsl(var(--bark) / 0.86) 100%)",
          border: "0.5px solid hsl(var(--bark))",
          fontFamily: "Montserrat, system-ui, sans-serif",
          fontWeight: 600,
          letterSpacing: "0.01em",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255, 255, 255, 0.25), " +
            "inset 0 -1px 1px 0 rgba(0, 0, 0, 0.18), " +
            "0 1px 2px hsl(var(--olivewood) / 0.12), " +
            "0 8px 22px -6px hsl(var(--bark) / 0.45)",
        }}
      >
        <span
          className="relative z-10 inline-flex items-center justify-center gap-2 min-w-0"
          style={{ color: "white", textShadow: "0 1px 2px rgba(0, 0, 0, 0.28)" }}
        >
          <span className="truncate">{guestCtaLabel}</span>
          <ChevronRight
            className="w-4 h-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1"
            strokeWidth={2.5}
          />
        </span>
      </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5 pt-0.5">
      <IconActionButton
        ariaLabel="Report this job"
        onClick={() => { onReport(job.id); onClose(); }}
        hoverGlow="inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), 0 4px 12px -2px hsl(var(--burnt-sienna) / 0.20), 0 0 0 3px hsl(var(--burnt-sienna) / 0.08)"
        hoverColor="hsl(var(--burnt-sienna) / 0.85)"
        icon={
          /* Flag waves on hover — subtle counter-clockwise tilt */
          <Flag className="w-4 h-4 transition-transform duration-300 group-hover:-rotate-12 group-active:rotate-0" />
        }
      />
      {onToggleSave && (
        <IconActionButton
          ariaLabel={isSaved ? "Unsave job" : "Save job"}
          ariaPressed={isSaved}
          onClick={() => onToggleSave(job.id, !isSaved)}
          pressed={isSaved}
          pressedBackground="hsl(var(--primary) / 0.12)"
          pressedBorder="0.5px solid hsl(var(--primary) / 0.4)"
          pressedColor="hsl(var(--primary))"
          hoverGlow="inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), 0 4px 12px -2px hsl(var(--primary) / 0.22), 0 0 0 3px hsl(var(--primary) / 0.10)"
          hoverColor="hsl(var(--primary))"
          icon={
            /* Bookmark lifts on hover, pops on toggle */
            <Bookmark
              className={`w-4 h-4 transition-transform duration-300 group-hover:-translate-y-0.5 ${isSaved ? "fill-primary bookmark-pop" : ""}`}
              key={String(isSaved)}
              strokeWidth={2}
            />
          }
        />
      )}
      {/* Share — helpers forward great jobs to neighbours / friends.
          Hidden for the poster (they already own it). Matches the
          icon-row sizing of its neighbours (Flag · Save · Message). */}
      {viewerUserId !== job.customer_id && (
        <ShareJobButton
          variant="icon"
          job={{ id: job.id, title: job.title, budget: job.budget, category: job.category, city: getCity(job.location).replace(/,\s*LA\s*$/i, "") }}
          ariaLabel="Share this job"
        />
      )}
      {/* Message the poster — gated to people with a real reason to
          reach them: the poster themselves, a helper who's been offered
          or hired onto the job, OR a helper who has already applied
          (they may have a genuine question — "is the gate code needed?").
          A helper just browsing can't DM cold, so posters aren't flooded.
          The backend poster-first rule still governs the actual send. */}
      {/* `viewerUserId != null` guard is load-bearing, not defensive noise.
          It starts null (the auth look-up in useJobDetailData resolves a beat
          after the dialog opens) and `job.helper_id` is null on every unclaimed
          job — so `viewerUserId === job.helper_id` was `null === null`, i.e.
          TRUE, and this button rendered for one frame on every open before
          vanishing. Measured as the footer row losing a child (5 → 4) ~900ms
          after open. A null viewer matches nobody. */}
      {viewerUserId != null &&
      (viewerUserId === job.customer_id ||
        viewerUserId === (job as { offered_to_helper_id?: string | null }).offered_to_helper_id ||
        viewerUserId === (job as { helper_id?: string | null }).helper_id ||
        viewerAppPosition != null) && (
      <IconActionButton
        ariaLabel="Ask a question"
        onClick={onAskQuestion}
        hoverGlow="inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), 0 4px 12px -2px hsl(var(--bark) / 0.22), 0 0 0 3px hsl(var(--bark) / 0.08)"
        hoverColor="hsl(var(--bark))"
        icon={
          /* Message glides forward on hover — like sending */
          <MessageSquare className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        }
      />
      )}
      {/* Own-job guard — a poster can reach their own job via a shared
          link or Quick Apply toast, so swap the Apply CTA for a plain
          "your post" marker. The Dashboard apply handler also rejects
          self-applications, but hiding the button avoids the dead-end tap. */}
      {viewerUserId === job.customer_id ? (
        <div
          className="flex-1 rounded-ds-md h-11 sm:h-12 px-3 flex items-center justify-center gap-2 text-center"
          style={{
            background: "hsl(var(--bark) / 0.06)",
            border: "0.5px solid hsl(var(--bark) / 0.18)",
          }}
        >
          <span
            className="font-sans font-semibold text-ds-14"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            This is your post
          </span>
        </div>
      ) : viewerAppPosition !== null ? (
        <div
          className="flex-1 rounded-ds-md h-11 sm:h-12 px-3 flex items-center justify-center gap-2"
          style={{
            background: "hsl(var(--success-tint))",
            border: "0.5px solid hsl(var(--success-border) / 0.35)",
          }}
        >
          <Check
            className="w-4 h-4 shrink-0"
            style={{ color: "hsl(var(--success-ink))" }}
            strokeWidth={2.5}
          />
          <span
            className="font-sans font-semibold text-ds-14"
            style={{ color: "hsl(var(--success-ink-deep))" }}
          >
            Applied — #{viewerAppPosition}
          </span>
        </div>
      ) : (job.credential_tier ?? 0) > 0 && viewerTier < (job.credential_tier ?? 0) ? (
        // CREDENTIAL GATE — deliberately the SAME `h-11 sm:h-12` single row as
        // every other branch of this CTA slot (Apply / Applied / your-post).
        //
        // It used to be a `p-3` three-line block (shield glyph over a title over
        // a subtitle over a "Get verified →" link) measuring 197px where every
        // sibling branch occupies 44px. `viewerTier` comes from a useQuery
        // destructured with a `= 0` default, so while that RPC is in flight EVERY
        // tier-gated job renders THIS branch first and then collapses to the
        // Apply button once the real tier lands: measured, the dialog's content
        // height went 880px → 746px about a second after opening. That is
        // exactly the "it opens bigger then gets smaller" the owner reported.
        //
        // Equal-height branches make the swap free — whichever branch wins, and
        // however late the tier resolves, the slot is the same box. Do not give
        // any branch of this slot a height of its own.
        <button
          type="button"
          // Navigating AWAY unmounts this dialog with the route, so onClose() must NOT
          // follow. It used to. The close handler on the guest feed clears ?job= via
          // setSearchParams(..., { replace: true }), and setSearchParams acts on the
          // CURRENT location — so it replaced the entry navigate() had just pushed and
          // dropped the visitor back on the guest feed.
          onClick={() => navigate("/profile")}
          className="flex-1 min-w-0 rounded-ds-md h-11 sm:h-12 px-3 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          style={{
            background: "hsl(var(--bark) / 0.08)",
            border: "0.5px solid hsl(var(--bark) / 0.2)",
          }}
        >
          <ShieldCheck
            className="w-4 h-4 shrink-0"
            style={{ color: "hsl(var(--burnt-sienna))" }}
            strokeWidth={2}
          />
          <span
            className="font-sans font-semibold text-ds-14 truncate"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            {(job.credential_tier ?? 0) === 1
              ? "Get Verified to Apply"
              : (job.credential_tier ?? 0) === 2
                ? "Licensed Pros Only"
                : "Licensed & Insured Only"}
          </span>
          <ChevronRight className="w-4 h-4 shrink-0" strokeWidth={2.5} style={{ color: "hsl(var(--burnt-sienna))" }} />
        </button>
      ) : (
        <Button
          size="lg"
          /* NO onClose() here any more. The dialog decides what happens next:
             on the feed it swaps its own body to the apply step in place, so
             closing from inside the footer would tear the sheet down and make
             the apply surface fade in at the middle of an empty screen — the
             exact position jump this flow was rebuilt to remove (owner,
             2026-08-28). Guests never reach this branch; the guest footer
             above navigates on its own. */
          onClick={() => onApply(job.id)}
          className="btn-liquid-fill flex-1 min-w-0 rounded-ds-md h-11 sm:h-12 px-3 group relative overflow-hidden"
          style={{
            // Two-stop bark gradient under the glass surface — subtle
            // top-light to bottom-deep wash so the button doesn't read flat.
            background:
              "linear-gradient(180deg, hsl(var(--bark)) 0%, hsl(var(--bark) / 0.86) 100%)",
            border: "0.5px solid hsl(var(--bark))",
            fontFamily: "Montserrat, system-ui, sans-serif",
            fontWeight: 600,
            letterSpacing: "0.01em",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.25), " +
              "inset 0 -1px 1px 0 rgba(0, 0, 0, 0.18), " +
              "0 1px 2px hsl(var(--olivewood) / 0.12), " +
              "0 8px 22px -6px hsl(var(--bark) / 0.45)",
          }}
        >
          <span
            className="relative z-10 inline-flex items-center justify-center gap-2 min-w-0"
            style={{
              color: "white",
              textShadow: "0 1px 2px rgba(0, 0, 0, 0.28)",
            }}
          >
            {/* Invisible leading spacer the same width as the trailing chevron,
                so the label sits at the button's true optical center instead of
                being pushed left by the chevron. */}
            <span aria-hidden className="w-4 h-4 shrink-0" />
            <span className="truncate">{job.instant_book ? "Book Now" : "Apply Now"}</span>
            <ChevronRight
              className="w-4 h-4 shrink-0 transition-transform duration-300 group-hover:translate-x-1"
              strokeWidth={2.5}
            />
          </span>
        </Button>
      )}
    </div>
  );
};
