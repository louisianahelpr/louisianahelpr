import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ShieldCheck, FileText, ExternalLink, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { formatShortDate } from "@/lib/format";
import {
  Dialog,
  DialogPrimaryAction,
  DialogSecondaryAction,
  DialogContent,
  DialogFooter,
  DialogHero,
} from "@/components/ui/dialog";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { AdminViewShell, AdminCard } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import { userFacingError } from "@/lib/userFacingError";

interface PendingRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  license_url: string | null;
  insurance_url: string | null;
  license_status: string;
  insurance_status: string;
  is_licensed: boolean;
  is_insured: boolean;
  /** Claimed company name — check it against the name printed on the doc. */
  business_name: string | null;
  submitted_at: string;
}

const AdminCredentialQueue = () => {
  const qc = useQueryClient();
  const queryKey = ["admin-credential-queue"];
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ userId: string; credential: "license" | "insurance" } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  // Bulk selection, keyed "<userId>:<credential>" — the same key `busy` uses,
  // because the unit of decision is one CREDENTIAL, not one person. Someone
  // whose licence is clean and whose insurance expired must be approvable on
  // the licence alone.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  // Expiry date per credential, keyed the same "<userId>:<credential>" way.
  // review_credential() REFUSES to verify without one (migration
  // 20260903012612), because get_user_credential_tier() fails closed on a NULL
  // expiry — approving with no date would leave a helper wearing a Licensed
  // badge that the job gate silently ignores.
  //
  // Deliberately NOT pre-filled with "a year from today": a default is a date
  // nobody reads off the document, which is the exact failure being designed
  // out. An empty box the admin has to fill from the COI in front of them is
  // the point.
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const today = new Date().toISOString().slice(0, 10);
  const hasExpiry = (key: string) => (expiry[key] ?? "") > today;

  const toggleSelected = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Clearing a date must also untick the row, or a ticked-then-cleared
  // credential rides along in the bulk approve and fails server-side.
  const setExpiryFor = (key: string, value: string) => {
    setExpiry((prev) => ({ ...prev, [key]: value }));
    if (!(value > today)) {
      setSelected((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // unwrap() throws into React Query so a failed RPC flips isError on
  // instead of degrading silently to "queue is empty". See CLAUDE.md
  // "Never drop the Supabase `error`" rule.
  const { data: rows, isInitialLoading, isError, refetch } = useInstantQuery<PendingRow[]>({
    key: queryKey,
    fallback: [],
    fetcher: async () => (unwrap(await supabase.rpc("get_pending_credentials")) ?? []) as PendingRow[],
  });

  const decide = async (
    userId: string,
    credential: "license" | "insurance",
    decision: "verified" | "rejected",
    reason?: string
  ) => {
    const key = `${userId}:${credential}`;
    setBusy(key);
    const { error } = await supabase.rpc("review_credential", {
      _user_id: userId,
      _credential: credential,
      _decision: decision,
      _reason: reason ?? undefined,
      // Only meaningful on approval; the RPC nulls it out on a rejection.
      _expires: decision === "verified" ? expiry[key] : undefined,
    });
    setBusy(null);
    if (error) {
      report(error, { tags: { source: "AdminCredentialQueue.decide", decision, credential } });
      toast.error(userFacingError(error, "Couldn't update that credential — try again"));
      return;
    }
    qc.invalidateQueries({ queryKey });
  };

  /**
   * Approve every ticked credential.
   *
   * Approve only — bulk REJECT is deliberately absent. A rejection carries a
   * reason that the Helpr reads and acts on, and one reason pasted across a
   * batch is either wrong for most of them or so generic it tells them
   * nothing. Rejecting stays per-credential, where the reason box is.
   *
   * Sequential rather than Promise.all: review_credential writes a profile row
   * and fans out a notification, and firing twenty at once is how you find the
   * rate limit during an incident. A queue this size is not worth the risk of
   * parallelism.
   *
   * Each credential carries its OWN expiry, taken from its own document. There
   * is deliberately no "apply this date to everything selected" control: two
   * COIs in the same batch renew on different days, and one date pasted across
   * a batch is the same mistake as one rejection reason pasted across a batch.
   * A row can only be ticked once its date is set, so this loop always has one.
   */
  const approveSelected = async () => {
    if (selected.size === 0) return;
    setBulkRunning(true);
    const keys = [...selected];
    let ok = 0;
    const failures: string[] = [];
    for (const key of keys) {
      const [userId, credential] = key.split(":") as [string, "license" | "insurance"];
      const { error } = await supabase.rpc("review_credential", {
        _user_id: userId,
        _credential: credential,
        _decision: "verified",
        _expires: expiry[key],
      });
      if (error) {
        report(error, { tags: { source: "AdminCredentialQueue.approveSelected", credential } });
        failures.push(credential);
      } else ok++;
    }
    setBulkRunning(false);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey });
    // Report the partial outcome honestly. A blanket "Approved" after two of
    // five succeeded is how a queue silently keeps stale rows.
    if (failures.length === 0) toast.success(`Approved ${ok} credential${ok === 1 ? "" : "s"}.`);
    else if (ok === 0) toast.error(`None approved — ${failures.length} failed.`);
    else toast.warning(`Approved ${ok}, but ${failures.length} failed. The queue still shows them.`);
  };

  return (
    <AdminViewShell>
      {/* `space-y-4` was one of the six off-shell spacings this view set; the
          lead sentence describing the queue becomes its card subtitle. */}
      <AdminCard
        title="Pending Credentials"
        subtitle="Approving turns the credential badge live on the user's profile."
      >
      {isInitialLoading ? (
        // Shape-matched skeletons keep the surface from collapsing under a
        // bare spinner while the RPC resolves.
        <div className="space-y-3" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-ds-md border border-border/60 bg-background/40 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
              <Skeleton className="h-24 w-full rounded-ds-md" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          title="We couldn't load the credential queue."
          body="Tap Try again. Submissions are safe — they're queued server-side."
          onRetry={() => refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          icon={ShieldCheck}
          title="No pending credentials"
          body="Uploads land here as Helprs submit them."
        />
      ) : (
        <div className="space-y-3">
          {/* Bulk bar appears only once something is ticked, so the default
              view of the queue is unchanged for the common single-decision
              case. */}
          {selected.size > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-ds-md border border-primary/30 bg-primary/5 p-3">
              <p className="text-ds-13 font-semibold text-foreground">
                {selected.size} selected
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" disabled={bulkRunning} onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <Button size="sm" disabled={bulkRunning} onClick={approveSelected}>
                  <CheckCircle2 className="w-4 h-4 mr-1" />
                  {bulkRunning ? "Approving…" : `Approve ${selected.size}`}
                </Button>
              </div>
            </div>
          )}
          {rows.map((r) => (
            <div key={r.user_id} className="rounded-ds-md border border-border/60 bg-background/40 p-4 space-y-3">
              <div className="flex items-center gap-3">
                {/* Migrated onto the shared `<UserAvatar>` (2026-08-31). The
                    row's own initials were `(full_name || email || "?")
                    .slice(0, 2)` — the first two CHARACTERS, so "Jo" for
                    "John Smith" and "he" for "helpr-audit@…" — and they only
                    rendered when `avatar_url` was null. Every blank-but-200
                    avatar therefore painted a flat `bg-primary/10` circle with
                    nothing in it, which on a queue of pending credentials is
                    several visually identical rows the admin is approving one
                    by one. `initials` is still passed so an email-only row
                    keeps a stable two-character monogram; `<UserAvatar>`
                    falls through to real name initials when it is blank. See
                    `src/lib/avatarImage.ts`. */}
                <UserAvatar
                  userId={r.user_id}
                  src={r.avatar_url}
                  name={r.full_name || r.email}
                  initials={(r.full_name || r.email || "").slice(0, 2).toUpperCase()}
                  pixelSize={40}
                  aria-hidden
                  className="w-10 h-10"
                  fallbackClassName="text-ds-13 ring-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-ds-13 text-foreground truncate">{r.full_name || "Unnamed"}</p>
                  <p className="text-ds-11 text-muted-foreground truncate">{r.email}</p>
                </div>
                {/* The claimed business name is part of what's being reviewed:
                    approving publishes it next to the badge, so it has to
                    match the name printed on the document below. Editing it
                    later re-opens this row (trg_auto_pending_credentials). */}
                {r.business_name && (
                  <p
                    className="text-ds-11 font-semibold shrink-0 max-w-[10rem] truncate"
                    style={{ color: "hsl(var(--burnt-sienna))" }}
                    title={`Claimed business name: ${r.business_name}`}
                  >
                    {r.business_name}
                  </p>
                )}
                <p className="text-ds-11 text-muted-foreground shrink-0">
                  {formatShortDate(r.submitted_at)}
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                {/* License */}
                {r.license_status === "pending" && r.license_url && (
                  <div className="rounded-ds-md border border-border bg-secondary/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[hsl(var(--bark))] disabled:opacity-40"
                          checked={selected.has(`${r.user_id}:license`)}
                          disabled={!hasExpiry(`${r.user_id}:license`)}
                          onChange={() => toggleSelected(`${r.user_id}:license`)}
                          aria-label={`Select license for ${r.full_name || r.email}`}
                        />
                        <span className="text-ds-11 font-semibold uppercase tracking-wider text-muted-foreground">License</span>
                      </label>
                      <SignedOpenLink path={r.license_url} />
                    </div>
                    <DocPreview path={r.license_url} />
                    <ExpiryField
                      id={`${r.user_id}:license`}
                      label="License expires"
                      min={today}
                      value={expiry[`${r.user_id}:license`] ?? ""}
                      onChange={(v) => setExpiryFor(`${r.user_id}:license`, v)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={busy === `${r.user_id}:license` || !hasExpiry(`${r.user_id}:license`)}
                        onClick={() => decide(r.user_id, "license", "verified")}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                        disabled={busy === `${r.user_id}:license`}
                        onClick={() => {
                          setRejectTarget({ userId: r.user_id, credential: "license" });
                          setRejectReason("");
                        }}
                      >
                        <XCircle className="w-4 h-4 mr-1" /> Reject
                      </Button>
                    </div>
                  </div>
                )}

                {/* Insurance */}
                {r.insurance_status === "pending" && r.insurance_url && (
                  <div className="rounded-ds-md border border-border bg-secondary/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[hsl(var(--bark))] disabled:opacity-40"
                          checked={selected.has(`${r.user_id}:insurance`)}
                          disabled={!hasExpiry(`${r.user_id}:insurance`)}
                          onChange={() => toggleSelected(`${r.user_id}:insurance`)}
                          aria-label={`Select insurance for ${r.full_name || r.email}`}
                        />
                        <span className="text-ds-11 font-semibold uppercase tracking-wider text-muted-foreground">Insurance</span>
                      </label>
                      <SignedOpenLink path={r.insurance_url} />
                    </div>
                    <DocPreview path={r.insurance_url} />
                    <ExpiryField
                      id={`${r.user_id}:insurance`}
                      label="Policy expires"
                      min={today}
                      value={expiry[`${r.user_id}:insurance`] ?? ""}
                      onChange={(v) => setExpiryFor(`${r.user_id}:insurance`, v)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={busy === `${r.user_id}:insurance` || !hasExpiry(`${r.user_id}:insurance`)}
                        onClick={() => decide(r.user_id, "insurance", "verified")}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                        disabled={busy === `${r.user_id}:insurance`}
                        onClick={() => {
                          setRejectTarget({ userId: r.user_id, credential: "insurance" });
                          setRejectReason("");
                        }}
                      >
                        <XCircle className="w-4 h-4 mr-1" /> Reject
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </AdminCard>

      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent role="alertdialog">
          <DialogHero
            title="Reject Credential"
          />
          <Textarea
            aria-label="Credential rejection reason"
            placeholder="e.g. Document is blurry, please re-upload a clearer photo"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          {rejectReason.trim().length > 0 && rejectReason.trim().length < 10 && (
            <p className="text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
              Please provide at least 10 characters so the user knows what to fix.
            </p>
          )}
          <DialogFooter>
            <DialogSecondaryAction>Cancel</DialogSecondaryAction>
            <DialogPrimaryAction
              disabled={rejectReason.trim().length < 10}
              onClick={() => {
                if (rejectTarget) {
                  decide(rejectTarget.userId, rejectTarget.credential, "rejected", rejectReason.trim());
                  setRejectTarget(null);
                }
              }}
            >
              Reject
            </DialogPrimaryAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminViewShell>
  );
};

/**
 * The expiry the admin reads off the document. Approving is blocked until this
 * is set to a future date — see the `expiry` state comment above for why there
 * is no default and no bulk "apply to all".
 *
 * `min` stops the past being pickable in the native picker; the RPC re-checks
 * it server-side (`_expires <= current_date` raises), because a date input is
 * a convenience, not a constraint.
 */
function ExpiryField({
  id,
  label,
  min,
  value,
  onChange,
}: {
  id: string;
  label: string;
  min: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const inputId = `expiry-${id}`;
  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-ds-11 font-semibold text-muted-foreground">
        {label}
      </label>
      <input
        id={inputId}
        type="date"
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-ds-sm border border-border bg-background/60 px-2 py-1.5 text-ds-11 text-foreground"
      />
      {!value && (
        <p className="text-ds-11 text-muted-foreground">
          Required to approve — copy it from the document above.
        </p>
      )}
      {value !== "" && value <= min && (
        <p className="text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
          That date has already passed — this credential can't be approved.
        </p>
      )}
    </div>
  );
}

// Resolve a 5-minute signed URL on demand and open in a new tab.
// user-documents bucket is private as of 2026-05-05 — admins authorize
// via has_role('admin') in the bucket SELECT policy.
function SignedOpenLink({ path }: { path: string }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    const { data, error } = await supabase.storage
      .from("user-documents")
      .createSignedUrl(path, 300);
    setBusy(false);
    if (error || !data) {
      toast.error("Couldn't generate a view link.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };
  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="inline-flex items-center gap-1 text-ds-11 text-primary hover:underline disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <>Open <ExternalLink className="w-3 h-3" /></>}
    </button>
  );
}

// Inline preview — fetches a 5-minute signed URL when the row mounts so
// the admin sees the document immediately. Path is the storage path
// within user-documents (private bucket).
function DocPreview({ path }: { path: string }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setSignedUrl(null);
    supabase.storage
      .from("user-documents")
      .createSignedUrl(path, 300)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) setError(true);
        else setSignedUrl(data.signedUrl);
      });
    return () => { cancelled = true; };
  }, [path]);

  const isPdf = /\.pdf(\?|$)/i.test(path);

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-ds-sm bg-destructive/10 p-3 text-ds-11 text-[hsl(var(--destructive-ink))]">
        <FileText className="w-4 h-4" /> Couldn't load preview — open via the link above.
      </div>
    );
  }

  if (isPdf) {
    return (
      <div className="flex items-center gap-2 rounded-ds-sm bg-background/60 p-3 text-ds-11 text-muted-foreground">
        <FileText className="w-4 h-4" /> PDF document — open to review
      </div>
    );
  }

  if (!signedUrl) {
    return (
      <div className="flex items-center justify-center rounded-ds-sm bg-background/60 p-6 text-ds-11 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  return (
    <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="block">
      <img loading="lazy" decoding="async"
        src={signedUrl}
        alt="Credential document"
        className="w-full max-h-48 object-contain rounded-ds-sm bg-background/60"
      />
    </a>
  );
}

export default AdminCredentialQueue;
