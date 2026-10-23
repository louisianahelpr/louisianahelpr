/**
 * The admin "Pay this Helpr" queue (PayPal Plan A, phase 4): lines from admin_paypal_payout_queue()
 * grouped into what the owner actually does, ONE PayPal Send Money per Helpr and PayPal account.
 *
 *   toSend    pending lines, grouped by (Helpr, destination, env): send the group total, then Mark paid
 *             the whole group with the one transaction id PayPal shows.
 *   held      lines held because the Helpr changed their PayPal email after they were queued: never
 *             offered as payable; re-queued to the new email after an admin checks it.
 *   notQueued approved PayPal jobs with no payout row yet, with the reason in plain words.
 *   paid      marked paid in the last 30 days, newest first.
 */

export interface PaypalQueueLine {
  row_kind: string;
  line_kind: string;
  payout_id: string | null;
  status: string;
  job_id: string | null;
  job_title: string | null;
  helper_id: string | null;
  helper_name: string | null;
  destination_kind: string | null;
  destination_value: string | null;
  current_destination: string | null;
  amount_cents: number | null;
  env: string;
  pay_on_or_after: string | null;
  queued_at: string | null;
  external_txn_id: string | null;
  marked_paid_at: string | null;
  marked_paid_by_name: string | null;
  helper_on_hold: boolean;
}

export interface PayGroup {
  key: string;
  helperId: string | null;
  helperName: string;
  destinationKind: string;
  destination: string;
  /** The Helpr's payable destination now; differs from `destination` on a held group. */
  currentDestination: string | null;
  env: string;
  totalCents: number;
  /** The latest "pay on or after" of the lines (the standard 3 days after approval). */
  payOnOrAfter: string | null;
  helperOnHold: boolean;
  lines: PaypalQueueLine[];
}

export interface PaypalQueueView {
  toSend: PayGroup[];
  held: PayGroup[];
  notQueued: PaypalQueueLine[];
  paid: PaypalQueueLine[];
}

function group(lines: PaypalQueueLine[]): PayGroup[] {
  const byKey = new Map<string, PayGroup>();
  for (const l of lines) {
    const key = `${l.helper_id ?? "none"}|${l.destination_value ?? ""}|${l.env}`;
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        helperId: l.helper_id,
        helperName: l.helper_name?.trim() || "Unnamed Helpr",
        destinationKind: l.destination_kind ?? "paypal_email",
        destination: l.destination_value ?? "",
        currentDestination: l.current_destination,
        env: l.env,
        totalCents: 0,
        payOnOrAfter: null,
        helperOnHold: false,
        lines: [],
      };
      byKey.set(key, g);
    }
    g.lines.push(l);
    g.totalCents += l.amount_cents ?? 0;
    g.helperOnHold ||= l.helper_on_hold;
    if (l.pay_on_or_after && (!g.payOnOrAfter || l.pay_on_or_after > g.payOnOrAfter)) g.payOnOrAfter = l.pay_on_or_after;
  }
  const out = [...byKey.values()];
  for (const g of out) g.lines.sort((a, b) => (a.line_kind === b.line_kind ? 0 : a.line_kind === "job" ? -1 : 1));
  // Oldest due first: that is the order the owner should pay in.
  return out.sort((a, b) => (a.payOnOrAfter ?? "").localeCompare(b.payOnOrAfter ?? "") || a.helperName.localeCompare(b.helperName));
}

export function buildPaypalQueueView(lines: readonly PaypalQueueLine[]): PaypalQueueView {
  const payouts = lines.filter((l) => l.row_kind === "payout" && l.payout_id);
  return {
    toSend: group(payouts.filter((l) => l.status === "pending")),
    held: group(payouts.filter((l) => l.status === "held")),
    notQueued: lines.filter((l) => l.row_kind === "not_queued"),
    paid: payouts
      .filter((l) => l.status === "success")
      .sort((a, b) => (b.marked_paid_at ?? "").localeCompare(a.marked_paid_at ?? "")),
  };
}

/** Why an approved PayPal job is not in the queue yet, in plain words. */
export const NOT_QUEUED_REASON: Record<string, string> = {
  no_payable_paypal_account: "The Helpr hasn't added a PayPal email yet. It joins the queue once they do.",
  payout_held: "This Helpr's payouts are on hold. Release the hold below and it joins the queue.",
  crew_not_supported: "Crew job. Paying a crew through PayPal isn't set up yet, so pay each member by hand.",
  not_queued_yet: "Approved and waiting to be added. It joins the queue within the hour.",
};

export function notQueuedReason(code: string): string {
  return NOT_QUEUED_REASON[code] ?? "Not in the queue yet.";
}

/** "$94.00" from cents. */
export function centsLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** What the admin pastes from the PayPal receipt, normalised the way the server stores it. */
export function normaliseTxnId(raw: string): string {
  return raw.trim().toUpperCase();
}

/** Loose shape check, the same one admin_mark_paypal_payout_paid applies. */
export function looksLikeTxnId(raw: string): boolean {
  return /^[A-Z0-9]{8,32}$/.test(normaliseTxnId(raw));
}
