/**
 * The member's shareable profile link (LEAD-PROFILE-LINK, owner 2026-10-31 ~10:50 PM:
 * "Every member gets one shareable profile link (e.g. louisianahelpr.com/u/<handle>)").
 *
 * The handle is server-owned (20261101034834): made from the member's public name the first time
 * it is needed (rpc_ensure_my_handle), and changeable once (rpc_set_my_handle). Both calls read
 * their refusals' words through ./errorCopy.
 */
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { shareNative, type ShareOutcome } from "@/lib/nativeShare";
import { rpcErrorMessage } from "./errorCopy";

/** What a caller shows when a call fails: the code's words, or a plain fallback. */
export type HandleResult = { handle: string; error?: undefined } | { handle?: undefined; error: string };

/** The published site (same origin as the Book me and shop links): a link copied in the app opens the website. */
const SITE_ORIGIN = "https://www.louisianahelpr.com";

const NOT_YET = "Profile links aren't available yet. Try again soon.";
const GENERIC = "We couldn't load your profile link. Check your connection and try again.";

/** The same rule the server checks (profiles_handle_format), so the field can say so before a round trip. */
export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$/;

/** "eli-b" -> "https://www.louisianahelpr.com/u/eli-b". */
export function profileLinkUrl(handle: string): string {
  return `${SITE_ORIGIN}/u/${encodeURIComponent(handle)}`;
}

/** "eli-b" -> "louisianahelpr.com/u/eli-b": the link as a person reads it. */
export function profileLinkLabel(handle: string): string {
  return `louisianahelpr.com/u/${handle}`;
}

/** The caller's handle, made from their name the first time. */
export async function ensureMyHandle(): Promise<HandleResult> {
  const { data, error } = await supabase.rpc("rpc_ensure_my_handle");
  if (error) {
    if (isMissingRpcNamed(error, "rpc_ensure_my_handle")) return { error: NOT_YET };
    return { error: rpcErrorMessage("rpc_ensure_my_handle", error) ?? GENERIC };
  }
  return typeof data === "string" && data ? { handle: data } : { error: GENERIC };
}

/** Pick your own handle (once). */
export async function setMyHandle(next: string): Promise<HandleResult> {
  const { data, error } = await supabase.rpc("rpc_set_my_handle", { p_handle: next });
  if (error) {
    if (isMissingRpcNamed(error, "rpc_set_my_handle")) return { error: NOT_YET };
    return { error: rpcErrorMessage("rpc_set_my_handle", error) ?? "We couldn't save that link. Try again." };
  }
  return typeof data === "string" && data ? { handle: data } : { error: GENERIC };
}

/**
 * Share my profile: the OS share sheet on iOS/Android, the Web Share API where a browser has one,
 * else the link is copied with a visible confirmation (shareNative's ladder).
 */
export function shareMyProfile(handle: string, name?: string | null): Promise<ShareOutcome> {
  const who = (name ?? "").trim();
  return shareNative({
    title: who ? `${who} on Louisiana Helpr` : "My Louisiana Helpr profile",
    text: who ? `See what ${who} posts and does on Louisiana Helpr.` : "See what I post and do on Louisiana Helpr.",
    url: profileLinkUrl(handle),
    dialogTitle: "Share my profile",
  });
}
