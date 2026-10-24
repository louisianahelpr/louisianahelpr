/**
 * VAULT.PAYMENT-TOKEN.DELETED (phase 6): the payer (or PayPal) removed a saved method, so it is
 * retired at once (paypal_saved_payment_methods active -> revoked) and no repeat visit or
 * auto-tip is ever charged to it again. Deno-free so vitest runs it; webhook/vaultEvents.ts maps
 * the answer onto the dispatcher's Final / Retry outcomes.
 *
 * Idempotent: a token already revoked, or one never saved here, is "done" with nothing changed.
 */
import type { ProviderEnv } from "./types.ts";

/** The vault token id out of a verified event (resource.id). */
export function vaultTokenIdOf(payload: unknown): string | null {
  const id = (payload as { resource?: { id?: unknown } } | null)?.resource?.id;
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

export type VaultRevokeAnswer =
  | { kind: "done"; note: string }
  /** Nothing to do now or later (no token id in the event). */
  | { kind: "final"; note: string }
  /** The database did not answer: PayPal must redeliver. */
  | { kind: "retry"; note: string };

// deno-lint-ignore no-explicit-any
type Db = any;

export async function revokeDeletedVaultToken(db: Db, env: ProviderEnv, payload: unknown, now: () => Date = () => new Date()): Promise<VaultRevokeAnswer> {
  const vaultId = vaultTokenIdOf(payload);
  if (!vaultId) return { kind: "final", note: "vault event without a token id" };
  const { data, error } = await db
    .from("paypal_saved_payment_methods")
    .update({ status: "revoked", revoked_at: now().toISOString() })
    .eq("env", env)
    .eq("vault_id", vaultId)
    .eq("status", "active")
    .select("id");
  if (error) return { kind: "retry", note: `saved method revoke failed: ${error.message}` };
  return (data ?? []).length > 0
    ? { kind: "done", note: `revoked saved method for token ${vaultId}` }
    : { kind: "done", note: `token ${vaultId} not active here (already revoked or never saved)` };
}
