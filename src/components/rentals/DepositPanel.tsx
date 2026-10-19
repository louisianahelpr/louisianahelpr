/**
 * Homes security deposit, TRACK ONLY (owner D6; R.S. 9:3251; 20261019082216).
 * Paid directly to the landlord; the app keeps one record and the return clock.
 *
 *   Landlord: record the deposit (amount, day received); after the tenancy
 *             ends, see the tenant's forwarding address and the return-by date,
 *             and settle it: the amount returned and each amount kept with its
 *             reason (the itemized statement the tenant gets). Final.
 *   Tenant:   the amount, give a forwarding address, and the statement.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dollarsToCents, rentalsErrorMessage } from "@/lib/rentals/copy";
import {
  centralToday,
  dayLabel,
  fetchDeposit,
  money,
  setDeposit,
  setForwardingAddress,
  settleDeposit,
  type DepositRecord,
} from "@/lib/rentals/rent";

const depositKey = (tenancyId: string) => ["rent-deposit", tenancyId];

function RecordForm({ tenancyId, onDone }: { tenancyId: string; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [on, setOn] = useState(centralToday());
  const cents = dollarsToCents(amount);
  const m = useMutation({
    mutationFn: () => {
      if (cents == null) throw new Error("bad_amount");
      return setDeposit(tenancyId, cents, on);
    },
    onSuccess: () => {
      toast("Deposit recorded. Your tenant was told.");
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error && e.message === "bad_amount" ? "Enter an amount like 1200." : rentalsErrorMessage(e)),
  });
  return (
    <form
      className="flex flex-wrap gap-2"
      aria-label="Record the deposit"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <Input className="min-w-0 flex-1" aria-label="Deposit amount in dollars" inputMode="decimal" placeholder="Deposit ($)" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      <Input className="min-w-0 flex-1" aria-label="Day you received it" type="date" max={centralToday()} value={on} onChange={(e) => setOn(e.target.value)} required />
      <Button type="submit" size="sm" variant="outline" disabled={m.isPending}>
        {m.isPending ? "Saving…" : "Record deposit"}
      </Button>
    </form>
  );
}

function AddressForm({ tenancyId, current, onDone }: { tenancyId: string; current: string | null; onDone: () => void }) {
  const [address, setAddress] = useState(current ?? "");
  const m = useMutation({
    mutationFn: () => setForwardingAddress(tenancyId, address),
    onSuccess: () => {
      toast("Forwarding address saved. Your landlord sees it once you've moved out.");
      onDone();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  return (
    <form
      className="flex flex-wrap gap-2"
      aria-label="Forwarding address"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <Input className="min-w-0 flex-[2]" aria-label="Forwarding address" placeholder="Where to send your deposit (street, city, ZIP)" value={address} onChange={(e) => setAddress(e.target.value)} required />
      <Button type="submit" size="sm" variant="outline" disabled={m.isPending}>
        {m.isPending ? "Saving…" : "Save address"}
      </Button>
    </form>
  );
}

function SettleForm({ tenancyId, amountCents, onDone }: { tenancyId: string; amountCents: number; onDone: () => void }) {
  const [rows, setRows] = useState<{ reason: string; amount: string }[]>([]);
  const [on, setOn] = useState(centralToday());
  const kept = rows.map((r) => dollarsToCents(r.amount));
  const keptCents = kept.reduce<number>((a, c) => a + (c ?? 0), 0);
  const returned = amountCents - keptCents;
  const valid = returned >= 0 && rows.every((r, i) => r.reason.trim().length >= 3 && (kept[i] ?? 0) > 0);
  const m = useMutation({
    mutationFn: () =>
      settleDeposit(
        tenancyId,
        returned,
        rows.map((r, i) => ({ reason: r.reason.trim(), amount_cents: kept[i] ?? 0 })),
        on,
      ),
    onSuccess: () => {
      toast("Settled. Your tenant got the itemized statement.");
      onDone();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  return (
    <form
      className="space-y-2"
      aria-label="Settle the deposit"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Input
            className="min-w-0 flex-[2]"
            aria-label={`Reason kept ${i + 1}`}
            placeholder="What for (e.g. carpet cleaning)"
            value={r.reason}
            onChange={(e) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))}
          />
          <Input
            className="min-w-0 flex-1"
            aria-label={`Amount kept ${i + 1}`}
            inputMode="decimal"
            placeholder="$"
            value={r.amount}
            onChange={(e) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
          />
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" disabled={rows.length >= 20} onClick={() => setRows((cur) => [...cur, { reason: "", amount: "" }])}>
        Keep part of it
      </Button>
      <p className="text-sm">
        Return <span className="font-semibold">{returned >= 0 ? money(returned) : "—"}</span>
        {keptCents > 0 ? `, keep ${money(keptCents)}` : ""}
      </p>
      {returned < 0 && (
        <p role="alert" className="text-xs">
          You can't keep more than the deposit.
        </p>
      )}
      <Input aria-label="Day you returned it" type="date" max={centralToday()} value={on} onChange={(e) => setOn(e.target.value)} required />
      <Button type="submit" size="sm" disabled={m.isPending || !valid}>
        {m.isPending ? "Sending…" : "Send the statement"}
      </Button>
    </form>
  );
}

function Statement({ d }: { d: NonNullable<DepositRecord["deposit"]> }) {
  return (
    <div className="space-y-1 text-sm" data-testid="deposit-statement">
      <p>
        Returned {money(d.returned_cents ?? 0)} of {money(d.amount_cents)} on {d.returned_on ? dayLabel(d.returned_on) : ""}.
      </p>
      {d.deductions.length > 0 ? (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {d.deductions.map((x, i) => (
            <li key={i}>
              {x.reason}: {money(x.amount_cents)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Nothing was kept.</p>
      )}
    </div>
  );
}

export function DepositPanel({ tenancyId }: { tenancyId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: depositKey(tenancyId), queryFn: () => fetchDeposit(tenancyId) });
  const [editingAddress, setEditingAddress] = useState(false);
  const done = () => {
    setEditingAddress(false);
    void qc.invalidateQueries({ queryKey: depositKey(tenancyId) });
  };
  if (q.isError) return <p className="text-xs text-muted-foreground">Couldn't load the deposit record.</p>;
  if (!q.data) return null;
  const { side, tenancy_status: status, deposit: d } = q.data;
  return (
    <section className="space-y-2 border-t border-border pt-3" aria-label="Security deposit">
      <p className="text-sm font-medium">Security deposit</p>
      {!d ? (
        side === "landlord" && status === "active" ? (
          <>
            <p className="text-xs text-muted-foreground">Paid to you directly. Record it so you both have the same record.</p>
            <RecordForm tenancyId={tenancyId} onDone={done} />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No deposit recorded.</p>
        )
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {money(d.amount_cents)}, received {dayLabel(d.received_on)}. Louisiana law: returned within one month after the tenancy ends, with an itemized list of anything kept.
          </p>
          {d.settled_at ? (
            <Statement d={d} />
          ) : side === "tenant" ? (
            d.forwarding_address && !editingAddress ? (
              <p className="flex items-center justify-between gap-2 text-xs">
                <span>Forwarding address: {d.forwarding_address}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditingAddress(true)}>
                  Change
                </Button>
              </p>
            ) : (
              <AddressForm tenancyId={tenancyId} current={d.forwarding_address} onDone={done} />
            )
          ) : status === "ended" ? (
            <>
              <p className="text-sm font-semibold">Return by {d.return_by ? dayLabel(d.return_by) : ""}</p>
              <p className="text-xs">{d.forwarding_address ? `Send it to: ${d.forwarding_address}` : "Your tenant hasn't given a forwarding address yet."}</p>
              <SettleForm tenancyId={tenancyId} amountCents={d.amount_cents} onDone={done} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{d.has_forwarding_address ? "Your tenant gave a forwarding address. You'll see it when the tenancy ends." : ""}</p>
          )}
        </>
      )}
    </section>
  );
}
