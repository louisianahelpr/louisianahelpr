import { EscrowCheckoutError } from "@/lib/escrowCheckout";
import { QUOTE_ERROR_COPY } from "./errorCopy";

export { QUOTE_ERROR_COPY };

/** The member-facing words for a quote RPC failure (or the escrow checkout's refusal). */
export function quoteErrorMessage(err: unknown): string {
  if (err instanceof EscrowCheckoutError) return `Couldn't start payment: ${err.message}`;
  // The words src/lib/quotes/api.ts attached from RPC_ERROR_COPY at the call.
  const attached = (err as { userMessage?: unknown } | null)?.userMessage;
  if (typeof attached === "string" && attached) return attached;
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const code = raw.trim();
  if (QUOTE_ERROR_COPY[code]) return QUOTE_ERROR_COPY[code];
  if (/price_cents_check/.test(code)) return "Quotes are whole dollars from $10 to $1,000.";
  // The contact-leak trigger's sentence is written for the member already.
  if (/detected/i.test(code) && code.length < 300) return code;
  return "Something went wrong. Please try again.";
}
