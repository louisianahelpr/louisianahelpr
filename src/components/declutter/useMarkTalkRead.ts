/**
 * B112 (B110 leftover 4, lead 11-01): an open Declutter chat marks the viewer's side read (markTalkRead), so the
 * unread reminders (sweep_declutter_talk_reminders: 15 minutes, then 2 hours) never chase a message the person has
 * already seen. Called on open and whenever the open chat shows a new message.
 * Guard: src/components/declutter/declutterOrderTalk.test.tsx "marks the chat read".
 */
import { useEffect } from "react";
import { markTalkRead } from "@/lib/declutter/talkRead";

export function useMarkTalkRead(kind: "order" | "handover", ref: string, messageCount: number | null) {
  useEffect(() => {
    if (messageCount === null) return;
    void markTalkRead(kind, ref);
  }, [kind, ref, messageCount]);
}
