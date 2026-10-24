import { useMemo, useState, type ReactNode } from "react";
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
import { Textarea } from "@/components/ui/textarea";
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
  DialogDestructiveAction,
} from "@/components/ui/dialog";
import {
  buildPaypalQueueView,
  centsLabel,
  looksLikeTxnId,
  normaliseTxnId,
  notQueuedReason,
  payBlockedCopy,
  QUEUE_NOW_REASONS,
  type PayGroup,
  type PaypalQueueLine,
} from "./paypalPayQueueView";

/**
 * Admin "Pay this Helpr" (PayPal Plan A, phase 4). Live PayPal Payouts was denied (owner 2026-10-23),
 * so the owner pays each Helpr BY HAND: send the total with PayPal Send Money, then press Mark paid
 * with PayPal's transaction ID. Members see "paid" only after that press.
 *
 * Shown while the paypal_payments switch reaches this admin, AND whenever PayPal money is owed even
 * with the switch off (lead + lh-silent-failure review 2026-10-23): the read is admin-only and never
 * hidden; recording a payment (Mark paid, re-queue, cancel) still needs the switch.
 */
export function PaypalPayQueue({ adminId, switchOn }: { adminId: string | undefined; switchOn: boolean }) {
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
  const [canceling, setCanceling] = useState<PaypalQueueLine | null>(null);
  const [queuing, setQueuing] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey });
  const owed = view.toSend.length + view.held.length + view.notQueued.length + view.tipsOwed.length;

  // Off and nothing owed: nothing to show. A failed read is never hidden (owed money may be there).
  if (!switchOn && !isError && !isInitialLoading && owed === 0) return null;
  if (!switchOn && isInitialLoading) return null;

  const queueNow = async (l: PaypalQueueLine) => {
    if (!l.job_id || queuing) return;
    setQueuing(l.job_id);
    const { data, error: fnError } = await supabase.functions.invoke("release-payout", { body: { job_id: l.job_id } });
    setQueuing(null);
    const outcome = (data as { outcome?: string; reason?: string } | null) ?? null;
    if (fnError && !outcome?.outcome) {
      report(fnError, { tags: { source: "PaypalPayQueue.queueNow" } });
      toast.error(userFacingError(fnError, "Couldn't add it to the list. Nothing was sent. Try again."));
    } else if (outcome?.outcome === "queued" || outcome?.outcome === "already_queued") {
      toast.success("Added to the list to send.");
    } else if (outcome?.outcome === "queued_held") {
      toast.success("Added, but held: the Helpr's PayPal email changed after they were hired. Check it with them.");
    } else {
      toast.error(`Not added: ${notQueuedReason(outcome?.reason ?? "not_queued_yet")}`);
    }
    void refresh();
  };

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
      {!switchOn && (
        <p className={cn("rounded-ds-md px-3 py-2 text-ds-12", toneBadgeClasses.warning)}>
          PayPal payments are switched off. You can see what is owed; turn the switch on for testers in Admin &gt; Settings to record a payment.
        </p>
      )}
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
              view.toSend.map((g) => (
                <SendGroup
                  key={g.key}
                  group={g}
                  canRecord={switchOn}
                  onMarkPaid={() => setMarking({ group: g, held: false })}
                  onCancel={(l) => setCanceling(l)}
                />
              ))
            )}
          </section>

          {view.held.length > 0 && (
            <section aria-labelledby="pp-held" className="space-y-2">
              <h3 id="pp-held" className="text-ds-13 font-semibold text-foreground">Helpr changed their PayPal email ({view.held.length})</h3>
              {view.held.map((g) => (
                <HeldGroup
                  key={g.key}
                  group={g}
                  canRecord={switchOn}
                  onRequeue={() => setRequeue(g)}
                  onMarkPaid={() => setMarking({ group: g, held: true })}
                />
              ))}
            </section>
          )}

          {view.notQueued.length > 0 && (
            <section aria-labelledby="pp-not-queued" className="space-y-2">
              <h3 id="pp-not-queued" className="text-ds-13 font-semibold text-foreground">Approved, not in the list yet ({view.notQueued.length})</h3>
              {view.notQueued.map((l) => (
                <div key={l.job_id ?? l.status} className="rounded-ds-md border border-border/60 bg-background/40 p-3 space-y-2">
                  <p className="text-ds-13 text-foreground break-words">
                    <span className="font-medium">{l.helper_name?.trim() || "Unnamed Helpr"}</span> · {l.job_title ?? "Job"}
                  </p>
                  <p className="text-ds-12 text-muted-foreground">{notQueuedReason(l.status)}</p>
                  {QUEUE_NOW_REASONS.has(l.status) && (
                    <Button type="button" size="sm" variant="outline" onClick={() => void queueNow(l)} disabled={queuing !== null}>
                      {queuing === l.job_id ? "Adding…" : "Queue now"}
                    </Button>
                  )}
                </div>
              ))}
            </section>
          )}

          {view.tipsOwed.length > 0 && (
            <section aria-labelledby="pp-tips-owed" className="space-y-2">
              <h3 id="pp-tips-owed" className="text-ds-13 font-semibold text-foreground">Tips owed, not in the list yet ({view.tipsOwed.length})</h3>
              {view.tipsOwed.map((l) => (
                <div key={l.tip_id ?? l.job_id ?? l.status} className="rounded-ds-md border border-border/60 bg-background/40 p-3 space-y-1">
                  <p className="text-ds-13 text-foreground break-words">
                    <span className="font-medium">{l.helper_name?.trim() || "Unnamed Helpr"}</span> · Tip · {l.job_title ?? "Job"} · {centsLabel(l.amount_cents ?? 0)}
                  </p>
                  <p className="text-ds-12 text-muted-foreground">
                    {l.status === "no_payable_paypal_account"
                      ? "The Helpr hasn't added a PayPal email yet. The tip joins the list once they do."
                      : "Paid by the poster but not added to the list yet."}
                  </p>
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
      {canceling && (
        <CancelDialog line={canceling} onClose={() => setCanceling(null)} onDone={() => { setCanceling(null); void refresh(); }} />
      )}
    </AdminCard>
  );
}

function Badge({ tone, children }: { tone: "warning" | "danger"; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-ds-11 font-medium", toneBadgeClasses[tone])}>
      {children}
    </span>
  );
}

function EnvBadge({ env }: { env: string }) {
  if (env !== "sandbox") return null;
  return <Badge tone="warning">Test payment. Don't send real money.</Badge>;
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

function Lines({ group, onCancel }: { group: PayGroup; onCancel?: (l: PaypalQueueLine) => void }) {
  return (
    <ul className="space-y-1">
      {group.lines.map((l) => (
        <li key={l.payout_id} className="flex items-start justify-between gap-3 text-ds-12">
          <span className="text-muted-foreground break-words min-w-0">
            {l.line_kind === "tip" ? "Tip" : "Job pay"} · {l.job_title ?? "Job"}
            {onCancel && l.line_kind === "job" && (
              <>
                {" · "}
                <button type="button" className="text-ds-12 text-muted-foreground underline underline-offset-2" onClick={() => onCancel(l)}>
                  Cancel
                </button>
              </>
            )}
          </span>
          <span className="tabular-nums text-foreground shrink-0">{centsLabel(l.amount_cents ?? 0)}</span>
        </li>
      ))}
    </ul>
  );
}

function SendGroup({ group, canRecord, onMarkPaid, onCancel }: {
  group: PayGroup;
  canRecord: boolean;
  onMarkPaid: () => void;
  onCancel: (l: PaypalQueueLine) => void;
}) {
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
      <Lines group={group} onCancel={canRecord ? onCancel : undefined} />
      <div className="flex flex-wrap items-center gap-2">
        <EnvBadge env={group.env} />
        {group.payBlocked && <Badge tone="danger">{payBlockedCopy(group.payBlocked)}</Badge>}
        {due && (
          <span className="inline-flex items-center gap-1 text-ds-11 text-muted-foreground">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {early ? `Pay on or after ${due.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : "Due now"}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={group.destination} label="Email" />
        <CopyButton text={(group.totalCents / 100).toFixed(2)} label="Amount" />
        {canRecord && (
          <Button type="button" size="sm" className="btn-grad-primary" onClick={onMarkPaid}>
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> Mark paid
          </Button>
        )}
      </div>
    </div>
  );
}

function HeldGroup({ group, canRecord, onRequeue, onMarkPaid }: { group: PayGroup; canRecord: boolean; onRequeue: () => void; onMarkPaid: () => void }) {
  const jobLines = group.lines.filter((l) => l.line_kind === "job").length;
  return (
    <div className="rounded-ds-md border border-border bg-background/40 p-card space-y-3" data-testid="paypal-held-group">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="text-ds-15 font-semibold text-foreground break-words">{group.helperName}</p>
          {group.needsRecheck ? (
            <>
              <p className="text-ds-12 text-muted-foreground">
                Changed their PayPal email after they were hired. Check the change with them before you pay.
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
        {group.payBlocked && <Badge tone="danger">{payBlockedCopy(group.payBlocked)}</Badge>}
        <span className="text-ds-12 font-semibold tabular-nums text-foreground">{centsLabel(group.totalCents)} held</span>
      </div>
      {canRecord && (
        <div className="flex flex-wrap gap-2">
          {jobLines > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={onRequeue} disabled={!group.currentDestination}>
              Checked it: queue to {group.needsRecheck ? "this email" : "the new email"}
            </Button>
          )}
          {/* A row held because its email changed after the hire carries the NEW email: nothing can have
              gone out "before the change", so only the re-check frees it. */}
          {!group.needsRecheck && (
            <Button type="button" size="sm" variant="ghost" onClick={onMarkPaid}>
              Already sent to the old email
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function MarkPaidDialog({ group, held, onClose, onDone }: { group: PayGroup; held: boolean; onClose: () => void; onDone: () => void }) {
  const [txn, setTxn] = useState("");
  const [sent, setSent] = useState(false);
  const [beforeBlock, setBeforeBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const blocked = !!group.payBlocked;
  const valid = looksLikeTxnId(txn) && sent && (!blocked || beforeBlock);
  const submit = async () => {
    if (!valid || busy) return;
    if (!(await requireBiometric(`Confirm you sent ${centsLabel(group.totalCents)} to ${group.helperName}`))) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_mark_paypal_payout_paid", {
      p_payout_ids: group.lines.map((l) => l.payout_id as string),
      p_external_txn_id: normaliseTxnId(txn),
      p_total_cents: group.totalCents,
      p_sent_before_hold: held || blocked,
    });
    setBusy(false);
    if (error) {
      report(error, { tags: { source: "PaypalPayQueue.markPaid" } });
      toast.error(rpcErrorMessage("admin_mark_paypal_payout_paid", error) ?? userFacingError(error, "Couldn't mark it paid. Nothing was changed. Try again."));
      return;
    }
    const answer = (data as { outcome?: string; jobs_not_released?: string[] } | null) ?? null;
    if (answer?.outcome === "already_paid") {
      toast.success("Already marked paid with that ID.");
    } else if (answer?.outcome === "marked_paid") {
      toast.success(`Marked paid. ${group.helperName} has been told.`);
      if ((answer.jobs_not_released ?? []).length > 0) {
        toast.warning("Recorded as paid, but a job had moved on (a dispute or chargeback) and was not marked released. Check that job.");
      }
    } else {
      report(new Error(`admin_mark_paypal_payout_paid answered ${JSON.stringify(data)}`), { tags: { source: "PaypalPayQueue.markPaid" } });
      toast.error("We couldn't confirm it was marked paid. Refresh the list before you try again.");
    }
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
          {blocked && (
            <label className="flex items-start gap-2 text-ds-13 text-foreground">
              <Checkbox checked={beforeBlock} onCheckedChange={(v) => setBeforeBlock(v === true)} className="mt-0.5" />
              <span>{payBlockedCopy(group.payBlocked as string)} I already sent it before that, and I'm recording it.</span>
            </label>
          )}
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
  // Job pay only: a tip line is re-queued by its own flow, and says so below.
  const jobLines = group.lines.filter((l) => l.line_kind === "job");
  const tipLines = group.lines.length - jobLines.length;
  const submit = async () => {
    if (busy || !nothingSent) return;
    setBusy(true);
    let moved = 0;
    for (const l of jobLines) {
      const { error } = await supabase.rpc("admin_requeue_held_paypal_payout", { p_payout_id: l.payout_id as string, p_confirm_no_send_money: true });
      if (error) {
        report(error, { tags: { source: "PaypalPayQueue.requeue" } });
        const why = rpcErrorMessage("admin_requeue_held_paypal_payout", error) ?? userFacingError(error, "Couldn't queue it to the checked email. Try again.");
        if (moved > 0) toast.error(`${moved} of ${jobLines.length} queued, then it stopped`, { description: why });
        else toast.error(why);
        setBusy(false);
        onDone();
        return;
      }
      moved++;
    }
    setBusy(false);
    toast.success(`Queued to ${group.currentDestination}.${tipLines > 0 ? ` ${tipLines} tip line${tipLines === 1 ? "" : "s"} stay held.` : ""}`);
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
              The held job pay is canceled and queued again to that email, ready to send.
              {tipLines > 0 ? " Tip lines stay held." : ""}
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
            {busy ? "Queuing…" : "Queue to this email"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ line, onClose, onDone }: { line: PaypalQueueLine; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [nothingSent, setNothingSent] = useState(false);
  const [reason, setReason] = useState("");
  const valid = nothingSent && reason.trim().length >= 5;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_cancel_paypal_payout", {
      p_payout_id: line.payout_id as string,
      p_confirm_no_send_money: true,
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (error || (data as { outcome?: string } | null)?.outcome !== "canceled") {
      if (error) report(error, { tags: { source: "PaypalPayQueue.cancel" } });
      toast.error(rpcErrorMessage("admin_cancel_paypal_payout", error) ?? userFacingError(error, "Couldn't cancel it. Nothing was changed. Try again."));
      onDone();
      return;
    }
    toast.success("Payout canceled. The job stays approved; press Queue now to put it back.");
    onDone();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHero title="Cancel this payout" />
        <div className="space-y-3">
          <DialogBody>
            <p>
              {centsLabel(line.amount_cents ?? 0)} for "{line.job_title ?? "this job"}" comes off the list, and the money can be refunded
              instead. If you already sent it, don't cancel: mark it paid.
            </p>
          </DialogBody>
          <Textarea aria-label="Why it is canceled" placeholder="Why it is canceled (shown in the audit log)." value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          <label className="flex items-start gap-2 text-ds-13 text-foreground">
            <Checkbox checked={nothingSent} onCheckedChange={(v) => setNothingSent(v === true)} className="mt-0.5" />
            <span>No PayPal Send Money went out for this payout.</span>
          </label>
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={onClose}>Keep it</DialogSecondaryAction>
          <DialogDestructiveAction onClick={() => void submit()} disabled={!valid || busy}>
            {busy ? "Canceling…" : "Cancel payout"}
          </DialogDestructiveAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
