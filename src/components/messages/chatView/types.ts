import type { Message } from "../types";
import type { JobSystemEvent } from "@/lib/jobSystemEvents";

// Merge messages and system events into a single chronological
// timeline so a state-change row ("Helper marked complete") sits
// exactly where it happened relative to the surrounding chat. Each
// row carries a discriminator (`type`) so the renderer can branch
// between a real bubble and a styled <div>. System events get
// hidden behind older-message pagination: only those whose `at` is
// newer than the oldest loaded message (or all of them when nothing
// is paginated) are surfaced — keeps the chronological invariant.
export type TimelineItem =
  | { type: "message"; key: string; at: string; message: Message }
  | { type: "system"; key: string; at: string; event: JobSystemEvent }
  | { type: "date"; key: string; at: string; label: string };
