/**
 * HelperRevisionCard — warm amber card shown in the helper's job card
 * when the poster has submitted a revision request (job.status ===
 * 'revision_requested').
 *
 * Shows:
 *   • The revision description (and photos if present)
 *   • "I'll fix it" → sets revision status to 'accepted' + notifies poster
 *   • "Discuss" → navigates to the message thread
 *
 * PGRST202 fallback: if job_revisions is not yet deployed, reads from
 * the legacy jobs.revision_note column instead.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, MessageSquare, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { useNavigate } from "react-router-dom";

interface HelperRevisionCardProps {
  jobId: string;
  posterId: string | null;
  /** Legacy fallback: the revision_note column on jobs */
  legacyRevisionNote: string | null;
  onAccepted: () => void;
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
}: HelperRevisionCardProps) {
  const navigate = useNavigate();
  const [revision, setRevision] = useState<RevisionRow | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    // Try to load from the formal table; fall back to the legacy note.
    supabase
      .from("job_revisions")
      .select("id, description, photos, status")
      .eq("job_id", jobId)
      .eq("status", "pending")
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

  const handleAccept = async () => {
    setAccepting(true);
    try {
      // Update the formal table if this isn't a legacy fallback
      if (revision?.id && revision.id !== "legacy") {
        const { error } = await supabase
          .from("job_revisions")
          .update({ status: "accepted" })
          .eq("id", revision.id);
        if (error && error.code !== "PGRST202") {
          throw error;
        }
      }

      // Notify the poster
      if (posterId) {
        await createNotification({
          user_id: posterId,
          title: "Helpr acknowledged the revision",
          message: "Your Helpr has seen your revision request and will fix it. Payment stays held until you confirm.",
          type: "info",
          link: `/my-posts?filter=revision_requested`,
        });
      }

      hapticSuccess();
      toast.success("Got it — get back to work and mark complete when you're done.");
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
          className="font-serif italic uppercase inline-flex items-center gap-1.5 text-ds-10"
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
        className="font-serif italic leading-relaxed text-ds-13"
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

      {/* Actions */}
      <div className="flex gap-2 pt-0.5">
        <Button
          size="sm"
          className="flex-1 rounded-ds-md"
          onClick={handleAccept}
          disabled={accepting}
          style={{
            background: "hsl(var(--amber-solid))",
            backgroundImage: "none",
            border: "1px solid hsl(var(--amber-solid))",
            color: "white",
            boxShadow: "0 1px 2px hsl(var(--amber-solid) / 0.18), 0 4px 12px -4px hsl(var(--amber-solid) / 0.28)",
          }}
        >
          <Wrench className="w-3.5 h-3.5 mr-1" />
          {accepting ? "Acknowledged…" : "I'll Fix It"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 rounded-ds-md"
          onClick={() => navigate("/messages")}
        >
          <MessageSquare className="w-3.5 h-3.5 mr-1" /> Discuss
        </Button>
      </div>
    </div>
  );
}
