/**
 * HelperRevisionCard — warm amber card shown in the helper's job card
 * when the poster has submitted a revision request (job.status ===
 * 'revision_requested').
 *
 * Shows:
 *   • The revision description (and photos if present)
 *   • "I'll fix it" → sets revision status to 'accepted' + notifies poster
 *
 * ONE PRIMARY, NO TWIN. "Discuss" used to sit beside it as an equal-width
 * outline, navigating to `/messages?jobId=…&userId=…` — byte-for-byte the
 * destination ActiveJobSection's "Message" chip already goes to, on the same
 * card, ~40px below. Two controls, one destination, two names for it. The
 * chip stays (it is the route a helper who genuinely cannot continue needs);
 * the duplicate is gone. Owner, 2026-09-11: one primary + overflow.
 *
 * PGRST202 fallback: if job_revisions is not yet deployed, reads from
 * the legacy jobs.revision_note column instead.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation } from "@/lib/mutationResult";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";

interface HelperRevisionCardProps {
  jobId: string;
  posterId: string | null;
  /** Legacy fallback: the revision_note column on jobs */
  legacyRevisionNote: string | null;
  onAccepted: () => void;
  /**
   * Whether the helper has ACCEPTED the revision, reported upward on every
   * load and on the accept tap.
   *
   * "Mark Fixed" is the parent's control but it is this card's state that
   * decides whether it may exist: showing both at once was the competing pair
   * the owner named ("Mark Fixed appears ONLY after they have accepted"), and
   * the acceptance flag lives here because this is the component that reads
   * `job_revisions.status`.
   */
  onAcceptedChange?: (accepted: boolean) => void;
}

interface RevisionRow {
  id: string;
  description: string;
  photos: string[] | null;
  status: string;
}

export function HelperRevisionCard({
  jobId,
  posterId,
  legacyRevisionNote,
  onAccepted,
  onAcceptedChange,
}: HelperRevisionCardProps) {
  const [revision, setRevision] = useState<RevisionRow | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    // Try to load from the formal table; fall back to the legacy note.
    // `pending` OR `accepted`, not pending alone. This read used to filter to
    // pending only, so the moment the helper tapped "I'll Fix It" the accepted
    // row stopped matching, the next render fell through to the legacy
    // `jobs.revision_note` (which the poster's request also writes) and the
    // card came back as a brand-new pending request: same amber box, same
    // live "I'll Fix It" button, and every further tap sent the poster another
    // "Helpr acknowledged the revision" notification without touching a row.
    // Measured 2026-09-07 on the [SWEEP] patio job: job_revisions.status was
    // `accepted` while the screen still offered to accept it.
    supabase
      .from("job_revisions")
      .select("id, description, photos, status")
      .eq("job_id", jobId)
      .in("status", ["pending", "accepted"])
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (error) {
          // PGRST202 = table not found (migration not pushed yet)
          if (error.code !== "PGRST202") {
            report(error, { tags: { source: "HelperRevisionCard.load" } });
          }
          // Fall back to the legacy note
          if (legacyRevisionNote) {
            setRevision({
              id: "legacy",
              description: legacyRevisionNote,
              photos: null,
              status: "pending",
            });
          }
          return;
        }
        if (data && data.length > 0) {
          setRevision(data[0] as RevisionRow);
        } else if (legacyRevisionNote) {
          setRevision({
            id: "legacy",
            description: legacyRevisionNote,
            photos: null,
            status: "pending",
          });
        }
      });
  }, [jobId, legacyRevisionNote]);

  // Single source: whatever the loaded/optimistic row says, the parent hears.
  const acknowledgedNow = revision?.status === "accepted";
  useEffect(() => {
    onAcceptedChange?.(acknowledgedNow);
    // `onAcceptedChange` is intentionally out of the dep list — call sites pass
    // an inline arrow, and including it re-fires this on every parent render.
     
  }, [acknowledgedNow]);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      // Update the formal table if this isn't a legacy fallback
      if (revision?.id && revision.id !== "legacy") {
        // .select("id"): acknowledging a revision that matches zero rows returns
        // error === null, and the poster would be told the Helpr had seen a
        // request the revision row still shows as open.
        const { data: rows, error } = await supabase
          .from("job_revisions")
          .update({ status: "accepted" })
          .eq("id", revision.id)
          .select("id");
        if (error && error.code !== "PGRST202") {
          throw error;
        }
        // PGRST202 = the table isn't deployed yet; that path is the legacy
        // fallback and deliberately keeps going. Anything else must have moved
        // a row.
        if (!error) {
          unwrapMutation(
            { data: rows, error: null },
            {
              action: "acknowledge this revision",
              rejectedMessage: "This revision couldn't be acknowledged — it may have already been resolved. Pull to refresh.",
              context: { revisionId: revision.id },
            },
          );
        }
      }

      // Notify the poster
      if (posterId) {
        await createNotification({
          user_id: posterId,
          title: "Helpr acknowledged the revision",
          message: "Your Helpr has seen your revision request and will fix it. Payment stays held until you confirm.",
          type: "info",
          // `?job=` — `revision_requested` has no chip in the five-bucket strip.
          link: `/my-posts?job=${jobId}`,
        });
      }

      hapticSuccess();
      // Flip the card's own copy of the row: the parent's refetch is what
      // eventually re-reads it, and under load that has taken 10s+, during
      // which the button read "I'll Fix It" again as if nothing had happened.
      setRevision((r) => (r ? { ...r, status: "accepted" } : r));
      toast.success("Got it — the poster knows you'll fix it. Tap Mark Fixed when it's done.");
      onAccepted();
    } catch (err: unknown) {
      hapticError();
      report(err instanceof Error ? err : new Error(String(err)), {
        tags: { source: "HelperRevisionCard.accept" },
      });
      toast.error("Couldn't update the revision status. Please try again.");
    } finally {
      setAccepting(false);
    }
  };

  if (!revision) return null;
  // Acknowledged already — the row says so (or this tap just did). The
  // control becomes a receipt, not a button: the only next step is Mark
  // Fixed, which ActiveJobSection renders directly under this card.
  const acknowledged = acknowledgedNow;

  return (
    <div
      className="rounded-ds-md p-3 space-y-2.5"
      style={{
        background: "hsl(var(--amber-tint) / 0.09)",
        border: "0.5px solid hsl(var(--amber-tint) / 0.28)",
        boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.45)",
      }}
    >
      {/* Header */}
      <div>
        <span
          className="font-sans uppercase inline-flex items-center gap-1.5 text-ds-10"
          style={{ color: "hsl(var(--amber-ink))", letterSpacing: "0.18em" }}
        >
          <AlertTriangle className="w-3 h-3" />
          Revision requested
        </span>
        <p
          className="font-display italic font-bold leading-snug mt-0.5 text-ds-15"
          style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
        >
          Poster wants a small fix
        </p>
      </div>

      {/* Description */}
      <p
        className="font-sans leading-relaxed text-ds-13"
        style={{ color: "hsl(var(--olivewood) / 0.85)" }}
      >
        "{revision.description}"
      </p>

      {/* Photos */}
      {revision.photos && revision.photos.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {revision.photos.map((url, i) => (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="w-14 h-14 rounded-ds-sm overflow-hidden border border-border/40 active:opacity-70"
            >
              <img src={url} alt={`Revision photo ${i + 1}`} className="w-full h-full object-cover" />
            </a>
          ))}
        </div>
      )}

      {/* Dispute-avoidance tips — collapsible to keep the card compact */}
      <details className="group text-left text-ds-12">
        <summary
          className="cursor-pointer select-none font-medium list-none flex items-center gap-1"
          style={{ color: "hsl(var(--amber-ink))", opacity: 0.75 }}
        >
          <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
          How to handle this well
        </summary>
        <ul
          className="mt-1.5 space-y-1 pl-1"
          style={{ color: "hsl(var(--olivewood) / 0.8)", lineHeight: 1.55 }}
        >
          <li>• Message the poster before tapping "I'll fix it" — one sentence goes a long way</li>
          <li>• Take a clear after-photo when you're done and attach it in chat</li>
          <li>• If you disagree with the request, discuss it first via the chat, not after</li>
          <li>• Once fixed, mark complete and wait for the poster to confirm</li>
        </ul>
      </details>

      {/* Actions — ONE. See the header note on the removed "Discuss" twin. */}
      <div className="pt-0.5">
        <Button
          size="sm"
          className="w-full rounded-ds-md"
          onClick={handleAccept}
          disabled={accepting || acknowledged}
          aria-disabled={acknowledged || undefined}
          style={{
            background: "hsl(var(--amber-solid))",
            backgroundImage: "none",
            border: "1px solid hsl(var(--amber-solid))",
            color: "white",
            boxShadow: "0 1px 2px hsl(var(--amber-solid) / 0.18), 0 4px 12px -4px hsl(var(--amber-solid) / 0.28)",
          }}
        >
          {acknowledged ? <Check className="w-3.5 h-3.5 mr-1" /> : <Wrench className="w-3.5 h-3.5 mr-1" />}
          {acknowledged ? "On it" : accepting ? "Acknowledged…" : "I'll Fix It"}
        </Button>
      </div>
    </div>
  );
}
