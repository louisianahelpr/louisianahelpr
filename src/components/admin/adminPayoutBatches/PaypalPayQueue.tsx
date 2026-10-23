import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, Mail, AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { userFacingError } from "@/lib/userFacingError";
import { copyToClipboard } from "@/lib/nativeShare";
import { requireBiometric } from "@/lib/biometricGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminCard } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import { rpcErrorMessage } from "@/components/admin/adminRpcErrorCopy";
import { toneBadgeClasses } from "@/components/admin/tones";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import {
  buildPaypalQueueView,
  centsLabel,
  looksLikeTxnId,
  normaliseTxnId,
  notQueuedReason,
  type PayGroup,
  type PaypalQueueLine,
} from "./paypalPayQueue";

/**
 * Admin "Pay this Helpr" (PayPal Plan A, phase 4). Live PayPal Payouts was denied (owner 2026-10-23),
 * so the owner pays each Helpr BY HAND: send the total with PayPal Send Money, then press Mark paid
 * with PayPal's transaction ID. Members see "paid" only after that press. Shown only while the
 * paypal_payments switch reaches this admin; every RPC behind it refuses otherwise.
 */
export function PaypalPayQueue({ adminId }: { adminId: string | undefined }) {
  const qc = useQueryClient();
  const queryKey = ["admin-paypal-pay-queue", adminId] as const;
  const { data: lines = [], isInitialLoading, isError, error, refetch, isFetching } = useQuery<PaypalQueueLine[]>({
    queryKey,
    enabled: !!adminId,
    // Every Helpr's PayPal email and amount owed: never persisted to disk.
    meta: { persist: false },
    queryFn: async () => (unwrap(await supabase.rpc("admin_paypal_payout_queue")) ?? []) as PaypalQueueLine[],
  });
  const view = useMemo(() => buildPaypalQueueView(lines), [lines]);
  const [marking, setMarking] = useState<{ group: PayGroup; held: boolean } | null>(null);
  const [requeue, setRequeue] = useState<PayGroup | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey });

  return (
    <AdminCard
      title="Pay this Helpr (PayPal)"
      subtitle="Send each total with PayPal Send Money, then press Mark paid and paste PayPal's transaction ID. Helprs see it as paid only after that."
      action={
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      }
      contentClassName="space-y-4"
    >
      {isInitialLoading ? (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-ds-md border border-border/60 bg-background/40 p-4 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          title="We couldn't load the PayPal pay list."
          body={rpcErrorMessage("admin_paypal_payout_queue", error) ?? "Tap Try again. Nothing was sent or marked."}
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          <section aria-labelledby="pp-to-send" className="space-y-2">
            <h3 id="pp-to-send" className="text-ds-13 font-semibold text-foreground">To send ({view.toSend.length})</h3>
            {view.toSend.length === 0 ? (
              <EmptyState
                surfaceStyle={NESTED_EMPTY_SURFACE}
                variant="inline"
                icon={CheckCircle2}
                title="Nothing to send"
                body="Approved PayPal jobs appear here with the Helpr's PayPal email and the amount to send."
              />
            ) : (
              view.toSend.map((g) => <SendGroup key={g.key} group={g} onMarkPaid={() => setMarking({ group: g, held: false })} />)
            )}
          </section>

          {view.held.length > 0 && (
            <section aria-labelledby="pp-held" className="space-y-2">
              <h3 id="pp-held" className="text-ds-13 font-semibold text-foreground">Helpr changed their PayPal email ({view.held.length})</h3>
              {view.held.map((g) => (
                <HeldGroup key={g.key} group={g} onRequeue={() => setRequeue(g)} onMarkPaid={() => setMarking({ group: g, held: true })} />
              ))}
            </section>
          )}

          {view.notQueued.length > 0 && (
            <section aria-labelledby="pp-not-queued" className="space-y-2">
              <h3 id="pp-not-queued" className="text-ds-13 font-semibold text-foreground">Approved, not in the list yet ({view.notQueued.length})</h3>
              {view.notQueued.map((l) => (
                <div key={l.job_id ?? l.status} className="rounded-ds-md border border-border/60 bg-background/40 p-3 space-y-1">
                  <p className="text-ds-13 text-foreground break-words">
                    <span className="font-medium">{l.helper_name?.trim() || "Unnamed Helpr"}</span> · {l.job_title ?? "Job"}
                  </p>
                  <p className="text-ds-12 text-muted-foreground">{notQueuedReason(l.status)}</p>
                </div>
              ))}
            </section>
          )}

          {view.paid.length > 0 && (
            <section aria-labelledby="pp-paid" className="space-y-2">
              <h3 id="pp-paid" className="text-ds-13 font-semibold text-foreground">Marked paid, last 30 days</h3>
              <ul className="divide-y divide-border/60 rounded-ds-md border border-border/60">
                {view.paid.map((l) => (
                  <li key={l.payout_id} className="p-3 text-ds-12 flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-foreground break-words">
                      {l.helper_name?.trim() || "Unnamed Helpr"} · {l.line_kind === "tip" ? "Tip" : "Job pay"} · {l.job_title ?? "Job"}
                    </span>
                    <span className="text-muted-foreground tabular-nums break-all">
                      {centsLabel(l.amount_cents ?? 0)} · PayPal {l.external_txn_id}
                      {l.marked_paid_by_name ? ` · by ${l.marked_paid_by_name}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {marking && (
        <MarkPaidDialog
          group={marking.group}
          held={marking.held}
          onClose={() => setMarking(null)}
          onDone={() => { setMarking(null); void refresh(); }}
        />
      )}
      {requeue && (
        <RequeueDialog group={requeue} onClose={() => setRequeue(null)} onDone={() => { setRequeue(null); void refresh(); }} />
      )}
    </AdminCard>
  );
}

function EnvBadge({ env }: { env: string }) {
  if (env !== "sandbox") return null;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-ds-11 font-medium", toneBadgeClasses.warning)}>
      Test payment. Don't send real money.
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        if (await copyToClipboard(text)) toast.success(`${label} copied.`);
        else toast.error(`Couldn't copy the ${label.toLowerCase()}. Select it and copy it by hand.`);
      }}
    >
      <Copy className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Copy {label.toLowerCase()}
    </Button>
  );
}

function Lines({ group }: { group: PayGroup }) {
  return (
    <ul className="space-y-1">
      {group.lines.map((l) => (
        <li key={l.payout_id} className="flex items-start justify-between gap-3 text-ds-12">
          <span className="text-muted-foreground break-words min-w-0">
            {l.line_kind === "tip" ? "Tip" : "Job pay"} · {l.job_title ?? "Job"}
          </span>
          <span className="tabular-nums text-foreground shrink-0">{centsLabel(l.amount_cents ?? 0)}</span>
        </li>
      ))}
    </ul>
  );
}

function SendGroup({ group, onMarkPaid }: { group: PayGroup; onMarkPaid: () => void }) {
  const due = group.payOnOrAfter ? new Date(group.payOnOrAfter) : null;
  const early = due !== null && due.getTime() > Date.now();
  return (
    <div className="rounded-ds-md liquid-glass p-card space-y-3" data-testid="paypal-pay-group">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-ds-15 font-semibold text-foreground break-words">{group.helperName}</p>
          <p className="text-ds-13 text-foreground inline-flex items-center gap-1.5 break-all">
            <Mail className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            {group.destination}
          </p>
        </div>
        <p className="text-ds-20 font-bold tabular-nums text-foreground sm:text-right">Send {centsLabel(group.totalCents)}</p>
      </div>
      <Lines group={group} />
      <div className="flex flex-wrap items-center gap-2">
        <EnvBadge env={group.env} />
        {due && (
          <span className="inline-flex items-center gap-1 text-ds-11 text-muted-foreground">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {early ? `Pay on or after ${due.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : "Due now"}
          </span>
        )}
        {group.helperOnHold && (
          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-ds-11 font-medium", toneBadgeClasses.danger)}>
            Payouts on hold. Don't send.
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={group.destination} label="Email" />
        <CopyButton text={(group.totalCents / 100).toFixed(2)} label="Amount" />
        <Button type="button" size="sm" className="btn-grad-primary" onClick={onMarkPaid} disabled={group.helperOnHold}>
          <CheckCircle2 className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Mark paid
        </Button>
      </div>
    </div>
  );
}

function HeldGroup({ group, onRequeue, onMarkPaid }: { group: PayGroup; onRequeue: () => void; onMarkPaid: () => void }) {
  return (
    <div className="rounded-ds-md border border-border bg-background/40 p-card space-y-3" data-testid="paypal-held-group">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="text-ds-15 font-semibold text-foreground break-words">{group.helperName}</p>
          {group.currentDestination === group.destination ? (
            <>
              <p className="text-ds-12 text-muted-foreground">
                Changed their PayPal email after the job was approved. Check the change with them before you pay.
              </p>
              <p className="text-ds-12 text-foreground break-all">New email: {group.destination}</p>
            </>
          ) : (
            <>
              <p className="text-ds-12 text-muted-foreground">
                Changed their PayPal email after this was queued. Don't send to either email until you've checked the change with them.
              </p>
              <p className="text-ds-12 text-foreground break-all">Was: {group.destination}</p>
              <p className="text-ds-12 text-foreground break-all">Now: {group.currentDestination ?? "no PayPal email that can be paid yet"}</p>
            </>
          )}
        </div>
      </div>
      <Lines group={group} />
      <div className="flex flex-wrap items-center gap-2">
        <EnvBadge env={group.env} />
        <span className="text-ds-12 font-semibold tabular-nums text-foreground">{centsLabel(group.totalCents)} held</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onRequeue} disabled={!group.currentDestination}>
          Checked it: queue to {group.currentDestination === group.destination ? "this email" : "the new email"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onMarkPaid}>
          Already sent to the old email
        </Button>
      </div>
    </div>
  );
}

function MarkPaidDialog({ group, held, onClose, onDone }: { group: PayGroup; held: boolean; onClose: () => void; onDone: () => void }) {
  const [txn, setTxn] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = looksLikeTxnId(txn) && sent;
  const submit = async () => {
    if (!valid || busy) return;
    if (!(await requireBiometric(`Confirm you sent ${centsLabel(group.totalCents)} to ${group.helperName}`))) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_mark_paypal_payout_paid", {
      p_payout_ids: group.lines.map((l) => l.payout_id as string),
      p_external_txn_id: normaliseTxnId(txn),
      p_total_cents: group.totalCents,
      p_sent_before_hold: held,
    });
    setBusy(false);
    if (error) {
      report(error, { tags: { source: "PaypalPayQueue.markPaid" } });
      toast.error(rpcErrorMessage("admin_mark_paypal_payout_paid", error) ?? userFacingError(error, "Couldn't mark it paid. Nothing was changed. Try again."));
      return;
    }
    const outcome = (data as { outcome?: string } | null)?.outcome;
    toast.success(outcome === "already_paid" ? "Already marked paid with that ID." : `Marked paid. ${group.helperName} has been told.`);
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHero title={held ? "Record a payment sent before the email change" : "Mark paid"} />
        <div className="space-y-3">
          <DialogBody>
            <p>
              {held
                ? `Only if you already sent ${centsLabel(group.totalCents)} to ${group.destination} before the Helpr changed their email.`
                : `Send ${centsLabel(group.totalCents)} to ${group.destination} with PayPal Send Money first, then paste the transaction ID from PayPal's receipt.`}
            </p>
            {group.env === "sandbox" && <p className="font-medium">This is a test payment. Don't send real money.</p>}
          </DialogBody>
          <div className="space-y-1.5">
            <Label htmlFor="pp-txn">PayPal transaction ID</Label>
            <Input
              id="pp-txn"
              value={txn}
              onChange={(e) => setTxn(e.target.value)}
              placeholder="e.g. 9AB12345CD678901E"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={txn.trim() !== "" && !looksLikeTxnId(txn)}
            />
            {txn.trim() !== "" && !looksLikeTxnId(txn) && (
              <p className="text-ds-12 text-destructive">A PayPal transaction ID is letters and numbers only, usually 17.</p>
            )}
          </div>
          <label className="flex items-start gap-2 text-ds-13 text-foreground">
            <Checkbox checked={sent} onCheckedChange={(v) => setSent(v === true)} className="mt-0.5" />
            <span>I sent exactly {centsLabel(group.totalCents)} to {group.destination}.</span>
          </label>
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={onClose}>Cancel</DialogSecondaryAction>
          <DialogPrimaryAction onClick={() => void submit()} disabled={!valid || busy}>
            {busy ? "Saving…" : "Mark paid"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequeueDialog({ group, onClose, onDone }: { group: PayGroup; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [nothingSent, setNothingSent] = useState(false);
  const submit = async () => {
    if (busy || !nothingSent) return;
    setBusy(true);
    let failed = 0;
    for (const l of group.lines) {
      const { error } = await supabase.rpc("admin_requeue_held_paypal_payout", { p_payout_id: l.payout_id as string, p_confirm_no_send_money: true });
      if (error) {
        failed++;
        report(error, { tags: { source: "PaypalPayQueue.requeue" } });
        toast.error(rpcErrorMessage("admin_requeue_held_paypal_payout", error) ?? userFacingError(error, "Couldn't queue it to the new email. Try again."));
        break;
      }
    }
    setBusy(false);
    if (failed === 0) toast.success(`Queued to ${group.currentDestination}.`);
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHero title="Queue to the checked PayPal email" />
        <div className="space-y-3">
          <DialogBody>
            <p>
              Check with {group.helperName} that they set their PayPal email to {group.currentDestination} themselves.
              The held payout is canceled and {centsLabel(group.totalCents)} is queued to that email, ready to send.
            </p>
          </DialogBody>
          <label className="flex items-start gap-2 text-ds-13 text-foreground">
            <Checkbox checked={nothingSent} onCheckedChange={(v) => setNothingSent(v === true)} className="mt-0.5" />
            <span>No PayPal Send Money went out for this payout yet. (If it did, close this and mark it paid instead.)</span>
          </label>
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={onClose}>Cancel</DialogSecondaryAction>
          <DialogPrimaryAction onClick={() => void submit()} disabled={busy || !nothingSent}>
            {busy ? "Queuing…" : "Queue to new email"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
