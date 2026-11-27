/**
 * "Hire me" on a Helpr's public page /u/<handle> (owner 2026-11-04 8:31 AM, OWNER-DECISIONS: "'Hire me' on every
 * Helpr's page; link -> Hire me -> creates the listing offered to that Helpr; free for everyone").
 *
 * The tap opens Post a job with a direct offer to that Helpr already set (?offerTo=<id>): the same offer, payment,
 * hold and protections as any job, the Helpr accepts or passes, and a pass or no answer opens it to everyone
 * (expire_pending_direct_offers). No plan or membership is involved anywhere.
 *
 * The public page never carries a user id, so a signed-in member's tap asks rpc_hire_target_by_handle
 * (20261104143437) for it; that read refuses a banned caller, your own page, a hidden page and a blocked pair.
 * A guest goes through signup (or its Log in link) and comes back to the page with ?hire=1, which continues the tap.
 */
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { signupUrlFor } from "@/lib/jobIntent";

/** The query flag that continues a guest's tap after signup or log in. */
export const HIRE_PARAM = "hire";

/** Each code rpc_hire_target_by_handle raises, in plain words (src/test/rpcErrorCopyCoverage.test.ts, both ways). */
export const HIRE_ME_RPC_ERROR_COPY = {
  rpc_hire_target_by_handle: {
    not_signed_in: "Sign in to offer this Helpr a job.",
    account_restricted: "Your account can't post jobs right now.",
    hire_self: "This is your own page.",
    hire_unavailable: "You can't offer this person a job right now.",
  },
} satisfies Record<string, Record<string, string>>;

type HireMeRpc = keyof typeof HIRE_ME_RPC_ERROR_COPY;

/** Words for an error the hire read returned, or null when it is not one of its codes (whole-token match). */
function rpcErrorMessage(rpc: HireMeRpc, error: unknown): string | null {
  const m = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof m === "string" ? m : "";
  if (!raw) return null;
  const table: Record<string, string> = HIRE_ME_RPC_ERROR_COPY[rpc];
  for (const code of Object.keys(table).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}

const GENERIC = "We couldn't start that offer. Check your connection and try again.";
const NOT_YET = "Hiring from a profile isn't available yet. Try again soon.";

/** Post a job with a direct offer to this Helpr already set. */
export function hireOfferPath(userId: string): string {
  return `/post-job?offerTo=${encodeURIComponent(userId)}`;
}

/** Where a guest's "Hire me" goes: signup, then back to this page, which continues the tap. */
export function hireGuestHref(handle: string): string {
  return signupUrlFor(`/u/${encodeURIComponent(handle)}?${HIRE_PARAM}=1`);
}

/** The Helpr's user id for a direct offer, or the words to show. */
export async function hireTargetByHandle(handle: string): Promise<{ id: string; error?: undefined } | { id?: undefined; error: string }> {
  const { data, error } = await supabase.rpc("rpc_hire_target_by_handle", { p_handle: handle });
  if (error) {
    if (isMissingRpcNamed(error, "rpc_hire_target_by_handle")) return { error: NOT_YET };
    return { error: rpcErrorMessage("rpc_hire_target_by_handle", error) ?? GENERIC };
  }
  return typeof data === "string" && data ? { id: data } : { error: GENERIC };
}
