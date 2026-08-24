/**
 * NotesIndicator
 *
 * Inline count badge + hover preview of recent admin notes for a user.
 * Extracted verbatim from AdminUsers.tsx — behaviour-preserving structural
 * refactor.
 */
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { MessageCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { formatCategory } from "@/lib/format";
interface NoteEntry {
  note: string;
  created_at: string;
  category: string;
}

interface NotesIndicatorProps {
  userId: string;
  notesSummary: Record<string, { count: number; recent: NoteEntry[] }>;
}

export const NotesIndicator = ({ userId, notesSummary }: NotesIndicatorProps) => {
  const summary = notesSummary[userId];
  if (!summary || summary.count === 0) return null;
  return (
    <HoverCard openDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="relative inline-flex items-center justify-center text-accent hover:text-primary transition-colors"
          aria-label={`${summary.count} admin note${summary.count > 1 ? "s" : ""}`}
        >
          <MessageCircle className="w-3.5 h-3.5" />
          <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-1 rounded-full bg-accent text-accent-foreground text-ds-9 font-bold flex items-center justify-center border border-background">
            {summary.count}
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-72 p-3 space-y-2" onClick={(e) => e.stopPropagation()}>
        <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-semibold">Recent admin notes ({summary.count})</p>
        {summary.recent.map((n, i) => (
          <div key={i} className="text-ds-11 space-y-0.5 border-l-2 border-accent/40 pl-2">
            <p className="text-foreground line-clamp-3">{n.note}</p>
            <p className="text-muted-foreground text-ds-11">
              {formatCategory(n.category)} · {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
            </p>
          </div>
        ))}
      </HoverCardContent>
    </HoverCard>
  );
};
