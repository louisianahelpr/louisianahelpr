// What a person is told when `complete-signup` fails.
//
// This runs at the single worst moment in the funnel. `supabase.auth.signUp`
// has already returned, so the auth account EXISTS and cannot be un-made by
// retrying; the profile behind it does not. Every sentence here therefore has
// two jobs: say that the account is real, and say the one thing that gets the
// person the rest of the way (log in — which is exactly what the edge function
// itself says on the paths where it has an opinion).
//
// WHAT WAS THERE BEFORE
//   if (fnError) throw new Error(fnError.message || "We couldn't save your signup details.");
//
// `fnError.message` is NEVER empty and never ours: supabase-js sets it to one
// of three fixed strings and puts our actual response body somewhere else
// entirely. So the `||` never reached the human copy — the same "reads like a
// safety net, is the opposite" shape userFacingError's docstring describes —
// and the person got a transport wrapper. Suppressing that wrapper (ed372fab5)
// stopped the leak but left the other half: complete-signup answers 4xx/5xx
// with sentences it wrote for a human ("Signup completion window expired.
// Please log in to finish your profile.", "You must be at least 18 years old
// to use Helpr.") and not one of them has ever been shown, because invoke
// hands back the wrapper and drops the body into `error.context`.
//
// So this classifies rather than echoes, and on the one shape that CARRIES our
// copy it goes and gets it.

import { userFacingError } from "@/lib/userFacingError";

/**
 * The account is made; something after it was not. Used for every failure we
 * cannot say anything more specific about.
 */
export const SIGNUP_SAVED_ACCOUNT_ONLY =
  "Your account is created, but your details didn't save. Log in to finish your profile.";

/**
 * Same situation, plus the one cause the person can act on themselves.
 */
export const SIGNUP_SAVED_ACCOUNT_ONLY_OFFLINE =
  "Your account is created, but your details didn't save — the connection dropped. Log in to finish your profile.";

/** Duck-typed `FunctionsHttpError.context`: the unread `Response`. */
type ErrorBodyCarrier = { context?: { json?: () => unknown } };

/**
 * Pull the `error` sentence out of a non-2xx response body, or null.
 *
 * `invoke` throws before reading the body, so it is still there to be read.
 * Everything here is best-effort — a body that is missing, is not JSON, or
 * carries no string `error` is not worth a second failure on top of the first.
 */
async function bodyMessage(err: unknown): Promise<string | null> {
  const json = (err as ErrorBodyCarrier | null)?.context?.json;
  if (typeof json !== "function") return null;
  try {
    const body = await json.call((err as ErrorBodyCarrier).context);
    const message = (body as { error?: unknown } | null)?.error;
    return typeof message === "string" && message.trim() ? message.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The sentence to show for an error returned by
 * `supabase.functions.invoke("complete-signup")`.
 *
 * Classified by `err.name` rather than `instanceof`: the name is set in the
 * FunctionsError constructor and survives bundling, and it lets this be tested
 * with plain objects. `invoke` can produce these three and nothing else, so the
 * default arm is unreachable in practice — it still refuses to echo, because a
 * shape we cannot name is the last shape whose text we should trust.
 */
export async function completeSignupErrorCopy(err: unknown): Promise<string> {
  const name = (err as { name?: unknown } | null)?.name;

  switch (name) {
    // The function answered, with a status we did not want. Our own sentence
    // is in the body — show it, filtered, so a 500's stack or a gateway's HTML
    // cannot ride in on the same path.
    case "FunctionsHttpError": {
      const message = await bodyMessage(err);
      return message
        ? userFacingError(message, SIGNUP_SAVED_ACCOUNT_ONLY)
        : SIGNUP_SAVED_ACCOUNT_ONLY;
    }

    // The fetch never landed: offline, DNS, TLS, abort. The only one of the
    // three the person can do anything about, so it gets the extra clause.
    case "FunctionsFetchError":
      return SIGNUP_SAVED_ACCOUNT_ONLY_OFFLINE;

    // Supabase's relay failed in front of the function. Nothing to read and
    // nothing the person can do differently.
    case "FunctionsRelayError":
      return SIGNUP_SAVED_ACCOUNT_ONLY;

    default:
      return SIGNUP_SAVED_ACCOUNT_ONLY;
  }
}
