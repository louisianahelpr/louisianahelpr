import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { channelNonce } from "@/lib/realtimeChannel";
import { report } from "@/lib/errorLogger";
import { hapticLight } from "@/lib/haptics";

/**
 * useMessageReactions — iMessage-style tapbacks for one open thread.
 *
 * Source of truth is `public.message_reactions` (migration 20260811120000).
 * One row per (message, user), so reacting again with a different emoji
 * REPLACES rather than stacks — matching iMessage, and enforced by the
 * table's primary key rather than by this hook.
 *
 * ── Why the subscription filters on job_id ─────────────────────────────
 * Supabase realtime filters are single-column. The useful scope here is
 * "reactions in the thread I have open", which is a JOB, not a user — so the
 * reactions table carries a denormalised `job_id` (set by a trigger, never by
 * the client). Filtering by reactor would miss the other participant, which is
 * the only person whose reactions we actually need pushed to us; leaving it
 * unfiltered would receive every reaction platform-wide, which CLAUDE.md
 * forbids outright.
 */

/** The six iMessage tapbacks. Must match the CHECK constraint on the table. */
export const TAPBACKS = ["❤️", "👍", "👎", "😂", "‼️", "❓"] as const;
export type Tapback = (typeof TAPBACKS)[number];

export interface Reaction {
  messageId: string;
  userId: string;
  emoji: string;
}

/** Reactions for one message, grouped for rendering. */
export interface MessageReactionSummary {
  /** Emoji → how many people used it, most-used first. */
  counts: { emoji: string; count: number }[];
  /** The viewer's own reaction, if any — drives the "selected" state. */
  mine: string | null;
}

function summarize(rows: Reaction[], viewerId: string | null): Map<string, MessageReactionSummary> {
  const byMessage = new Map<string, Reaction[]>();
  for (const r of rows) {
    const list = byMessage.get(r.messageId);
    if (list) list.push(r);
    else byMessage.set(r.messageId, [r]);
  }
  const out = new Map<string, MessageReactionSummary>();
  for (const [messageId, list] of byMessage) {
    const tally = new Map<string, number>();
    let mine: string | null = null;
    for (const r of list) {
      tally.set(r.emoji, (tally.get(r.emoji) ?? 0) + 1);
      if (viewerId && r.userId === viewerId) mine = r.emoji;
    }
    out.set(messageId, {
      counts: [...tally.entries()]
        .map(([emoji, count]) => ({ emoji, count }))
        .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji)),
      mine,
    });
  }
  return out;
}

/** True when the table isn't deployed yet — see pinnedConversations. */
function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  return code === "PGRST205" || code === "42P01";
}

export function useMessageReactions(jobId: string | null, viewerId: string | null) {
  const [rows, setRows] = useState<Reaction[]>([]);
  // Read through a ref inside the realtime handler so the subscription doesn't
  // need `rows` as a dependency — that would tear down and rebuild the channel
  // on every single reaction, which is both wasteful and racy.
  const rowsRef = useRef<Reaction[]>([]);
  rowsRef.current = rows;

  const load = useCallback(async () => {
    if (!jobId) { setRows([]); return; }
    const { data, error } = await supabase
      .from("message_reactions")
      .select("message_id, user_id, emoji")
      .eq("job_id", jobId);
    if (error) {
      // A not-yet-deployed table is expected and self-healing; anything else
      // is worth knowing about. Never swallowed silently either way.
      if (!isMissingTable(error)) {
        report(error, { severity: "warning", tags: { source: "useMessageReactions.load" } });
      }
      setRows([]);
      return;
    }
    setRows((data ?? []).map((r) => ({ messageId: r.message_id, userId: r.user_id, emoji: r.emoji })));
  }, [jobId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!jobId) return;
    // channelNonce: Supabase dedupes channels BY NAME, so a reused name
    // silently drops the second subscription (see CLAUDE.md).
    const channel = supabase
      .channel(`message_reactions:${jobId}:${channelNonce()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions", filter: `job_id=eq.${jobId}` },
        (payload) => {
          const next = payload.new as { message_id?: string; user_id?: string; emoji?: string } | null;
          const prev = payload.old as { message_id?: string; user_id?: string } | null;
          const key = (m?: string, u?: string) => `${m}::${u}`;
          const current = rowsRef.current;

          if (payload.eventType === "DELETE") {
            const gone = key(prev?.message_id, prev?.user_id);
            setRows(current.filter((r) => key(r.messageId, r.userId) !== gone));
            return;
          }
          if (!next?.message_id || !next.user_id || !next.emoji) return;
          const k = key(next.message_id, next.user_id);
          // INSERT and UPDATE collapse to the same operation because the PK
          // guarantees at most one row per (message, user): drop any existing
          // entry for that pair, then add the new one.
          setRows([
            ...current.filter((r) => key(r.messageId, r.userId) !== k),
            { messageId: next.message_id, userId: next.user_id, emoji: next.emoji },
          ]);
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [jobId]);

  /**
   * Apply, change, or clear the viewer's tapback on a message.
   *
   * Tapping the emoji you already have REMOVES it (iMessage behaviour), so the
   * same control both sets and unsets. Optimistic: a tapback is cheap and
   * reversible, and the round-trip would otherwise make it feel laggy. A
   * failed write rolls back so the UI stops showing a reaction nobody stored.
   */
  const react = useCallback(
    async (messageId: string, emoji: string) => {
      if (!viewerId) return;
      void hapticLight();
      const before = rowsRef.current;
      const existing = before.find((r) => r.messageId === messageId && r.userId === viewerId);
      const removing = existing?.emoji === emoji;

      setRows(
        removing
          ? before.filter((r) => !(r.messageId === messageId && r.userId === viewerId))
          : [
              ...before.filter((r) => !(r.messageId === messageId && r.userId === viewerId)),
              { messageId, userId: viewerId, emoji },
            ],
      );

      const { error } = removing
        ? await supabase
            .from("message_reactions")
            .delete()
            .eq("message_id", messageId)
            .eq("user_id", viewerId)
        : await supabase
            .from("message_reactions")
            // job_id is intentionally omitted — the BEFORE trigger derives it
            // from the parent message, so the client cannot get it wrong (or
            // point a reaction at a job it doesn't belong to).
            .upsert(
              // Cast: the regenerated types mark job_id required (NOT NULL),
              // but the BEFORE trigger fills it — the omission is the
              // security design, not an oversight (see comment above).
              { message_id: messageId, user_id: viewerId, emoji } as never,
              { onConflict: "message_id,user_id" },
            );

      if (error) {
        setRows(before);
        if (!isMissingTable(error)) {
          report(error, { severity: "warning", tags: { source: "useMessageReactions.react" } });
        }
      }
    },
    [viewerId],
  );

  return { reactions: summarize(rows, viewerId), react, reloadReactions: load };
}
