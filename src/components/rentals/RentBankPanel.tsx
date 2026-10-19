/**
 * Homes rent paid IN THE APP by bank (owner D2/D7/D9; 20261019103751). DRAFT, Stripe TEST mode only.
 * Inside the rent card of a live tenancy.
 *   Landlord: turn bank pay on/off (needs payouts) and choose who pays the bank cost (0.8%, at most $5).
 *   Tenant:   "Pay by bank" with the cost shown first, a processing note while the bank confirms, and
 *             autopay on/off once a bank is saved.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dollarsToCents, rentalsErrorMessage } from "@/lib/rentals/copy";
import { money } from "@/lib/rentals/rent";
import { bankFeeCents, fetchBankState, payRentByBank, setAutopay, setBankPay, type FeePayer } from "@/lib/rentals/rentBank";

const bankKey = (tenancyId: string) => ["rent-bank", tenancyId];

export function RentBankPanel({ tenancyId, side, balanceCents }: { tenancyId: string; side: "tenant" | "landlord"; balanceCents: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: bankKey(tenancyId), queryFn: () => fetchBankState(tenancyId) });
  const [amount, setAmount] = useState(balanceCents > 0 ? String(balanceCents / 100) : "");
  const done = () => void qc.invalidateQueries({ queryKey: bankKey(tenancyId) });
  const toggle = useMutation({
    mutationFn: ({ on, payer }: { on: boolean; payer: FeePayer }) => setBankPay(tenancyId, on, payer),
    onSuccess: () => {
      toast("Saved. Your tenant was told.");
      done();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  const pay = useMutation({
    mutationFn: () => {
      const cents = dollarsToCents(amount);
      if (cents == null) throw new Error("bad_amount");
      return payRentByBank(tenancyId, cents);
    },
    onSuccess: done,
    onError: (e) => toast.error(e instanceof Error && e.message === "bad_amount" ? "Enter an amount like 1200." : rentalsErrorMessage(e)),
  });
  const auto = useMutation({
    mutationFn: (on: boolean) => setAutopay(tenancyId, on),
    onSuccess: done,
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  if (q.isError || !q.data) return null;
  const s = q.data;
  if (side === "landlord") {
    return (
      <div className="space-y-2 rounded-xl bg-muted px-3 py-2 text-xs" aria-label="Bank pay in the app">
        <p className="text-sm font-medium">Rent by bank in the app</p>
        {!s.payouts_ready && !s.bank_pay ? (
          <p>Turn on payouts in Profile first: bank rent is paid to your payout account when the bank confirms it.</p>
        ) : (
          <>
            <p>
              {s.bank_pay ? "On." : "Off."} The bank cost is 0.8%, at most $5 a payment, paid by{" "}
              {s.fee_payer === "tenant" ? "your tenant (added to what they pay)" : "you (kept from your payout)"}.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={s.bank_pay ? "outline" : "default"} disabled={toggle.isPending}
                onClick={() => toggle.mutate({ on: !s.bank_pay, payer: s.fee_payer })}>
                {s.bank_pay ? "Turn off" : "Turn on"}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={toggle.isPending}
                onClick={() => toggle.mutate({ on: s.bank_pay, payer: s.fee_payer === "tenant" ? "landlord" : "tenant" })}>
                {s.fee_payer === "tenant" ? "I'll pay the bank cost" : "Tenant pays the bank cost"}
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }
  if (!s.bank_pay) return null;
  const cents = dollarsToCents(amount) ?? 0;
  const fee = s.fee_payer === "tenant" ? bankFeeCents(cents) : 0;
  return (
    <div className="space-y-2 rounded-xl bg-muted px-3 py-2 text-xs" aria-label="Pay by bank">
      <p className="text-sm font-medium">Pay by bank</p>
      {s.in_flight ? (
        <p data-testid="bank-in-flight">
          {s.in_flight.status === "processing"
            ? `Your bank payment of ${money(s.in_flight.charge_cents)} is on its way. It counts once your bank confirms it (usually 4 business days).`
            : "A bank payment page is open. Finish it, or wait a few minutes to start again."}
        </p>
      ) : (
        <>
          <div className="flex gap-2">
            <Input aria-label="Amount to pay by bank in dollars" inputMode="decimal" placeholder="Amount ($)" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Button type="button" size="sm" disabled={pay.isPending || cents < 100} onClick={() => pay.mutate()}>
              {pay.isPending ? "Opening…" : "Pay by bank"}
            </Button>
          </div>
          <p data-testid="bank-fee-line">
            {s.fee_payer === "tenant"
              ? `Bank cost ${money(fee)} (0.8%, at most $5). Your bank is charged ${money(cents + fee)}.`
              : "Your landlord pays the bank cost."}
          </p>
        </>
      )}
      {s.autopay.bank_label && (
        <div className="flex items-center justify-between gap-2">
          <span>Autopay from {s.autopay.bank_label}: {s.autopay.enabled ? "on, rent is paid on each due date" : "off"}</span>
          <Button type="button" size="sm" variant="ghost" disabled={auto.isPending} onClick={() => auto.mutate(!s.autopay.enabled)}>
            {s.autopay.enabled ? "Turn off" : "Turn on"}
          </Button>
        </div>
      )}
    </div>
  );
}
