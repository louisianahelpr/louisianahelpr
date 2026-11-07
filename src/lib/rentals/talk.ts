/**
 * Homes messages (audit 11-05 A-H1, docs/NOT-LAUNCHED.md Q2209; server 20261106182837_homes_talk, report + export
 * 20261106191100). One thread per listing and member. The server is the protection: nobody reads or writes the
 * tables directly; rentals_talk_view returns only the caller's own thread (each message theirs or not, the other
 * side's first name, never a person's id), and rentals_send_talk_message runs the contact-leak filter (owner Q49:
 * phone numbers and emails stay out), the block check, 30 an hour and a notice without the words.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rentalsErrorMessage } from "./copy";
import { HOME_TALK_ERROR_COPY, rpcErrorMessage } from "./talkRpcErrorCopy";

// The words, per RPC, live in ./talkRpcErrorCopy (rpcErrorCopyCoverage reads them there).
export { HOME_TALK_ERROR_COPY };

/** The contact-leak trigger (reject_contact_leak_in_home_talk) raises a sentence written for the member; it is shown as it is. */
const LEAK_SENTENCE = /does not allow contact details in Homes messages\.$/;

export function homeTalkErrorMessage(err: unknown): string {
  // The call site's own words for its RPC (rpcData below), when it named one.
  const own = err && typeof err === "object" && "userMessage" in err ? (err as { userMessage: unknown }).userMessage : null;
  if (typeof own === "string" && own) return own;
  const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message).trim() : "";
  if (LEAK_SENTENCE.test(msg)) return msg;
  return HOME_TALK_ERROR_COPY[msg] ?? rentalsErrorMessage(err);
}

function rpcData<T>(result: { data: T; error: { message: string } | null }, words: (e: unknown) => string | null = () => null): T {
  if (!result.error) return result.data;
  try {
    unwrap(result);
  } catch (thrown) {
    const e = thrown as Error & { userMessage?: string };
    if (Object.isExtensible(e)) e.userMessage = words(result.error) ?? homeTalkErrorMessage(result.error);
    throw e;
  }
  return result.data;
}

interface HomeTalkMessage {
  id: string;
  mine: boolean;
  body: string;
  created_at: string;
}

interface HomeTalkView {
  talk_id: string;
  listing_id: string;
  listing_headline: string;
  listing_kind: "rent" | "sale";
  side: "member" | "owner";
  /** The owner's first name for the member; the member's first name for the owner (fair housing: nothing more). */
  other_label: string;
  /** False while the listing is not live, paused or leased, or either side has blocked the other. */
  open: boolean;
  messages: HomeTalkMessage[];
}

export interface HomeTalkRow {
  talk_id: string;
  listing_id: string;
  listing_headline: string;
  side: "member" | "owner";
  other_label: string;
  last_at: string;
  last_mine: boolean;
  unread: boolean;
}

export const MY_HOME_TALKS_KEY = ["rentals", "my-talks"] as const;

/** The caller's thread about a listing, made on first use (never on your own listing). */
export async function openHomeTalk(listingId: string): Promise<string> {
  return rpcData(await supabase.rpc("rentals_open_talk", { p_listing_id: listingId }), (e) => rpcErrorMessage("rentals_open_talk", e)) as string;
}

export async function fetchHomeTalk(talkId: string): Promise<HomeTalkView> {
  return rpcData(await supabase.rpc("rentals_talk_view", { p_talk_id: talkId }), (e) => rpcErrorMessage("rentals_talk_view", e)) as unknown as HomeTalkView;
}

/** Send one message. A message with contact details is refused by the server's filter (its words are shown). */
export async function sendHomeTalkMessage(talkId: string, body: string): Promise<string> {
  return rpcData(await supabase.rpc("rentals_send_talk_message", { p_talk_id: talkId, p_body: body }), (e) => rpcErrorMessage("rentals_send_talk_message", e)) as string;
}

/** The caller's threads, both sides, newest first (at most 50). */
export async function fetchMyHomeTalks(): Promise<HomeTalkRow[]> {
  return (rpcData(await supabase.rpc("rentals_my_talks"), (e) => rpcErrorMessage("rentals_my_talks", e)) ?? []) as unknown as HomeTalkRow[];
}

/** Runs in the background; a failure only leaves the thread bold (HomeTalk), so no words are read here. */
export async function markHomeTalkRead(talkId: string): Promise<void> {
  rpcData(await supabase.rpc("rentals_mark_talk_read", { p_talk_id: talkId }));
}

/** Audit 11-05 D-M1 (owner row 33): for-sale closings are a prime target for wire scams. */
export const WIRE_FRAUD_LINE = "Never wire money from a message. Call your title company at a number you looked up yourself.";
