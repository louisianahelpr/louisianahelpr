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
 *      (`amt<cents>`), so an old price is never replayed, AND every row of the subject is read
 *      before any charge: a funded row is adopted, an open one at another price stops for a
 *      person (lh-money-escrow review, #2). The row id is the order's invoice_id, so PayPal
 *      itself refuses a second order for one row (DUPLICATE_INVOICE_ID), past request-id memory.
 *   2b. A decline stands until the member saves a new method (then one new attempt); the
 *      member is told about each decline once.
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
  /** When the member saved it: a decline is retried only on a method saved AFTER it. */
  createdAtMs: number;
}

export interface SavedPaymentRow {
  id: string;
  idempotencyKey: string;
  status: string;
  amountCents: number;
  providerOrderId: string;
  providerCaptureId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SavedChargeStore {
  /** The switch for this payer. An Error = could not tell (never read as "off" or "on"). */
  switchOnFor(userId: string): Promise<boolean | Error>;
  activeMethod(userId: string, env: ProviderEnv): Promise<SavedMethod | null>;
  /** EVERY money row for this subject, whatever its key or amount (a re-price is not a new subject). */
  paymentsForSubject(subjectKind: SavedChargeSubject, subjectId: string): Promise<SavedPaymentRow[]>;
  /** Insert the 'created' row. On a UNIQUE key clash returns the existing row. */
  insertPayment(row: { subjectKind: SavedChargeSubject; subjectId: string; payerId: string; env: ProviderEnv; idempotencyKey: string; amountCents: number }): Promise<SavedPaymentRow>;
  markCaptured(id: string, c: { providerOrderId: string; providerCaptureId: string; status: "captured" | "capture_pending" }): Promise<void>;
  /**
   * PayPal captured a different amount than we asked: record its order and capture ids but keep
   * the row 'created' (never funded), so no later run, sweep or booking treats it as paid.
   */
  markCaptureMismatch(id: string, c: { providerOrderId: string; providerCaptureId: string }): Promise<void>;
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
  /** visitSubjectId(parent, date) for a repeat visit. */
  subjectId: string;
  payerId: string;
  amountCents: number;
}

export type SavedChargeOutcome =
  /** Captured and settled (COMPLETED), now or by an earlier run. */
  | { outcome: "charged"; paymentId: string; orderId: string; captureId: string; amountCents: number }
  /** Captured but not settled (PENDING, e.g. an eCheck): NOT funded yet. */
  | { outcome: "pending"; paymentId: string; captureId: string }
  | { outcome: "switch_off" }
  | { outcome: "no_saved_method" }
  /**
   * PayPal refused: nothing was charged. `fresh` is true only for THIS run's decline; a decline an
   * earlier run already told the member about is not fresh (no second notice), and is retried
   * only once they save a new method.
   */
  | { outcome: "declined"; paymentId: string; reason: string; fresh: boolean }
  /** A read failed before anything was written or sent: nothing happened; try next run. */
  | { outcome: "unreadable"; reason: string }
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
const DEAD = new Set(["failed", "voided"]);

export async function chargeSavedPayment(deps: SavedChargeDeps, input: SavedChargeInput): Promise<SavedChargeOutcome> {
  const now = deps.now ?? Date.now;
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error(`amountCents must be a positive integer: ${input.amountCents}`);

  // ── Reads only: a failure here has changed nothing anywhere. ──
  let rows: SavedPaymentRow[];
  let method: SavedMethod | null;
  try {
    const sw = await deps.store.switchOnFor(input.payerId);
    if (sw instanceof Error) return { outcome: "unreadable", reason: `switch read: ${sw.message}` };
    if (!sw) return { outcome: "switch_off" };
    rows = await deps.store.paymentsForSubject(input.subjectKind, input.subjectId);
    method = await deps.store.activeMethod(input.payerId, deps.env);
  } catch (e) {
    return { outcome: "unreadable", reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }

  // ── What this subject already has, at ANY amount ──
  const funded = rows.find((r) => DONE.has(r.status));
  if (funded) {
    // Adopt it. A funded row at another price is never topped up or charged again: a person decides.
    if (funded.amountCents !== input.amountCents) {
      return { outcome: "needs_review", paymentId: funded.id, reason: `funded_at_other_amount: ${funded.amountCents} paid, ${input.amountCents} asked` };
    }
    return { outcome: "charged", paymentId: funded.id, orderId: funded.providerOrderId, captureId: funded.providerCaptureId ?? "", amountCents: funded.amountCents };
  }
  const pendingCap = rows.find((r) => r.status === "capture_pending");
  if (pendingCap) return { outcome: "pending", paymentId: pendingCap.id, captureId: pendingCap.providerCaptureId ?? "" };
  const open = rows.find((r) => !DONE.has(r.status) && !DEAD.has(r.status));
  let row: SavedPaymentRow | null = null;
  if (open) {
    if (open.status !== "created") return { outcome: "needs_review", paymentId: open.id, reason: `unexpected_status_${open.status}` };
    if (open.providerCaptureId) return { outcome: "needs_review", paymentId: open.id, reason: "captured_amount_mismatch_recorded: PayPal captured a different amount; settle by hand" };
    // An unknown outcome at another price: never a second order beside it.
    if (open.amountCents !== input.amountCents) {
      return { outcome: "needs_review", paymentId: open.id, reason: `open_charge_at_other_amount: ${open.amountCents} in flight, ${input.amountCents} asked` };
    }
    if (now() - open.createdAtMs > PAYPAL_REPLAY_WINDOW_MS) {
      return { outcome: "needs_review", paymentId: open.id, reason: `created_past_replay_window: check PayPal for PayPal-Request-Id ${open.idempotencyKey} (invoice ${open.id}) before charging again` };
    }
    row = open;
  }

  if (!method) {
    // A resumed 'created' row with no method left: nothing was charged that we know of.
    return row ? { outcome: "needs_review", paymentId: row.id, reason: "saved_method_gone_mid_charge" } : { outcome: "no_saved_method" };
  }

  if (!row) {
    // A decline is retried only on a method saved after it (the member fixed it); else it stands.
    const dead = rows.filter((r) => DEAD.has(r.status));
    const lastDeadMs = Math.max(0, ...dead.map((r) => r.updatedAtMs));
    if (dead.length > 0 && !(method.createdAtMs > lastDeadMs)) {
      const last = dead.reduce((a, b) => (b.updatedAtMs > a.updatedAtMs ? b : a));
      return { outcome: "declined", paymentId: last.id, reason: `earlier_attempt_${last.status}`, fresh: false };
    }
    try {
      row = await deps.store.insertPayment({
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        payerId: input.payerId,
        env: deps.env,
        idempotencyKey: savedChargeKey({ ...input, attempt: dead.length + 1 }),
        amountCents: input.amountCents,
      });
    } catch (e) {
      // Nothing was sent to PayPal: this is a refused or failed write, not an unknown charge.
      return { outcome: "unreadable", reason: `payment row insert: ${(e instanceof Error ? e.message : String(e)).slice(0, 180)}` };
    }
    if (row.status !== "created") return { outcome: "needs_review", paymentId: row.id, reason: `concurrent_run_left_${row.status}` };
  }

  let cap: CaptureResult;
  try {
    cap = await deps.provider.chargeSaved({
      idempotencyKey: row.idempotencyKey,
      // Also PayPal's invoice_id: a second order for this row is refused (DUPLICATE_INVOICE_ID).
      referenceId: row.id,
      vaultId: method.vaultId,
      amountCents: row.amountCents,
      vaultSource: method.source,
    });
  } catch (e) {
    if (e instanceof ProviderApiError && e.issue === "DUPLICATE_INVOICE_ID") {
      // PayPal already has an order for this row: never "declined", never charged again.
      return { outcome: "needs_review", paymentId: row.id, reason: "duplicate_invoice: PayPal already has an order for this payment row; find it by invoice id" };
    }
    if (e instanceof ProviderApiError && !e.retryable) {
      await deps.store.markFailed(row.id);
      return { outcome: "declined", paymentId: row.id, reason: `${e.issue ?? e.errorName ?? e.httpStatus}`.slice(0, 120), fresh: true };
    }
    return { outcome: "retry", paymentId: row.id, reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
  if (cap.amountCents !== row.amountCents) {
    await deps.store.markCaptureMismatch(row.id, { providerOrderId: cap.providerOrderId, providerCaptureId: cap.providerCaptureId });
    return { outcome: "needs_review", paymentId: row.id, reason: `captured_amount_mismatch: asked ${row.amountCents}, PayPal captured ${cap.amountCents}` };
  }
  await deps.store.markCaptured(row.id, {
    providerOrderId: cap.providerOrderId,
    providerCaptureId: cap.providerCaptureId,
    status: cap.settled ? "captured" : "capture_pending",
  });
  if (!cap.settled) return { outcome: "pending", paymentId: row.id, captureId: cap.providerCaptureId };
  return { outcome: "charged", paymentId: row.id, orderId: cap.providerOrderId, captureId: cap.providerCaptureId, amountCents: cap.amountCents };
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
    providerOrderId: String(r.provider_order_id),
    providerCaptureId: (r.provider_capture_id as string | null) ?? null,
    createdAtMs: Date.parse(String(r.created_at)),
    updatedAtMs: Date.parse(String(r.updated_at ?? r.created_at)),
  });
  const COLS = "id, idempotency_key, status, amount_cents, provider_order_id, provider_capture_id, created_at, updated_at";
  return {
    async switchOnFor(userId) {
      const { data, error } = await db.rpc("feature_enabled_for_user", { p_key: "paypal_payments", p_user_id: userId });
      // Fail closed, but loudly: an error is "could not tell", never a silent "off".
      if (error) return new Error(error.message);
      return data === true;
    },
    async activeMethod(userId, env) {
      const { data, error } = await db
        .from("paypal_saved_payment_methods")
        .select("id, user_id, env, vault_id, source, created_at")
        .eq("user_id", userId)
        .eq("env", env)
        .eq("status", "active")
        .maybeSingle();
      must("saved method read", error);
      return data ? { id: String(data.id), userId: String(data.user_id), env: data.env, vaultId: String(data.vault_id), source: data.source, createdAtMs: Date.parse(String(data.created_at)) } : null;
    },
    async paymentsForSubject(kind, id) {
      const { data, error } = await db.from("provider_payments").select(COLS).eq("subject_kind", kind).eq("subject_id", id);
      must("provider_payments read", error);
      return ((data ?? []) as Array<Record<string, unknown>>).map(toRow);
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
    async markCaptureMismatch(id, c) {
      const { data, error } = await db
        .from("provider_payments")
        .update({ provider_order_id: c.providerOrderId, provider_capture_id: c.providerCaptureId, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "created")
        .select("id");
      must("provider_payments mismatch write", error);
      if (!data || data.length === 0) throw new Error(`provider_payments mismatch write matched 0 rows (${id}): PayPal captured ${c.providerCaptureId}`);
    },
    async markFailed(id) {
      const { data, error } = await db.from("provider_payments").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "created").select("id");
      must("provider_payments failed write", error);
      if (!data || data.length === 0) throw new Error(`provider_payments failed write matched 0 rows (${id})`);
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
