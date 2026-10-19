/**
 * Homes rent tracker, PAY DIRECT (owner D2/D10/D11; R1-R5 in
 * docs/specs/landlord-hub-prep.md; 20261019073106). No money moves through the
 * app: the tenant pays the landlord directly and both sides keep ONE record.
 * Every write is an RPC (the tables have no client write privilege); the record
 * is read through rentals_rent_ledger, which answers only the tenancy's two sides.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { RentalsCopyError } from "./copy";

export type RentFrequency = "weekly" | "biweekly" | "monthly";
export type PayMethod = "zelle" | "venmo" | "cashapp" | "cash" | "check" | "money_order";
export type PaymentMethod = PayMethod | "other";

export const RENT_FREQUENCIES: ReadonlyArray<{ value: RentFrequency; label: string }> = [
  { value: "monthly", label: "Every month" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "weekly", label: "Every week" },
];

export const PAY_METHOD_LABEL: Record<PaymentMethod, string> = {
  zelle: "Zelle",
  venmo: "Venmo",
  cashapp: "Cash App",
  cash: "Cash",
  check: "Check",
  money_order: "Money order",
  other: "Other",
};
export const PAY_METHODS = Object.keys(PAY_METHOD_LABEL).filter((m) => m !== "other") as PayMethod[];

export interface RentPlan {
  amount_cents: number;
  frequency: RentFrequency;
  first_due_on: string;
  grace_days: number;
  late_fee_cents: number;
  pay_methods: PayMethod[];
  next_due_on: string | null;
}
export interface RentCharge {
  id: string;
  kind: "rent" | "late_fee";
  due_on: string;
  amount_cents: number;
  waived: boolean;
}
export interface RentPayment {
  id: string;
  amount_cents: number;
  paid_on: string;
  method: PaymentMethod;
  reported_by: "tenant" | "landlord";
  status: "reported" | "confirmed" | "declined" | "reversed";
  decline_reason: string | null;
  decided_at: string | null;
  /** The landlord's changes within 30 days of confirming, oldest first (lead review #7). */
  corrections: RentCorrection[];
  /** Set while the landlord may still correct or reverse it. */
  correctable_until: string | null;
  /** The tenant's disputes, oldest first: one per decline and one per later change. */
  disputes: Array<{ at: string; reason: string }>;
}
export interface RentCorrection {
  at: string;
  action: "edit" | "reverse";
  reason: string;
  from: { amount_cents: number; paid_on: string };
  to?: { amount_cents: number; paid_on: string };
}
export interface RentLedger {
  side: "tenant" | "landlord";
  tenancy_status: "active" | "ended";
  lease_ends_on: string | null;
  /** Writes stay open while live and for 90 days after the end (then read-only). */
  open: boolean;
  open_until: string | null;
  home: { label: string; unit_label: string; city: string; zip_code: string } | null;
  plan: RentPlan | null;
  balance_cents: number;
  charges: RentCharge[];
  payments: RentPayment[];
}

export async function fetchRentLedger(tenancyId: string): Promise<RentLedger> {
  const { data, error } = await supabase.rpc("rentals_rent_ledger", { p_tenancy_id: tenancyId });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_rent_ledger", error), error);
  const l = (data ?? {}) as unknown as Partial<RentLedger>;
  return {
    side: l.side === "landlord" ? "landlord" : "tenant",
    tenancy_status: l.tenancy_status === "ended" ? "ended" : "active",
    lease_ends_on: l.lease_ends_on ?? null,
    open: l.open ?? false,
    open_until: l.open_until ?? null,
    home: l.home ?? null,
    plan: l.plan ?? null,
    balance_cents: l.balance_cents ?? 0,
    charges: l.charges ?? [],
    payments: (l.payments ?? []).map((p) => ({ ...p, corrections: p.corrections ?? [], correctable_until: p.correctable_until ?? null,
      disputes: p.disputes ?? [] })),
  };
}

export interface RentPlanInput {
  amount_cents: number;
  frequency: RentFrequency;
  first_due_on: string;
  grace_days: number;
  late_fee_cents: number;
  pay_methods: PayMethod[];
  /** Optional; a new one is at least 30 days out (the landlord sees a moved-out tenant's address only after it). */
  lease_ends_on: string | null;
}

export async function setRentPlan(tenancyId: string, plan: RentPlanInput): Promise<void> {
  const { error } = await supabase.rpc("rentals_set_rent_plan", { p_tenancy_id: tenancyId, p_fields: plan as unknown as Json });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_set_rent_plan", error), error);
}

/** The tenant's "I paid" (waits for the landlord) or the landlord's record (confirmed at once). */
export async function addRentPayment(tenancyId: string, amountCents: number, paidOn: string, method: PaymentMethod): Promise<string> {
  const { data, error } = await supabase.rpc("rentals_add_rent_payment", {
    p_tenancy_id: tenancyId,
    p_amount_cents: amountCents,
    p_paid_on: paidOn,
    p_method: method,
  });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_add_rent_payment", error), error);
  if (!data) throw new Error("empty_response");
  return data as string;
}

/** The landlord's "Rent received", or a decline with a reason the tenant sees. */
export async function decideRentPayment(paymentId: string, received: boolean, reason?: string): Promise<void> {
  const { error } = await supabase.rpc("rentals_decide_rent_payment", { p_payment_id: paymentId, p_received: received, p_reason: reason });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_decide_rent_payment", error), error);
}

/** The landlord takes back or corrects a received payment, within 30 days, with a reason the tenant sees. */
export async function correctRentPayment(
  paymentId: string,
  change: { action: "reverse" } | { action: "edit"; amountCents: number; paidOn: string },
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("rentals_correct_rent_payment", {
    p_payment_id: paymentId,
    p_action: change.action,
    p_amount_cents: change.action === "edit" ? change.amountCents : null,
    p_paid_on: change.action === "edit" ? change.paidOn : null,
    p_reason: reason,
  });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_correct_rent_payment", error), error);
}

/** The tenant disputes a payment that was turned down, taken back or changed (the app records it, never decides it). */
export async function disputeRentPayment(paymentId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("rentals_dispute_rent_payment", { p_payment_id: paymentId, p_reason: reason });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_dispute_rent_payment", error), error);
}

/**
 * May the tenant dispute this payment now? Declined, reversed or changed; each landlord decision or change
 * once; within 30 days of the last one (the server's rule in rentals_dispute_rent_payment).
 */
export function canDispute(p: RentPayment, now = Date.now()): boolean {
  if (!(p.status === "declined" || p.status === "reversed" || p.corrections.length > 0)) return false;
  const times = [p.decided_at, ...p.corrections.map((c) => c.at)].filter((t): t is string => !!t).map((t) => Date.parse(t));
  if (times.length === 0) return false;
  const last = Math.max(...times);
  return now - last <= 30 * 24 * 3600 * 1000 && !p.disputes.some((d) => Date.parse(d.at) >= last);
}

export function correctionLine(c: RentCorrection): string {
  return c.action === "reverse"
    ? `Taken back by the landlord: ${c.reason}`
    : `Changed from ${money(c.from.amount_cents)} on ${dayLabel(c.from.paid_on)}: ${c.reason}`;
}

export async function waiveRentCharge(chargeId: string): Promise<void> {
  const { error } = await supabase.rpc("rentals_waive_rent_charge", { p_charge_id: chargeId });
  if (error) throw new RentalsCopyError(rpcErrorMessage("rentals_waive_rent_charge", error), error);
}

// --- words ------------------------------------------------------------------

export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** A calendar date ("2026-11-01") in words, read as that day (never shifted by the time zone). */
export function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

/** Today in Central time as YYYY-MM-DD (the date the server's checks use). */
export function centralToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export function planLine(plan: RentPlan): string {
  const how = RENT_FREQUENCIES.find((f) => f.value === plan.frequency)?.label.toLowerCase() ?? plan.frequency;
  return `${money(plan.amount_cents)} ${how}`;
}

export function lateFeeLine(plan: RentPlan): string {
  if (plan.late_fee_cents === 0) return "No late fee.";
  const grace = plan.grace_days === 0 ? "the day after it's due" : `more than ${plan.grace_days} day${plan.grace_days === 1 ? "" : "s"} after the due date`;
  return `Late fee ${money(plan.late_fee_cents)} if rent is still open ${grace}.`;
}

/**
 * D10: the late fee is the landlord's to set; the app warns, never caps. Louisiana
 * asks that a late fee be reasonable; a fee over 10% of the rent is the line most
 * often questioned, so the landlord sees this before saving.
 */
export function lateFeeWarning(amountCents: number, lateFeeCents: number): string | null {
  if (amountCents <= 0 || lateFeeCents <= amountCents * 0.1) return null;
  return "That late fee is more than 10% of the rent. A late fee must be reasonable; a court can refuse one that isn't.";
}

export const PAYMENT_STATUS_LABEL: Record<RentPayment["status"], string> = {
  reported: "Waiting for the landlord",
  confirmed: "Received",
  declined: "Not received",
  reversed: "Taken back by the landlord",
};

// --- receipts (R5) ----------------------------------------------------------

/** One receipt per confirmed payment, the same for both sides. */
export function rentReceiptText(l: RentLedger, p: RentPayment): string {
  const home = l.home ? `${l.home.label}${l.home.unit_label ? `, ${l.home.unit_label}` : ""}, ${l.home.city} ${l.home.zip_code}` : "";
  return [
    "RENT RECEIPT",
    "Louisiana Helpr",
    "",
    `Receipt no.: ${p.id.slice(0, 8).toUpperCase()}`,
    `Home: ${home}`,
    `Amount: ${money(p.amount_cents)}`,
    `Paid on: ${dayLabel(p.paid_on)}`,
    `Paid by: ${PAY_METHOD_LABEL[p.method] ?? p.method}, directly to the landlord`,
    `Confirmed received by the landlord: ${p.decided_at ? dayLabel(centralToday(new Date(p.decided_at))) : ""}`,
    "",
    "Rent is paid directly between tenant and landlord. Louisiana Helpr keeps the record both see.",
  ].join("\n");
}

export function rentReceiptFileName(p: RentPayment): string {
  return `rent-receipt-${p.paid_on}-${p.id.slice(0, 8)}.txt`;
}
