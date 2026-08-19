import { Button } from "@/components/ui/button";
import { Flag, Bookmark, MessageSquare, ChevronRight, ShieldCheck, Check } from "lucide-react";
import { getCity } from "@/lib/locationUtils";
import { IconActionButton } from "../IconActionButton";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import type { EnrichedJob } from "../types";

interface JobDetailFooterProps {
  job: EnrichedJob;
  guest: boolean;
  isSaved?: boolean;
  onToggleSave?: (jobId: string, saved: boolean) => void;
  onClose: () => void;
  onApply: (jobId: string) => void;
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
      <Button
        size="lg"
        // See the note on `Get verified` below: navigate() alone, never
        // navigate() + onClose().
        onClick={() => navigate("/signup")}
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
      {(viewerUserId === job.customer_id ||
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
        <div
          className="flex-1 rounded-ds-md p-3 text-center"
          style={{
            background: "hsl(var(--bark) / 0.08)",
            border: "0.5px solid hsl(var(--bark) / 0.2)",
          }}
        >
          <ShieldCheck
            className="w-5 h-5 mx-auto mb-1"
            style={{ color: "hsl(var(--burnt-sienna))" }}
            strokeWidth={2}
          />
          <p
            className="font-sans font-semibold text-ds-14"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            {(job.credential_tier ?? 0) === 1
              ? "ID verification required"
              : (job.credential_tier ?? 0) === 2
                ? "Licensed pros only"
                : "Licensed & insured required"}
          </p>
          <p
            className="font-serif italic text-ds-12 mt-0.5"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            {job.instant_book ? "Get verified to book this job" : "Get verified to apply for this job"}
          </p>
          <button
            className="mt-2 text-ds-12 font-sans font-semibold underline underline-offset-2 active:opacity-70 transition-opacity"
            style={{ color: "hsl(var(--burnt-sienna))" }}
            // Navigating AWAY unmounts this dialog with the route, so onClose() must NOT
            // follow. It used to. The close handler on the guest feed clears ?job= via
            // setSearchParams(..., { replace: true }), and setSearchParams acts on the
            // CURRENT location — so it replaced the entry navigate() had just pushed and
            // dropped the visitor back on the guest feed. The most important CTA a guest
            // can press ("Sign up to apply") therefore went nowhere.
            onClick={() => navigate("/profile")}
          >
            Get verified →
          </button>
        </div>
      ) : (
        <Button
          size="lg"
          onClick={() => { onApply(job.id); onClose(); }}
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
            <span className="truncate">{job.instant_book ? "Book now" : "Apply now"}</span>
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
