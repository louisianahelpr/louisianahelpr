import { Link, useNavigate } from "react-router-dom";
import { Heart, Briefcase, Send, Star, StickyNote, Check, X, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatName } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { PublicReviewWall } from "@/components/profile/PublicReviewWall";
import type { SavedHelper } from "./types";

interface SavedHelperCardProps {
  h: SavedHelper;
  business: { business_id: string } | null | undefined;
  editingNoteFor: string | null;
  noteDraft: string;
  setNoteDraft: (value: string) => void;
  savingNote: boolean;
  togglingShare: string | null;
  openNoteEditor: (helperId: string, current: string | null | undefined) => void;
  cancelNoteEditor: () => void;
  saveNote: (helperId: string) => void;
  toggleTeamShare: (helperId: string, currentlyShared: boolean) => void;
  handleRemove: (helperId: string) => void;
}

export function SavedHelperCard({
  h,
  business,
  editingNoteFor,
  noteDraft,
  setNoteDraft,
  savingNote,
  togglingShare,
  openNoteEditor,
  cancelNoteEditor,
  saveNote,
  toggleTeamShare,
  handleRemove,
}: SavedHelperCardProps) {
  const navigate = useNavigate();
  const initials = (h.full_name || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <div
      key={h.helper_id}
      className="rounded-2xl liquid-glass p-4 space-y-3 transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <Link
          to={`/user/${h.helper_id}`}
          className="shrink-0"
          aria-label={`View ${formatName(h.full_name)}'s profile`}
        >
          {h.avatar_url ? (
            <img loading="lazy" decoding="async"
              src={h.avatar_url}
              alt=""
              aria-hidden="true"
              className="w-12 h-12 rounded-full object-cover border border-[hsl(var(--border)/0.6)]"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-display italic font-bold">
              {initials}
            </div>
          )}
        </Link>
        <div className="flex-1 min-w-0">
          <Link
            to={`/user/${h.helper_id}`}
            className="font-display italic font-bold leading-tight hover:text-primary transition-colors block truncate text-ds-16"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
          >
            {formatName(h.full_name)}
          </Link>
          <div className="flex items-center gap-x-2 gap-y-0.5 mt-1 font-serif italic flex-wrap text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            {h.completed_jobs_together > 0 && (
              <span className="flex items-center gap-1 text-primary">
                <Star className="w-3 h-3 fill-primary" />
                {h.completed_jobs_together} job{h.completed_jobs_together === 1 ? "" : "s"} together
              </span>
            )}
            {h.completed_jobs_together > 0 && h.last_job_at && (
              <span style={{ color: "hsl(var(--burnt-sienna) / 0.5)" }}>·</span>
            )}
            {h.last_job_at && (
              <span>
                Last {formatDistanceToNow(new Date(h.last_job_at), { addSuffix: true })}
              </span>
            )}
          </div>
          {h.skills && (
            <p className="font-serif italic mt-1.5 line-clamp-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {h.skills}
            </p>
          )}
        </div>
      </div>

      {/* Condensed review wall (#86) — 0-2 recent quotes so
          the trust signal lives on the rebook surface, not
          just the deep-link profile. Renders nothing when
          the helpr has no visible reviews. */}
      <PublicReviewWall
        helperId={h.helper_id}
        variant="condensed"
        onSeeAll={() => navigate(`/user/${h.helper_id}?tab=reviews`)}
      />

      {/* Private note — poster-only memo about this helpr.
          Closed by default, tap to expand into a small
          textarea. Never shown to the helpr (RLS scopes
          reads/writes to customer_id). */}
      {editingNoteFor === h.helper_id ? (
        <div
          className="rounded-ds-md p-2.5 space-y-2"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.06)",
            border: "1px solid hsl(var(--burnt-sienna) / 0.22)",
          }}
        >
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="e.g. great with painting, prefers Tuesdays"
            rows={2}
            maxLength={500}
            aria-label="Private note about this Helpr"
            className="w-full rounded-ds-sm border border-border/40 bg-card px-2 py-1.5 text-ds-13 font-serif italic resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancelNoteEditor}
              disabled={savingNote}
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void saveNote(h.helper_id)}
              disabled={savingNote}
            >
              <Check className="w-3.5 h-3.5" /> {savingNote ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : h.private_note?.trim() ? (
        <button
          type="button"
          onClick={() => openNoteEditor(h.helper_id, h.private_note)}
          aria-label="Edit private note"
          className="w-full text-left rounded-ds-md p-2.5 flex gap-2 active:opacity-80 transition-opacity"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.06)",
            border: "1px solid hsl(var(--burnt-sienna) / 0.22)",
          }}
        >
          <StickyNote className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "hsl(var(--bark))" }} />
          <p className="font-serif italic text-ds-13 leading-snug flex-1 min-w-0" style={{ color: "hsl(var(--olivewood) / 0.9)" }}>
            {h.private_note}
          </p>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => openNoteEditor(h.helper_id, null)}
          className="inline-flex items-center gap-1 text-ds-11 font-semibold active:opacity-70 self-start"
          style={{ color: "hsl(var(--bark))" }}
        >
          <StickyNote className="w-3 h-3" /> Add a private note
        </button>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => navigate(`/post-job?offerTo=${h.helper_id}`)}
          className="flex-1 rounded-ds-md"
        >
          <Send className="w-3.5 h-3.5 mr-1.5" />
          Offer a job
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate(`/user/${h.helper_id}`)}
          className="rounded-ds-md"
        >
          <Briefcase className="w-3.5 h-3.5 mr-1.5" />
          Profile
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleRemove(h.helper_id)}
          className="rounded-ds-md"
          aria-label="Remove from saved"
        >
          <Heart className="w-3.5 h-3.5" style={{ color: "hsl(var(--burnt-sienna))", fill: "hsl(var(--burnt-sienna))" }} />
        </Button>
      </div>

      {business && (
        <button
          type="button"
          onClick={() => toggleTeamShare(h.helper_id, !!h.business_account_id)}
          disabled={togglingShare === h.helper_id}
          className="inline-flex items-center gap-1.5 text-ds-11 font-semibold active:opacity-70 self-start"
          style={{
            color: h.business_account_id
              ? "hsl(var(--olivewood))"
              : "hsl(var(--bark))",
          }}
          aria-pressed={!!h.business_account_id}
        >
          <Users className="w-3 h-3" />
          {h.business_account_id ? "Visible to team" : "Share with team"}
        </button>
      )}
    </div>
  );
}
