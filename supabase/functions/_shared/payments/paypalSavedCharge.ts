/**
 * Charging a member's SAVED PayPal payment method with nobody present (PayPal Plan A, phase 6):
 * repeat visits and auto-tip. A vault token is saved at a checkout that asked for it
 * (store_in_vault ON_SUCCESS, MEASURED #11) and charged later as a merchant-initiated charge
 * (vault_id + stored_credential MERCHANT/UNSCHEDULED/SUBSEQUENT for a card, MEASURED #12;
 * payment_source.paypal.vault_id for a PayPal-wallet token).
 *
 * The Stripe-era safety properties, kept (auto-tip-charge / charge-recurring-visits headers):
 *   1. The money record is written BEFORE the charge. A provider_payments row in 'created' with
 *      no capture is recoverable and visible; a capture with no row is money nobody can account
 *      for. Its idempotency_key is UNIQUE, so two overlapping runs cannot both charge.
 *   2. The key is deterministic (subject + amount + attempt) and is ALSO PayPal's
 *      PayPal-Request-Id: a retry after a timeout replays the original order instead of charging
 *      again (sandbox 2026-10-23: same key, same order id). A re-price changes the key
 *      (`amt<cents>`), so an old price is never replayed.
 *   3. A 'created' row older than PAYPAL_REPLAY_WINDOW_MS is NOT re-sent: past PayPal's request-id
 *      memory a re-send could be a second charge. It is reported for a person to check instead.
 *   4. The switch: a provider_payments INSERT is refused in the database when paypal_payments is
 *      off for the payer (20261023223419); this module also asks first and refuses without a
 *      write. A saved method is charged only for the member who saved it, in the env it was
 *      saved in (paypal_saved_payment_methods, owned by that member through the payment that
 *      vaulted it).
 *
 * Zero Deno imports: vitest imports this directly. The database is behind SavedChargeStore.
 */
import { ProviderApiError, type CaptureResult, type PaymentProvider, type ProviderEnv, type VaultSource } from "./types.ts";

export type SavedChargeSubject = "tip" | "recurring_visit";

/**
 * How long a 'created' row may be re-sent with the same PayPal-Request-Id. PayPal documents
 * request-id retention for Orders as hours, not days (DOCS, not measured); three hours stays
 * well inside it. Past it, a person checks PayPal for the key before anything else happens.
 */
export const PAYPAL_REPLAY_WINDOW_MS = 3 * 60 * 60 * 1000;

export interface SavedMethod {
  id: string;
  userId: string;
  env: ProviderEnv;
  vaultId: string;
  source: VaultSource;
}

export interface SavedPaymentRow {
  id: string;
  idempotencyKey: string;
  status: string;
  amountCents: number;
  providerCaptureId: string | null;
  createdAtMs: number;
}

export interface SavedChargeStore {
  switchOnFor(userId: string): Promise<boolean>;
  activeMethod(userId: string, env: ProviderEnv): Promise<SavedMethod | null>;
  paymentByKey(idempotencyKey: string): Promise<SavedPaymentRow | null>;
  /** Insert the 'created' row. On a UNIQUE key clash returns the existing row. */
  insertPayment(row: { subjectKind: SavedChargeSubject; subjectId: string; payerId: string; env: ProviderEnv; idempotencyKey: string; amountCents: number }): Promise<SavedPaymentRow>;
  markCaptured(id: string, c: { providerOrderId: string; providerCaptureId: string; status: "captured" | "capture_pending" }): Promise<void>;
  markFailed(id: string): Promise<void>;
}

export interface SavedChargeDeps {
  store: SavedChargeStore;
  provider: Pick<PaymentProvider, "chargeSaved">;
  env: ProviderEnv;
  now?: () => number;
}

export interface SavedChargeInput {
  subjectKind: SavedChargeSubject;
  /** tips.id for a tip; visitSubjectId(parent, date) for a repeat visit. */
  subjectId: string;
  payerId: string;
  amountCents: number;
  /** 1 for the first try; a NEW attempt after a decline is a new key (the old row stays 'failed'). */
  attempt?: number;
}

export type SavedChargeOutcome =
  /** Captured and settled (COMPLETED). */
  | { outcome: "charged"; paymentId: string; captureId: string; amountCents: number }
  /** Captured but not settled (PENDING, e.g. an eCheck): NOT funded yet. */
  | { outcome: "pending"; paymentId: string; captureId: string }
  | { outcome: "switch_off" }
  | { outcome: "no_saved_method" }
  /** PayPal answered and refused: nothing was charged. */
  | { outcome: "declined"; paymentId: string; reason: string }
  /** Outcome unknown (timeout, 5xx): the row stays 'created'; the next run replays the same key. */
  | { outcome: "retry"; paymentId: string | null; reason: string }
  /** A person must look before anything else is charged for this subject. */
  | { outcome: "needs_review"; paymentId: string | null; reason: string };

export function savedChargeKey(i: { subjectKind: SavedChargeSubject; subjectId: string; amountCents: number; attempt?: number }): string {
  if (!Number.isInteger(i.amountCents) || i.amountCents <= 0) throw new Error(`amountCents must be a positive integer: ${i.amountCents}`);
  const attempt = i.attempt ?? 1;
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error(`attempt must be >= 1: ${attempt}`);
  return `lh:pp:${i.subjectKind}:${i.subjectId}:amt${i.amountCents}:a${attempt}`;
}

const DONE = new Set(["captured", "partially_refunded", "refunded", "disputed", "reversed"]);

export async function chargeSavedPayment(deps: SavedChargeDeps, input: SavedChargeInput): Promise<SavedChargeOutcome> {
  const now = deps.now ?? Date.now;
  const key = savedChargeKey(input);
  if (!(await deps.store.switchOnFor(input.payerId))) return { outcome: "switch_off" };

  let row = await deps.store.paymentByKey(key);
  if (row) {
    if (DONE.has(row.status)) {
      return { outcome: "charged", paymentId: row.id, captureId: row.providerCaptureId ?? "", amountCents: row.amountCents };
    }
    if (row.status === "capture_pending") return { outcome: "pending", paymentId: row.id, captureId: row.providerCaptureId ?? "" };
    if (row.status === "failed" || row.status === "voided") return { outcome: "declined", paymentId: row.id, reason: `earlier_attempt_${row.status}` };
    if (row.status !== "created") return { outcome: "needs_review", paymentId: row.id, reason: `unexpected_status_${row.status}` };
    if (now() - row.createdAtMs > PAYPAL_REPLAY_WINDOW_MS) {
      return { outcome: "needs_review", paymentId: row.id, reason: `created_past_replay_window: check PayPal for PayPal-Request-Id ${key} before charging again` };
    }
  }

  const method = await deps.store.activeMethod(input.payerId, deps.env);
  if (!method) {
    // A resumed 'created' row with no method left: nothing was charged that we know of.
    return row ? { outcome: "needs_review", paymentId: row.id, reason: "saved_method_gone_mid_charge" } : { outcome: "no_saved_method" };
  }

  row ??= await deps.store.insertPayment({
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    payerId: input.payerId,
    env: deps.env,
    idempotencyKey: key,
    amountCents: input.amountCents,
  });
  if (row.status !== "created") return chargeSavedPayment(deps, input); // a concurrent run finished it

  let cap: CaptureResult;
  try {
    cap = await deps.provider.chargeSaved({
      idempotencyKey: key,
      referenceId: row.id,
      vaultId: method.vaultId,
      amountCents: input.amountCents,
      vaultSource: method.source,
    });
  } catch (e) {
    if (e instanceof ProviderApiError && !e.retryable) {
      await deps.store.markFailed(row.id);
      return { outcome: "declined", paymentId: row.id, reason: `${e.issue ?? e.errorName ?? e.httpStatus}`.slice(0, 120) };
    }
    return { outcome: "retry", paymentId: row.id, reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
  await deps.store.markCaptured(row.id, {
    providerOrderId: cap.providerOrderId,
    providerCaptureId: cap.providerCaptureId,
    status: cap.settled ? "captured" : "capture_pending",
  });
  if (cap.amountCents !== input.amountCents) {
    return { outcome: "needs_review", paymentId: row.id, reason: `captured_amount_mismatch: asked ${input.amountCents}, PayPal captured ${cap.amountCents}` };
  }
  if (!cap.settled) return { outcome: "pending", paymentId: row.id, captureId: cap.providerCaptureId };
  return { outcome: "charged", paymentId: row.id, captureId: cap.providerCaptureId, amountCents: cap.amountCents };
}

/**
 * The provider_payments subject id of one repeat visit: a stable uuid from (series, date), so the
 * "one funded payment per subject" index holds per visit and a re-run finds the same row.
 */
export async function visitSubjectId(parentJobId: string, visitDate: string): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) throw new Error(`not a visit date: ${visitDate}`);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lh:visit:${parentJobId}:${visitDate}`)));
  const h = Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  // RFC 4122 shape (version 8 = custom, variant 10xx) so Postgres uuid accepts it.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ── The supabase twin of SavedChargeStore ───────────────────────────────────

// deno-lint-ignore no-explicit-any
type Db = any;

export function supabaseSavedChargeStore(db: Db): SavedChargeStore {
  const must = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };
  const toRow = (r: Record<string, unknown>): SavedPaymentRow => ({
    id: String(r.id),
    idempotencyKey: String(r.idempotency_key),
    status: String(r.status),
    amountCents: Number(r.amount_cents),
    providerCaptureId: (r.provider_capture_id as string | null) ?? null,
    createdAtMs: Date.parse(String(r.created_at)),
  });
  const COLS = "id, idempotency_key, status, amount_cents, provider_capture_id, created_at";
  return {
    async switchOnFor(userId) {
      const { data, error } = await db.rpc("feature_enabled_for_user", { p_key: "paypal_payments", p_user_id: userId });
      // Fail closed: an error is "off".
      return !error && data === true;
    },
    async activeMethod(userId, env) {
      const { data, error } = await db
        .from("paypal_saved_payment_methods")
        .select("id, user_id, env, vault_id, source")
        .eq("user_id", userId)
        .eq("env", env)
        .eq("status", "active")
        .maybeSingle();
      must("saved method read", error);
      return data ? { id: String(data.id), userId: String(data.user_id), env: data.env, vaultId: String(data.vault_id), source: data.source } : null;
    },
    async paymentByKey(key) {
      const { data, error } = await db.from("provider_payments").select(COLS).eq("idempotency_key", key).maybeSingle();
      must("provider_payments read", error);
      return data ? toRow(data) : null;
    },
    async insertPayment(r) {
      const { data, error } = await db
        .from("provider_payments")
        .insert({
          subject_kind: r.subjectKind,
          subject_id: r.subjectId,
          payer_id: r.payerId,
          provider: "paypal_checkout",
          env: r.env,
          idempotency_key: r.idempotencyKey,
          // NOT NULL + UNIQUE: the order does not exist until the charge; a key-named placeholder
          // keeps the row unique and is replaced by PayPal's order id on capture.
          provider_order_id: `pending:${r.idempotencyKey}`,
          amount_cents: r.amountCents,
          status: "created",
        })
        .select(COLS)
        .single();
      if (error?.code === "23505") {
        const again = await db.from("provider_payments").select(COLS).eq("idempotency_key", r.idempotencyKey).single();
        must("provider_payments re-read", again.error);
        return toRow(again.data);
      }
      must("provider_payments insert", error);
      return toRow(data);
    },
    async markCaptured(id, c) {
      const { data, error } = await db
        .from("provider_payments")
        .update({ provider_order_id: c.providerOrderId, provider_capture_id: c.providerCaptureId, status: c.status, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "created")
        .select("id");
      must("provider_payments capture write", error);
      if (!data || data.length === 0) throw new Error(`provider_payments capture write matched 0 rows (${id}): PayPal captured ${c.providerCaptureId}`);
    },
    async markFailed(id) {
      const { error } = await db.from("provider_payments").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "created");
      must("provider_payments failed write", error);
    },
  };
}

/**
 * Remember the token a checkout vaulted, for the member who paid that checkout (phase 3 calls
 * this after a capture with saveCard; the database checks the payment is theirs and captured).
 */
export async function rememberVaultedMethod(
  db: Db,
  r: { userId: string; env: ProviderEnv; vaultId: string; source: VaultSource; fromPaymentId: string },
): Promise<void> {
  // One active method per member and env: an older one is retired first.
  const { error: retireErr } = await db
    .from("paypal_saved_payment_methods")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("user_id", r.userId)
    .eq("env", r.env)
    .eq("status", "active")
    .neq("vault_id", r.vaultId);
  if (retireErr) throw new Error(`saved method retire: ${retireErr.message}`);
  const { error } = await db.from("paypal_saved_payment_methods").insert({
    user_id: r.userId, env: r.env, vault_id: r.vaultId, source: r.source, from_payment_id: r.fromPaymentId,
  });
  if (error && error.code !== "23505") throw new Error(`saved method insert: ${error.message}`);
}

/** VAULT.PAYMENT-TOKEN.DELETED (or a member removing it): the token is never charged again. */
export async function revokeVaultedMethod(db: Db, env: ProviderEnv, vaultId: string): Promise<void> {
  const { error } = await db
    .from("paypal_saved_payment_methods")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("env", env)
    .eq("vault_id", vaultId)
    .eq("status", "active");
  if (error) throw new Error(`saved method revoke: ${error.message}`);
}
