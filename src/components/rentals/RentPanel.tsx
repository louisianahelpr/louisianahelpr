/**
 * Homes rent tracker, PAY DIRECT (owner D2/D10/D11; R1-R5; 20261019073106).
 * One record both sides see, inside the home's card: under "Homes you rent"
 * for the tenant and under each connected unit for the landlord. No money moves
 * through the app: the tenant pays the landlord directly.
 *
 *   Tenant:   the schedule, what is owed, how the landlord takes payment,
 *             "I paid" (waits for the landlord), the history and receipts.
 *   Landlord: set or change the schedule (late fee warning, D10) and the
 *             lease end date, "Rent received" / "Not received" (with a reason
 *             the tenant sees), record a payment, waive a charge, take back or
 *             correct a received payment within 30 days (with a reason), the
 *             history and receipts.
 *   After the tenancy ends both sides can still record, confirm and dispute
 *   for 90 days; then the record is read-only (lead review #3).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rentalsErrorMessage, dollarsToCents } from "@/lib/rentals/copy";
import {
  PAY_METHODS,
  PAY_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  RENT_FREQUENCIES,
  addRentPayment,
  canDispute,
  centralToday,
  correctRentPayment,
  correctionLine,
  dayLabel,
  shortDayLabel,
  decideRentPayment,
  disputeRentPayment,
  fetchRentLedger,
  lateFeeLine,
  lateFeeWarning,
  money,
  planLine,
  rentReceiptFileName,
  rentReceiptText,
  setRentPlan,
  waiveRentCharge,
  type PayMethod,
  type PaymentMethod,
  type RentFrequency,
  type RentLedger,
  type RentPayment,
  type RentPlan,
} from "@/lib/rentals/rent";
import { saveRentReceipt } from "@/lib/rentals/rentReceipt";
import { fieldSelectClass } from "./rentalsUi";

const rentKey = (tenancyId: string) => ["rent-ledger", tenancyId];

/** The balance, top right of the card: a small label over the amount, so neither wraps at 320/375. */
function BalanceLine({ cents, side }: { cents: number; side: RentLedger["side"] }) {
  const [label, amount] = cents > 0 ? [side === "tenant" ? "You owe" : "Owed to you", money(cents)] : cents < 0 ? ["Paid ahead", money(-cents)] : ["", "Paid up"];
  return (
    <p className="shrink-0 text-right" data-testid="rent-balance">
      {label && <span className="block whitespace-nowrap text-xs text-muted-foreground">{label}</span>}
      <span className="block whitespace-nowrap text-base font-semibold">{amount}</span>
    </p>
  );
}

/** A calendar date n days after a YYYY-MM-DD date. */
function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function PlanForm({ tenancyId, plan, leaseEndsOn, onDone }: { tenancyId: string; plan: RentPlan | null; leaseEndsOn: string | null; onDone: () => void }) {
  const [amount, setAmount] = useState(plan ? String(plan.amount_cents / 100) : "");
  const [frequency, setFrequency] = useState<RentFrequency>(plan?.frequency ?? "monthly");
  const [first, setFirst] = useState(plan && plan.first_due_on >= centralToday() ? plan.first_due_on : "");
  const [grace, setGrace] = useState(String(plan?.grace_days ?? 3));
  const [fee, setFee] = useState(plan ? String(plan.late_fee_cents / 100) : "0");
  const [methods, setMethods] = useState<PayMethod[]>(plan?.pay_methods ?? []);
  const [lease, setLease] = useState(leaseEndsOn ?? "");
  // A NEW lease end date is at least 30 days out (the server refuses closer); an unchanged one stays as it is.
  const leaseMin = addDays(centralToday(), 30);
  const amountCents = dollarsToCents(amount);
  const feeCents = fee.trim() === "" ? 0 : dollarsToCents(fee);
  const warning = amountCents != null && feeCents != null ? lateFeeWarning(amountCents, feeCents) : null;
  const m = useMutation({
    mutationFn: () => {
      if (amountCents == null || feeCents == null) throw new Error("bad_amount");
      return setRentPlan(tenancyId, {
        amount_cents: amountCents,
        frequency,
        first_due_on: first,
        grace_days: Number(grace) || 0,
        late_fee_cents: feeCents,
        pay_methods: methods,
        lease_ends_on: lease === "" ? null : lease,
      });
    },
    onSuccess: () => {
      toast("Rent schedule saved. Your tenant was told.");
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error && e.message === "bad_amount" ? "Enter amounts like 1200 or 50." : rentalsErrorMessage(e)),
  });
  const toggle = (p: PayMethod) => setMethods((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  return (
    <form
      className="space-y-2"
      aria-label="Rent schedule"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <div className="flex gap-2">
        <Input aria-label="Rent amount in dollars" inputMode="decimal" placeholder="Rent ($)" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <select aria-label="How often" className={fieldSelectClass} value={frequency} onChange={(e) => setFrequency(e.target.value as RentFrequency)}>
          {RENT_FREQUENCIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <label className="block text-xs text-muted-foreground" htmlFor={`first-${tenancyId}`}>
        First due date{frequency === "monthly" ? " (day 1 to 28, so every month has it)" : ""}
      </label>
      <Input className="min-w-0" id={`first-${tenancyId}`} type="date" min={centralToday()} value={first} onChange={(e) => setFirst(e.target.value)} required />
      <div className="flex gap-2">
        <Input aria-label="Grace days" inputMode="numeric" placeholder="Grace days" value={grace} onChange={(e) => setGrace(e.target.value)} />
        <Input aria-label="Late fee in dollars" inputMode="decimal" placeholder="Late fee ($)" value={fee} onChange={(e) => setFee(e.target.value)} />
      </div>
      <label className="block text-xs text-muted-foreground" htmlFor={`lease-${tenancyId}`}>
        Lease ends (optional, at least 30 days from today)
      </label>
      <Input
        className="min-w-0"
        id={`lease-${tenancyId}`}
        type="date"
        min={lease !== "" && lease === leaseEndsOn ? undefined : leaseMin}
        value={lease}
        onChange={(e) => setLease(e.target.value)}
      />
      {warning && (
        <p role="alert" className="rounded-xl bg-muted px-3 py-2 text-xs">
          {warning}
        </p>
      )}
      <fieldset className="space-y-1">
        <legend className="text-xs text-muted-foreground">How your tenant can pay you (directly, outside the app)</legend>
        <div className="flex flex-wrap gap-2">
          {PAY_METHODS.map((p) => (
            <label key={p} className="flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs">
              <input type="checkbox" className="h-4 w-4 min-h-0 min-w-0 shrink-0" style={{ accentColor: "hsl(var(--primary))" }} checked={methods.includes(p)} onChange={() => toggle(p)} />
              {PAY_METHOD_LABEL[p]}
            </label>
          ))}
        </div>
      </fieldset>
      <Button type="submit" size="sm" disabled={m.isPending || methods.length === 0}>
        {m.isPending ? "Saving…" : "Save rent schedule"}
      </Button>
    </form>
  );
}

function PaymentForm({ tenancyId, side, methods, onDone }: { tenancyId: string; side: RentLedger["side"]; methods: PayMethod[]; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(centralToday());
  const [method, setMethod] = useState<PaymentMethod>(methods[0] ?? "other");
  const cents = dollarsToCents(amount);
  const m = useMutation({
    mutationFn: () => {
      if (cents == null) throw new Error("bad_amount");
      return addRentPayment(tenancyId, cents, paidOn, method);
    },
    onSuccess: () => {
      setAmount("");
      toast(side === "tenant" ? "Sent to your landlord to confirm." : "Payment recorded. Your tenant was told.");
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error && e.message === "bad_amount" ? "Enter an amount like 1200." : rentalsErrorMessage(e)),
  });
  const options: PaymentMethod[] = [...methods.filter((x) => x !== ("other" as PayMethod)), "other"];
  return (
    <form
      className="space-y-2"
      aria-label={side === "tenant" ? "I paid" : "Record a payment"}
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <div className="flex gap-2">
        <Input aria-label="Amount paid in dollars" inputMode="decimal" placeholder="Amount ($)" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <Input className="min-w-0 flex-1" aria-label="Date paid" type="date" max={centralToday()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required />
      </div>
      <select aria-label="How it was paid" className={fieldSelectClass} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {PAY_METHOD_LABEL[o]}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={m.isPending}>
        {m.isPending ? "Sending…" : side === "tenant" ? "Send to landlord" : "Record payment"}
      </Button>
    </form>
  );
}

function DecideRow({ p, tenancyId, onDone }: { p: RentPayment; tenancyId: string; onDone: () => void }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: (received: boolean) => decideRentPayment(p.id, received, received ? undefined : reason.trim()),
    onSuccess: (_d, received) => {
      toast(received ? "Marked received. Your tenant was told." : "Your tenant was told why.");
      onDone();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  return (
    <div className="space-y-2 rounded-xl bg-muted px-3 py-2 text-sm" data-testid={`rent-to-confirm-${tenancyId}`}>
      <p>
        Your tenant says they paid <span className="font-semibold">{money(p.amount_cents)}</span> by {PAY_METHOD_LABEL[p.method]} on {dayLabel(p.paid_on)}.
      </p>
      {declining ? (
        <div className="space-y-2">
          <Input aria-label="Why it wasn't received" placeholder="Why (your tenant sees it)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={m.isPending || reason.trim().length < 3} onClick={() => m.mutate(false)}>
              Send
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDeclining(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={m.isPending} onClick={() => setDeclining(true)}>
            Not received
          </Button>
          <Button type="button" size="sm" disabled={m.isPending} onClick={() => m.mutate(true)}>
            Rent received
          </Button>
        </div>
      )}
    </div>
  );
}

function CorrectForm({ p, onDone }: { p: RentPayment; onDone: () => void }) {
  const [amount, setAmount] = useState(String(p.amount_cents / 100));
  const [paidOn, setPaidOn] = useState(p.paid_on);
  const [reason, setReason] = useState("");
  const cents = dollarsToCents(amount);
  const m = useMutation({
    mutationFn: (action: "edit" | "reverse") => {
      if (action === "reverse") return correctRentPayment(p.id, { action: "reverse" }, reason.trim());
      if (cents == null) throw new Error("bad_amount");
      return correctRentPayment(p.id, { action: "edit", amountCents: cents, paidOn }, reason.trim());
    },
    onSuccess: (_d, action) => {
      toast(action === "reverse" ? "Payment taken back. Your tenant was told why." : "Payment corrected. Your tenant was told why.");
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error && e.message === "bad_amount" ? "Enter an amount like 1200." : rentalsErrorMessage(e)),
  });
  const ready = reason.trim().length >= 3 && !m.isPending;
  return (
    <div role="group" className="mt-2 space-y-2 rounded-xl bg-muted px-3 py-2" aria-label="Fix this payment">
      <div className="flex gap-2">
        <Input aria-label="Correct amount in dollars" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input className="min-w-0 flex-1" aria-label="Correct date paid" type="date" max={centralToday()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </div>
      <Input aria-label="Why it changes" placeholder="Why (your tenant sees it)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!ready} onClick={() => m.mutate("reverse")}>
          Take it back
        </Button>
        <Button type="button" size="sm" disabled={!ready} onClick={() => m.mutate("edit")}>
          Save correction
        </Button>
      </div>
    </div>
  );
}

function DisputeForm({ p, onDone }: { p: RentPayment; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => disputeRentPayment(p.id, reason.trim()),
    onSuccess: () => {
      toast("Dispute sent. Your landlord was told.");
      onDone();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  return (
    <div role="group" className="mt-2 space-y-2 rounded-xl bg-muted px-3 py-2" aria-label="Dispute this payment">
      <Input aria-label="Why you dispute it" placeholder="What happened (your landlord sees it)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button type="button" size="sm" disabled={reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
        Send dispute
      </Button>
    </div>
  );
}

function PaymentRow({ l, p, onDone }: { l: RentLedger; p: RentPayment; onDone: () => void }) {
  const [open, setOpen] = useState<"fix" | "dispute" | null>(null);
  const mayFix = l.open && l.side === "landlord" && p.correctable_until != null;
  const mayDispute = l.open && l.side === "tenant" && canDispute(p);
  const finish = () => {
    setOpen(null);
    onDone();
  };
  return (
    <li>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block">
            Paid {money(p.amount_cents)} · {shortDayLabel(p.paid_on)}
          </span>
          {/* A reversal's own line says "Taken back by the landlord: <reason>", so the bare status would repeat it. */}
          {!(p.status === "reversed" && p.corrections.some((c) => c.action === "reverse")) && (
            <span className="block text-xs text-muted-foreground">
              {PAY_METHOD_LABEL[p.method]} · {PAYMENT_STATUS_LABEL[p.status]}
              {p.status === "declined" && p.decline_reason ? `: ${p.decline_reason}` : ""}
            </span>
          )}
          {/* A taken-back payment: its method and the reason on one line (coordinator, 2026-10-19). */}
          {p.corrections.map((c, i) => (
            <span key={c.at} className="block text-xs text-muted-foreground">
              {p.status === "reversed" && c.action === "reverse" && i === p.corrections.length - 1 ? `${PAY_METHOD_LABEL[p.method]} · ` : ""}
              {correctionLine(c)}
            </span>
          ))}
          {p.disputes.map((d) => (
            <span key={d.at} className="block text-xs">
              Disputed by the tenant: {d.reason}
            </span>
          ))}
        </span>
        <span className="flex shrink-0 gap-1">
          {p.status === "confirmed" && (
            <Button type="button" size="sm" variant="outline" onClick={() => void saveRentReceipt(rentReceiptFileName(p), rentReceiptText(l, p))}>
              Receipt
            </Button>
          )}
          {mayFix && (
            <Button type="button" size="sm" variant="outline" aria-expanded={open === "fix"} onClick={() => setOpen(open === "fix" ? null : "fix")}>
              Fix
            </Button>
          )}
          {mayDispute && (
            <Button type="button" size="sm" variant="outline" aria-expanded={open === "dispute"} onClick={() => setOpen(open === "dispute" ? null : "dispute")}>
              Dispute
            </Button>
          )}
        </span>
      </div>
      {open === "fix" && <CorrectForm p={p} onDone={finish} />}
      {open === "dispute" && <DisputeForm p={p} onDone={finish} />}
    </li>
  );
}

function History({ l, onDone }: { l: RentLedger; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const waive = useMutation({
    mutationFn: (chargeId: string) => waiveRentCharge(chargeId),
    onSuccess: () => {
      toast("Waived. It stays on the record, marked waived.");
      onDone();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  const today = centralToday();
  const charges = l.charges.filter((c) => c.due_on <= today).slice().reverse();
  const payments = l.payments.slice().reverse();
  if (charges.length === 0 && payments.length === 0) return null;
  return (
    <div className="text-sm">
      <button
        type="button"
        className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left font-medium"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>History and receipts</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
      <ul className="mt-1 space-y-1.5" aria-label="Rent history">
        {payments.map((p) => (
          <PaymentRow key={p.id} l={l} p={p} onDone={onDone} />
        ))}
        {charges.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2">
            <span className={c.waived ? "text-muted-foreground line-through" : ""}>
              {c.kind === "rent" ? "Rent" : "Late fee"} {money(c.amount_cents)} · due {shortDayLabel(c.due_on)}
              {c.waived ? " (waived)" : ""}
            </span>
            {l.side === "landlord" && l.open && !c.waived && (
              <Button type="button" size="sm" variant="ghost" disabled={waive.isPending} onClick={() => waive.mutate(c.id)} aria-label={`Waive ${c.kind === "rent" ? "rent" : "late fee"} due ${dayLabel(c.due_on)}`}>
                Waive
              </Button>
            )}
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}

export function RentPanel({ tenancyId }: { tenancyId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: rentKey(tenancyId), queryFn: () => fetchRentLedger(tenancyId) });
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const done = () => {
    setEditing(false);
    setPaying(false);
    void qc.invalidateQueries({ queryKey: rentKey(tenancyId) });
  };
  if (q.isError) return <p className="text-xs text-muted-foreground">Couldn't load the rent record.</p>;
  if (!q.data) return <div role="status" className="h-10 animate-pulse rounded-xl bg-muted" aria-label="Loading rent" />;
  const l = q.data;
  // An ended tenancy that never had rent tracked has no rent card.
  if (l.tenancy_status === "ended" && !l.plan && l.charges.length === 0 && l.payments.length === 0) return null;
  const toConfirm = l.payments.filter((p) => p.status === "reported");
  return (
    <section className="space-y-2 border-t border-border pt-3" aria-label="Rent">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Rent</p>
          {l.plan ? (
            <p className="text-xs text-muted-foreground">
              {planLine(l.plan)}
              {l.plan.next_due_on ? ` · next due ${dayLabel(l.plan.next_due_on)}` : ""}
              {l.lease_ends_on ? ` · lease ends ${dayLabel(l.lease_ends_on)}` : ""}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {l.side === "tenant" ? "Your landlord hasn't set a rent schedule yet." : "Set the rent schedule: you both see one record of what's due and what's paid."}
            </p>
          )}
        </div>
        {l.plan && <BalanceLine cents={l.balance_cents} side={l.side} />}
      </div>
      {l.plan && (
        <p className="text-xs text-muted-foreground">
          {lateFeeLine(l.plan)} Paid directly to the landlord by {l.plan.pay_methods.map((m) => PAY_METHOD_LABEL[m]).join(", ")}.
        </p>
      )}
      {l.tenancy_status === "ended" && (
        <p className="rounded-xl bg-muted px-3 py-2 text-xs">
          {l.open && l.open_until
            ? `This tenancy ended. You can both still record, confirm and dispute payments until ${dayLabel(l.open_until)}.`
            : "This tenancy ended. The rent record is kept, read-only."}
        </p>
      )}
      {l.side === "landlord" && l.open && toConfirm.map((p) => <DecideRow key={p.id} p={p} tenancyId={tenancyId} onDone={done} />)}
      {l.side === "tenant" && toConfirm.length > 0 && (
        <p className="text-xs">
          {toConfirm.length === 1 ? "1 payment is" : `${toConfirm.length} payments are`} waiting for your landlord to confirm.
        </p>
      )}
      {l.side === "landlord" && l.tenancy_status === "active" && (editing || !l.plan) && (
        <PlanForm tenancyId={tenancyId} plan={l.plan} leaseEndsOn={l.lease_ends_on} onDone={done} />
      )}
      {paying && l.plan && l.open && <PaymentForm tenancyId={tenancyId} side={l.side} methods={l.plan.pay_methods} onDone={done} />}
      <div className="flex flex-wrap gap-2">
        {l.plan && l.open && !paying && (
          <Button type="button" size="sm" variant={l.side === "tenant" ? "default" : "outline"} onClick={() => setPaying(true)}>
            {l.side === "tenant" ? "I paid" : "Record a payment"}
          </Button>
        )}
        {l.side === "landlord" && l.tenancy_status === "active" && l.plan && !editing && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Change schedule
          </Button>
        )}
      </div>
      <History l={l} onDone={done} />
    </section>
  );
}
