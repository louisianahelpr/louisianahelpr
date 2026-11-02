/**
 * Homes lease (owner D4: our Louisiana template only, approved as written; 20261019110137).
 *
 *   Landlord: "Write the lease" opens the template one step at a time (each Next saves the draft), then
 *             the whole lease to read, a tick for each clause both sides initial, agreement to sign
 *             electronically and a typed name: "Sign and send". A sent lease can be taken back to change
 *             it. A tenant's change request shows on the draft.
 *   Tenant:   once sent, "Read and sign": the whole lease, a tick for each initialed clause, agreement to
 *             sign electronically, a typed name. Or "Ask for changes" with a note. The sheet signs the
 *             version it opened with; if the landlord changes the lease meanwhile, the sheet says so and
 *             starts over on the new words (lead review #7).
 *   Both:     every signed lease stays on the tenancy, live or ended, and in SignedLeases (below) after
 *             the tenancy is gone: read it, download the PDF (its fingerprint re-checked first, #5).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { rentalsErrorMessage } from "@/lib/rentals/copy";
import { report } from "@/lib/errorLogger";
import {
  LEASE_FIELDS,
  LEASE_INITIALED,
  leaseInitialKeys,
  LEASE_STEPS,
  LEASE_TEMPLATE_VERSION,
  cleanLeaseFields,
  initialLeaseFields,
  isFieldShown,
  missingLeaseFields,
  type LeaseField,
  type LeaseFields,
} from "@/lib/rentals/leaseTemplate";
import {
  discardLease,
  fetchLease,
  isOpenLease,
  leaseSections,
  requestLeaseChanges,
  saveLeaseDraft,
  sendSavedLease,
  signLease,
  verifiedLeaseSections,
  withdrawLease,
  type OpenLease,
  type SignedLease,
} from "@/lib/rentals/lease";
import { LeaseText, MY_LEASES_KEY, ReadSigned, SignedRow, dayOf } from "./LeaseSigned";

export { SignedLeases, downloadLease } from "./LeaseSigned";

const leaseKey = (tenancyId: string) => ["rent-lease", tenancyId];
/** The EPA pamphlet a tenant of a pre-1978 home gets before signing (40 CFR 745.107). */
const EPA_PAMPHLET = "https://www.epa.gov/lead/protect-your-family-lead-your-home-real-estate-disclosure";



/** A tick per initialed clause, then agreement to sign electronically and a typed name (lead review #3). */
function SignBlock(props: {
  fields: LeaseFields;
  ticks: Record<string, boolean>;
  setTicks: (f: (t: Record<string, boolean>) => Record<string, boolean>) => void;
  consent: boolean;
  setConsent: (v: boolean) => void;
  name: string;
  setName: (v: string) => void;
  nameId: string;
}) {
  const initialed = LEASE_INITIALED.filter((c) => props.fields[c.key] === true);
  return (
    <div className="space-y-3">
      {initialed.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Initial each of these</legend>
          {initialed.map((c) => (
            <label key={c.key} className="flex min-h-11 items-start gap-2 text-sm">
              <Checkbox checked={props.ticks[c.key] === true} onCheckedChange={(v) => props.setTicks((t) => ({ ...t, [c.key]: v === true }))} aria-label={c.label} />
              <span>{c.label}</span>
            </label>
          ))}
        </fieldset>
      )}
      {/* Consent is not an initial: its own line, with the signature (coordinator, 2026-10-19). */}
      <div className="space-y-3 border-t border-border pt-3">
        <label className="flex min-h-11 items-start gap-2 text-sm font-medium">
          <Checkbox checked={props.consent} onCheckedChange={(v) => props.setConsent(v === true)} aria-label="I agree to sign electronically" />
          <span>I agree to sign this lease electronically.</span>
        </label>
        <div className="space-y-1">
          <label htmlFor={props.nameId} className="text-sm font-medium">
            Type your full name to sign
          </label>
          <Input id={props.nameId} value={props.name} maxLength={120} autoComplete="name" onChange={(e) => props.setName(e.target.value)} />
        </div>
      </div>
    </div>
  );
}

function ticked(fields: LeaseFields, ticks: Record<string, boolean>): { keys: string[]; all: boolean } {
  const need = leaseInitialKeys(fields);
  return { keys: need.filter((k) => ticks[k]), all: need.every((k) => ticks[k]) };
}

function FieldInput({ field, value, onChange }: { field: LeaseField; value: LeaseFields[string] | undefined; onChange: (v: string | boolean) => void }) {
  const id = `lease-${field.key}`;
  if (field.kind === "yes") {
    return (
      <label htmlFor={id} className="flex items-center justify-between gap-3 py-1 text-sm">
        <span>{field.label}</span>
        <Switch id={id} checked={value === true} onCheckedChange={(c) => onChange(c)} />
      </label>
    );
  }
  const str = typeof value === "string" ? value : "";
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {field.label}
      </label>
      {field.kind === "choice" ? (
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={id}>
          <span id={id} className="sr-only">
            {field.label}
          </span>
          {field.options?.map((o) => (
            <Button key={o.value} type="button" size="sm" variant={str === o.value ? "default" : "outline"} aria-pressed={str === o.value} className="rounded-full" onClick={() => onChange(o.value)}>
              {o.label}
            </Button>
          ))}
        </div>
      ) : field.kind === "long" ? (
        <Textarea id={id} value={str} maxLength={4000} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input
          id={id}
          className="min-w-0"
          value={str}
          maxLength={field.kind === "text" ? 400 : 40}
          type={field.kind === "date" ? "date" : "text"}
          inputMode={field.kind === "money" ? "decimal" : field.kind === "number" ? "numeric" : undefined}
          placeholder={field.kind === "money" ? "$" : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
    </div>
  );
}

/** The landlord's editor: one step at a time, saved on each Next; then read, initial, sign and send. */
function LeaseEditor({ tenancyId, draft, prefill, onClose }: { tenancyId: string; draft: OpenLease | null; prefill?: LeaseFields; onClose: () => void }) {
  const qc = useQueryClient();
  const [fields, setFields] = useState<LeaseFields>(() => ({ ...initialLeaseFields(), ...prefill, ...(draft?.fields ?? {}) }));
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const reviewing = step === LEASE_STEPS.length;
  const missing = useMemo(() => missingLeaseFields(fields), [fields]);
  // The words as they will be stored (normalised), so what the landlord reads is what is hashed.
  const sections = useMemo(() => (reviewing ? leaseSections(LEASE_TEMPLATE_VERSION, cleanLeaseFields(fields)) ?? [] : []), [reviewing, fields]);
  const refresh = () => void qc.invalidateQueries({ queryKey: leaseKey(tenancyId) });
  const initials = ticked(fields, ticks);

  const save = useMutation({
    mutationFn: () => saveLeaseDraft(tenancyId, fields),
    onSuccess: () => {
      refresh();
      setStep((s) => s + 1);
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  const send = useMutation({
    // Saved, read back and re-hashed before anything is sent (lead review round 3 M1a).
    mutationFn: () => sendSavedLease(tenancyId, fields, name, consent, initials.keys),
    onSuccess: () => {
      toast("Signed and sent. Your tenant was told.");
      refresh();
      onClose();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });

  const stepFields = reviewing ? [] : LEASE_FIELDS.filter((f) => f.step === LEASE_STEPS[step].id && isFieldShown(f, fields));
  const set = (k: string, v: string | boolean) => setFields((cur) => ({ ...cur, [k]: v }));

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {reviewing ? "Read the whole lease, then sign" : `Step ${step + 1} of ${LEASE_STEPS.length}: ${LEASE_STEPS[step].hint}`}
      </p>
      {draft?.change_request && (
        <p className="rounded-lg bg-muted p-2 text-xs" data-testid="lease-change-request">
          Your tenant asked: {draft.change_request}
        </p>
      )}
      {!reviewing ? (
        <div className="space-y-3">
          <h3 className="text-base font-semibold">{LEASE_STEPS[step].title}</h3>
          {stepFields.map((f) => (
            <FieldInput key={f.key} field={f} value={fields[f.key]} onChange={(v) => set(f.key, v)} />
          ))}
        </div>
      ) : (
        <>
          {missing.length > 0 ? (
            <div role="alert" className="space-y-1 rounded-lg bg-muted p-2 text-xs">
              <p className="font-medium">Fill these in before you sign:</p>
              <ul className="list-disc pl-5">
                {missing.slice(0, 8).map((f) => (
                  <li key={f.key}>
                    <button type="button" className="underline" onClick={() => setStep(LEASE_STEPS.findIndex((s) => s.id === f.step))}>
                      {f.label}
                    </button>
                  </li>
                ))}
              </ul>
              {missing.length > 8 && <p>and {missing.length - 8} more.</p>}
            </div>
          ) : null}
          <div className="max-h-[45dvh] overflow-y-auto rounded-lg border border-border p-3">
            <LeaseText sections={sections} />
          </div>
          <SignBlock fields={fields} ticks={ticks} setTicks={setTicks} consent={consent} setConsent={setConsent} name={name} setName={setName} nameId="lease-landlord-name" />
          <p className="text-xs text-muted-foreground">Your tenant gets it to read and sign.</p>
        </>
      )}
      <SheetFooter>
        <SheetSecondaryAction type="button" onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}>
          {step === 0 ? "Close" : "Back"}
        </SheetSecondaryAction>
        {!reviewing ? (
          <SheetPrimaryAction type="button" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : step === LEASE_STEPS.length - 1 ? "Save and read it" : "Save and next"}
          </SheetPrimaryAction>
        ) : (
          <SheetPrimaryAction
            type="button"
            disabled={send.isPending || missing.length > 0 || name.trim().length < 2 || !consent || !initials.all}
            onClick={() => send.mutate()}
          >
            {send.isPending ? "Sending…" : "Sign and send"}
          </SheetPrimaryAction>
        )}
      </SheetFooter>
    </div>
  );
}

/** The tenant reads and signs, or asks for changes. `lease` is the version the sheet opened with. */
function LeaseSign({ tenancyId, lease, onClose }: { tenancyId: string; lease: OpenLease; onClose: () => void }) {
  const qc = useQueryClient();
  const fields = lease.fields;
  // The words this sheet shows, rendered once, and their fingerprint checked against the one the landlord
  // signed before Sign can be pressed (lead review round 3 M1b, L7).
  const verified = useQuery({ queryKey: ["rent-lease-verified", lease.id, lease.sent_at, lease.body_sha256], queryFn: () => verifiedLeaseSections(lease) });
  const sections = verified.data?.ok ? verified.data.sections : null;
  const mismatch = verified.data !== undefined && !verified.data.ok && verified.data.reason === "mismatch";
  useEffect(() => {
    if (mismatch) report(new Error("lease fingerprint mismatch"), { severity: "error", tags: { source: "rentalsLease.signHash" }, context: { lease_id: lease.id } });
  }, [mismatch, lease.id]);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState("");
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: leaseKey(tenancyId) });
  const initials = ticked(fields, ticks);
  const sign = useMutation({
    mutationFn: () => signLease(lease, lease.body_sha256 as string, name, consent, initials.keys),
    onSuccess: () => {
      toast("Lease signed. You both can download it any time.");
      refresh();
      void qc.invalidateQueries({ queryKey: MY_LEASES_KEY });
      onClose();
    },
    onError: (e) => {
      toast.error(rentalsErrorMessage(e));
      // Any refusal refetches the lease: if it moved, signed or went, the sheet's notice takes over (round 3 M2).
      refresh();
    },
  });
  const ask = useMutation({
    mutationFn: () => requestLeaseChanges(lease.id, note),
    onSuccess: () => {
      toast("Sent to your landlord.");
      refresh();
      onClose();
    },
    onError: (e) => {
      toast.error(rentalsErrorMessage(e));
      refresh();
    },
  });
  if (verified.isPending) return <div className="h-40 animate-pulse rounded-lg bg-muted" role="status" aria-label="Loading the lease" />;
  if (verified.isError) return <p className="text-sm">Couldn't open the lease. Close and try again.</p>;
  if (!sections) {
    return verified.data && !verified.data.ok && verified.data.reason === "mismatch" ? (
      <p role="alert" className="rounded-lg bg-muted p-3 text-sm" data-testid="lease-record-mismatch">
        This lease record doesn't match. Ask your landlord to send it again.
      </p>
    ) : (
      <p className="text-sm">This lease needs the newest app. Update the app to read it.</p>
    );
  }
  const ready = consent && name.trim().length >= 2 && initials.all;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {lease.landlord_signed_name} signed this on {dayOf(lease.landlord_signed_at)}. Read all of it before you sign.
      </p>
      {fields.built_before_1978 === true && (
        <p className="text-xs">
          This home was built before 1978. Read the EPA pamphlet first:{" "}
          <a className="underline" href={EPA_PAMPHLET} target="_blank" rel="noreferrer">
            Protect Your Family From Lead in Your Home
          </a>
          .
        </p>
      )}
      <div className="max-h-[45dvh] overflow-y-auto rounded-lg border border-border p-3">
        <LeaseText sections={sections} />
      </div>
      {asking ? (
        <div className="space-y-2">
          <label htmlFor="lease-change-note" className="text-sm font-medium">
            What would you like changed?
          </label>
          <Textarea id="lease-change-note" value={note} maxLength={1000} rows={3} onChange={(e) => setNote(e.target.value)} />
          <SheetFooter>
            <SheetSecondaryAction type="button" onClick={() => setAsking(false)}>
              Back
            </SheetSecondaryAction>
            <SheetPrimaryAction type="button" disabled={ask.isPending || note.trim().length < 3} onClick={() => ask.mutate()}>
              {ask.isPending ? "Sending…" : "Send to landlord"}
            </SheetPrimaryAction>
          </SheetFooter>
        </div>
      ) : (
        <>
          <SignBlock fields={fields} ticks={ticks} setTicks={setTicks} consent={consent} setConsent={setConsent} name={name} setName={setName} nameId="lease-tenant-name" />
          <SheetFooter>
            <SheetSecondaryAction type="button" onClick={() => setAsking(true)}>
              Ask for changes
            </SheetSecondaryAction>
            <SheetPrimaryAction type="button" disabled={sign.isPending || !ready} onClick={() => sign.mutate()}>
              {sign.isPending ? "Signing…" : "Sign the lease"}
            </SheetPrimaryAction>
          </SheetFooter>
        </>
      )}
    </div>
  );
}

export function LeasePanel({ tenancyId, homeLabel, prefill }: { tenancyId: string; homeLabel: string; prefill?: LeaseFields }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: leaseKey(tenancyId), queryFn: () => fetchLease(tenancyId) });
  const [sheet, setSheet] = useState<null | "edit" | { sign: OpenLease } | { read: SignedLease }>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: leaseKey(tenancyId) });
  const withdraw = useMutation({
    mutationFn: (id: string) => withdrawLease(id),
    onSuccess: () => {
      toast("Taken back. Change it and send it again.");
      refresh();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  const discard = useMutation({
    mutationFn: (id: string) => discardLease(id),
    onSuccess: refresh,
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  if (q.isError) return <p className="text-xs text-muted-foreground">Couldn't load the lease.</p>;
  // null: not deployed yet (round 2 #4): nothing, never a guessed side.
  if (!q.data) return null;
  const r = q.data;
  const open = r.open;
  const landlord = r.side === "landlord";
  // An ended tenancy shows only what was signed.
  if (r.tenancy_status === "ended" && r.signed.length === 0) return null;
  // Lead review #7: the sheet signs the version it opened with; a different one now is a changed lease.
  const signing = sheet !== null && typeof sheet === "object" && "sign" in sheet ? sheet.sign : null;
  // Round 3 M3: the lease this sheet opened is now signed (a double tap, or a lost reply): say so.
  const signedNow = signing !== null ? r.signed.find((l) => l.id === signing.id) ?? null : null;
  const changed =
    signing !== null &&
    !signedNow &&
    (!isOpenLease(open) ||
      open.id !== signing.id ||
      open.status !== "sent" ||
      open.sent_at !== signing.sent_at ||
      open.body_sha256 !== signing.body_sha256 ||
      open.template_version !== signing.template_version);

  return (
    <section className="space-y-2 border-t border-border pt-3" aria-label="Lease">
      <p className="text-sm font-medium">Lease</p>
      {r.signed.map((l) => (
        <SignedRow key={l.id} l={l} homeLabel={homeLabel} onRead={() => setSheet({ read: l })} />
      ))}
      {r.tenancy_status === "active" &&
        (landlord ? (
          !isOpenLease(open) ? (
            <div className="space-y-1">
              {r.signed.length === 0 && <p className="text-xs text-muted-foreground">Use our Louisiana lease: fill it in and sign here, then your tenant signs in the app. You both get the PDF.</p>}
              <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => setSheet("edit")}>
                {r.signed.length === 0 ? "Write the lease" : "Write a new lease"}
              </Button>
            </div>
          ) : open.status === "draft" ? (
            <div className="space-y-1">
              {open.change_request && <p className="rounded-lg bg-muted p-2 text-xs">Your tenant asked: {open.change_request}</p>}
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Draft saved {dayOf(open.updated_at)}</span>
                <span className="flex shrink-0 gap-1">
                  <Button type="button" size="sm" variant="ghost" disabled={discard.isPending} onClick={() => discard.mutate(open.id)}>
                    Delete
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => setSheet("edit")}>
                    Continue
                  </Button>
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">Sent {dayOf(open.sent_at)}. Waiting for your tenant to sign.</span>
              <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={withdraw.isPending} onClick={() => withdraw.mutate(open.id)}>
                Take back
              </Button>
            </div>
          )
        ) : !open ? (
          r.signed.length === 0 && <p className="text-xs text-muted-foreground">No lease here yet. Your landlord can send one for you to sign in the app.</p>
        ) : !isOpenLease(open) || open.status === "draft" ? (
          <p className="text-xs text-muted-foreground">
            {open.change_request ? `You asked for changes: "${open.change_request}". Your landlord is updating the lease.` : "Your landlord is preparing your lease."}
          </p>
        ) : (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">Your lease is ready to sign.</span>
            <Button type="button" size="sm" className="rounded-full" onClick={() => setSheet({ sign: open })}>
              Read and sign
            </Button>
          </div>
        ))}
      <Sheet open={sheet !== null} onOpenChange={(o) => !o && setSheet(null)}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto">
          <SheetHero title={sheet === "edit" ? "Lease" : signing ? "Your lease" : "Signed lease"} />
          {sheet === "edit" && <LeaseEditor tenancyId={tenancyId} draft={isOpenLease(open) && open.status === "draft" ? open : null} prefill={prefill} onClose={() => setSheet(null)} />}
          {signing && changed && (
            <div role="alert" className="space-y-2 rounded-lg bg-muted p-3 text-sm" data-testid="lease-changed">
              <p>Your landlord changed this lease while you were reading it. Nothing was signed.</p>
              {isOpenLease(open) && open.status === "sent" ? (
                <Button type="button" size="sm" className="rounded-full" onClick={() => setSheet({ sign: open })}>
                  Read the new version
                </Button>
              ) : (
                <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => setSheet(null)}>
                  Close
                </Button>
              )}
            </div>
          )}
          {signedNow && (
            <div className="space-y-3" data-testid="lease-now-signed">
              <p role="status" className="rounded-lg bg-muted p-3 text-sm">This lease is signed.</p>
              <ReadSigned l={signedNow} homeLabel={homeLabel} />
            </div>
          )}
          {signing && !changed && !signedNow && <LeaseSign key={`${signing.id}:${signing.sent_at}`} tenancyId={tenancyId} lease={signing} onClose={() => setSheet(null)} />}
          {sheet !== null && typeof sheet === "object" && "read" in sheet && <ReadSigned l={sheet.read} homeLabel={homeLabel} />}
        </SheetContent>
      </Sheet>
    </section>
  );
}
