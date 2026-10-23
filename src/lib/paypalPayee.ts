/**
 * "Get paid with PayPal" (PayPal Plan A, phase 2; owner 2026-10-23). A member
 * types the email on their PayPal account once (twice, to confirm) and that is
 * their payout setup for jobs, behind the `paypal_payments` switch.
 *
 * THE SERVER DECIDES. public.set_paypal_payee_email (migration
 * 20261023231647) refuses without the switch, normalises and checks the email
 * itself, writes only the caller's own row (auth.uid()) and decides "payable";
 * public.get_my_paypal_payee returns the caller's state with the email masked
 * (payee_accounts is server-only). The checks here only say what is wrong
 * before the tap; they mirror the server's, which is the one that counts.
 */

export interface PayPalPayee {
  hasEmail: boolean;
  /** "j•••@gmail.com", never the whole address. */
  emailMasked: string | null;
  /** We will pay this email (an admin can turn it off). */
  payable: boolean;
  /** PayPal itself confirmed the account (a later phase); false for a typed email. */
  verified: boolean;
}

export interface PayPalPayeeSaved extends PayPalPayee {
  changed: boolean;
  /** Payouts already queued to the OLD email, now held for an admin to check. */
  heldPayouts: number;
  acceptsCompleted: number;
  crewConfirmsCompleted: number;
}

const obj = (data: unknown) => (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** get_my_paypal_payee's answer. Anything unexpected reads as "no email". */
export function parsePayPalPayee(data: unknown): PayPalPayee {
  const o = obj(data);
  const masked = typeof o.email_masked === "string" ? o.email_masked : null;
  const hasEmail = o.has_email === true && masked !== null;
  return { hasEmail, emailMasked: hasEmail ? masked : null, payable: hasEmail && o.payable === true, verified: hasEmail && o.verified === true };
}

/** set_paypal_payee_email's answer, or null when it is not a confirmed write. */
export function parsePayPalPayeeSaved(data: unknown): PayPalPayeeSaved | null {
  const o = obj(data);
  if (o.ok !== true || typeof o.email_masked !== "string") return null;
  return {
    hasEmail: true,
    emailMasked: o.email_masked,
    payable: o.payable === true,
    verified: false,
    changed: o.changed === true,
    heldPayouts: num(o.held_payouts),
    acceptsCompleted: num(o.accepts_completed),
    crewConfirmsCompleted: num(o.crew_confirms_completed),
  };
}

/** The server's normal form: trimmed, lower case. */
export function normalizePayPalEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** set_paypal_payee_email's format rule: one @, a dot in the domain, no spaces, 127 characters at most. */
export function isPayPalEmail(input: string): boolean {
  const e = normalizePayPalEmail(input);
  return e.length > 0 && e.length <= 127 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}

/** What is wrong with the two boxes, in words, or null when they can be saved. */
export function payPalEmailProblem(email: string, confirm: string): string | null {
  if (!normalizePayPalEmail(email)) return "Enter the email on your PayPal account.";
  if (!isPayPalEmail(email)) return "That doesn't look like an email address.";
  if (normalizePayPalEmail(confirm) !== normalizePayPalEmail(email)) return "The two emails don't match.";
  return null;
}
