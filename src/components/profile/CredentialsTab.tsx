import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { ShieldCheck, Upload, FileText, X, AlertTriangle, Lock, RefreshCcw, Send } from "lucide-react";
import CredentialBadge from "@/components/CredentialBadge";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { queryKeys } from "@/lib/queryKeys";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";

interface CredentialFields {
  is_licensed: boolean;
  is_insured: boolean;
  license_url: string | null;
  insurance_url: string | null;
  license_status: string;
  insurance_status: string;
  license_rejection_reason: string | null;
  insurance_rejection_reason: string | null;
}

type Kind = "license" | "insurance";

/**
 * A document the user has PICKED but not SENT. It lives only in this
 * component — nothing touches storage or `profiles` until "Send for review".
 *
 * Why client-only: the schema has no draft state to write to. `license_status`
 * is `CHECK (... IN ('none','pending','verified','rejected'))` and is column-
 * locked from the client by `prevent_self_escalation()`; the moment
 * `license_url` is written, the `trg_auto_pending_credentials` BEFORE UPDATE
 * trigger stamps 'pending' and the row appears in the admin queue
 * (`get_pending_credentials()`). So "attached but not submitted" cannot be
 * represented server-side without a data-model change — and it doesn't need to
 * be: an unsent attachment is exactly as durable as any other unsubmitted form
 * field, and we label it as such.
 */
interface Draft {
  file: File;
  /** Object URL for image thumbnails only. Revoked on discard/unmount. */
  previewUrl: string | null;
}

/**
 * The one vocabulary for credential state on this screen. Each word appears in
 * exactly ONE place — the credential's own card — so the same fact can't be
 * phrased three ways in the same scroll. These are five DISTINCT states, not
 * synonyms:
 *
 *   off       — the user says this credential doesn't apply to them
 *   empty     — applies, but no document picked yet
 *   attached  — a document is picked and sitting on this device, NOT sent
 *   review    — sent; `<kind>_status = 'pending'`; in the admin queue
 *   verified  — admin approved it; the badge is live
 *   rejected  — admin looked and couldn't verify it; a new copy is needed
 */
type CredState = "off" | "empty" | "attached" | "review" | "verified" | "rejected";

const STATE_LABEL: Record<CredState, string> = {
  off: "Optional",
  empty: "Not added yet",
  attached: "Ready to send",
  review: "In review",
  verified: "Verified",
  rejected: "Needs a new copy",
};

const STATE_COLOR: Record<CredState, string> = {
  // Full-strength tokens, no alpha: at 10px an alpha-dimmed sienna measured
  // 4.12:1, under WCAG AA. Full strength is the same hue at ~6.5:1.
  off: "hsl(var(--burnt-sienna))",
  empty: "hsl(var(--burnt-sienna))",
  attached: "hsl(var(--burnt-sienna))",
  review: "hsl(var(--olivewood))",
  verified: "hsl(var(--bark))",
  rejected: "hsl(var(--destructive))",
};

const KIND_NOUN: Record<Kind, string> = {
  license: "license",
  insurance: "insurance certificate",
};

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_SIZE = 5 * 1024 * 1024;
const SELECT_COLS =
  "is_licensed,is_insured,license_url,insurance_url,license_status,insurance_status,license_rejection_reason,insurance_rejection_reason";

const EMPTY: CredentialFields = {
  is_licensed: false,
  is_insured: false,
  license_url: null,
  insurance_url: null,
  license_status: "none",
  insurance_status: "none",
  license_rejection_reason: null,
  insurance_rejection_reason: null,
};

const formatBytes = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;

export function CredentialsTab({ userId, onBack }: { userId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [removing, setRemoving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Documents picked on this device and not yet sent.
  const [drafts, setDrafts] = useState<Partial<Record<Kind, Draft>>>({});
  // Which SENT document the user is asking to pull back (drives the confirm).
  const [pullBack, setPullBack] = useState<Kind | null>(null);

  // React Query cache — renders instantly on revisit, refetches in background.
  const { data: fetched } = useQuery({
    queryKey: queryKeys.credentials.byUser(userId),
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from("profiles")
        .select(SELECT_COLS)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        toast.error("Couldn't load credentials.");
        throw error;
      }
      return (row as CredentialFields) ?? EMPTY;
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  // Render the form immediately with empty defaults; no full-page spinner.
  const data: CredentialFields = fetched ?? EMPTY;
  // `?? false`, not the raw column. Both are nullable, so before the row loads
  // `checked` was `undefined` — which makes Radix's Switch UNCONTROLLED — and
  // then became a boolean once data arrived, flipping it to controlled. React
  // warns on that switch ("Switch is changing from controlled to uncontrolled")
  // and, more practically, an uncontrolled toggle silently keeps its own state,
  // so a fast tap during load could disagree with the server.
  const licensedOn = data.is_licensed ?? false;
  const insuredOn = data.is_insured ?? false;

  const patchCache = (patch: Partial<CredentialFields>) => {
    qc.setQueryData<CredentialFields>(queryKeys.credentials.byUser(userId), (prev) => ({
      ...(prev ?? EMPTY),
      ...patch,
    }));
  };

  const fieldsFor = (kind: Kind) =>
    kind === "license"
      ? { on: licensedOn, url: data.license_url, status: data.license_status, reason: data.license_rejection_reason }
      : { on: insuredOn, url: data.insurance_url, status: data.insurance_status, reason: data.insurance_rejection_reason };

  const stateOf = (kind: Kind): CredState => {
    const { on, url, status } = fieldsFor(kind);
    if (!on) return "off";
    if (drafts[kind]) return "attached";
    if (!url) return "empty";
    if (status === "verified") return "verified";
    if (status === "rejected") return "rejected";
    // A document IS on the row, so "empty" is never true from here down. The
    // old fallthrough returned "empty" for any status the client hadn't seen
    // yet (including the brief 'none' window before `trg_auto_pending_
    // credentials` stamps 'pending'), which printed "Not added yet" directly
    // above the "View the license you sent" link on the very same card.
    return "review";
  };

  // ── Attach (local only) ────────────────────────────────────────────────
  const validate = (file: File, label: string): boolean => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error(`${label}: must be JPG, PNG, WEBP, or PDF.`);
      return false;
    }
    if (file.size > MAX_SIZE) {
      toast.error(`${label}: must be under 5 MB.`);
      return false;
    }
    return true;
  };

  const attachDoc = (file: File, kind: Kind) => {
    if (!validate(file, kind === "license" ? "License" : "Insurance")) return;
    setDrafts((prev) => {
      const existing = prev[kind];
      if (existing?.previewUrl) URL.revokeObjectURL(existing.previewUrl);
      return {
        ...prev,
        [kind]: {
          file,
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        },
      };
    });
  };

  const discardDraft = (kind: Kind) => {
    setDrafts((prev) => {
      const existing = prev[kind];
      if (existing?.previewUrl) URL.revokeObjectURL(existing.previewUrl);
      const next = { ...prev };
      delete next[kind];
      return next;
    });
  };

  // Object URLs outlive the component unless revoked, so a user who attaches a
  // few photos and leaves would leak them for the life of the tab.
  const draftsRef = useRef(drafts);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);
  useEffect(
    () => () => {
      Object.values(draftsRef.current).forEach((d) => {
        if (d?.previewUrl) URL.revokeObjectURL(d.previewUrl);
      });
    },
    [],
  );

  const draftKinds = useMemo(
    () => (["license", "insurance"] as Kind[]).filter((k) => !!drafts[k]),
    [drafts],
  );

  // ── Send for review (the only thing that touches the server) ───────────
  const submitForReview = async () => {
    if (draftKinds.length === 0 || submitting) return;
    setSubmitting(true);
    const uploaded: { kind: Kind; path: string }[] = [];
    let linked = false;
    try {
      for (const kind of draftKinds) {
        const draft = drafts[kind]!;
        const ext = draft.file.name.split(".").pop() || "pdf";
        const path = `${userId}/credentials/${kind}-${Date.now()}.${ext}`;
        // Store the storage PATH (not a signed URL) — user-documents is a
        // private bucket as of 2026-05-05; signed URLs are minted on demand
        // at view time via openDoc() below.
        const { error: upErr } = await supabase.storage
          .from("user-documents")
          .upload(path, draft.file, { upsert: true, contentType: draft.file.type });
        if (upErr) throw upErr;
        uploaded.push({ kind, path });
      }

      // ONE update carrying every attached document, so a helper who has both
      // lands in the admin queue as a single submission rather than two
      // staggered reviews.
      const update: Partial<CredentialFields> = {};
      uploaded.forEach(({ kind, path }) => {
        if (kind === "license") {
          update.license_url = path;
          update.is_licensed = true;
        } else {
          update.insurance_url = path;
          update.is_insured = true;
        }
      });
      const { error: updErr } = await supabase.from("profiles").update(update).eq("user_id", userId);
      if (updErr) throw updErr;
      linked = true;

      // The status columns are admin/backend-only — `prevent_self_escalation()`
      // pins them to their OLD values on any client write, and the DB's
      // `trg_auto_pending_credentials` trigger is what actually stamps
      // 'pending' once the url changes. Mirror the trigger locally so the card
      // doesn't flash a stale state, then refetch the real row and let the
      // server win.
      patchCache({
        ...update,
        ...(update.license_url ? { license_status: "pending", license_rejection_reason: null } : {}),
        ...(update.insurance_url ? { insurance_status: "pending", insurance_rejection_reason: null } : {}),
      });
      draftKinds.forEach(discardDraft);
      void qc.invalidateQueries({ queryKey: queryKeys.credentials.byUser(userId) });
      hapticSuccess();
      toast.success(
        draftKinds.length > 1 ? "Both documents sent for review." : "Sent for review.",
      );
    } catch (err) {
      hapticError();
      toast.error(err instanceof Error ? err.message : "Couldn't send your documents — try again?");
      // Objects we uploaded but couldn't attach to the profile are
      // unreferenced. Clear them so a failed send doesn't litter the private
      // bucket; the drafts stay put so the retry works.
      if (!linked && uploaded.length > 0) {
        await supabase.storage.from("user-documents").remove(uploaded.map((u) => u.path));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Generate a 5-minute signed URL on demand so the user can view a document
  // they already sent. Bucket is private; clients can't construct the URL
  // themselves. RLS lets owners read their own paths.
  const openDoc = async (path: string) => {
    const { data: signed, error } = await supabase.storage
      .from("user-documents")
      .createSignedUrl(path, 300);
    if (error || !signed) {
      toast.error("Couldn't generate a view link.");
      return;
    }
    window.open(signed.signedUrl, "_blank", "noopener");
  };

  /**
   * Pull a SENT document back. This is real, not cosmetic: clearing
   * `<kind>_url` fires `trg_auto_pending_credentials`, which resets the status
   * to 'none' and `is_<kind>` to false, so the row drops out of
   * `get_pending_credentials()` and any live badge disappears. That is exactly
   * why it now goes through a confirm — the old bare × gave no clue whether it
   * retracted anything.
   */
  const removeSentDoc = async (kind: Kind) => {
    setRemoving(true);
    const update: Partial<CredentialFields> =
      kind === "license"
        ? { license_url: null, is_licensed: false, license_status: "none", license_rejection_reason: null }
        : { insurance_url: null, is_insured: false, insurance_status: "none", insurance_rejection_reason: null };
    const { error } = await supabase.from("profiles").update(update).eq("user_id", userId);
    setRemoving(false);
    if (error) {
      hapticError();
      toast.error("We couldn't update your credentials — please try again.");
      return;
    }
    patchCache(update);
    void qc.invalidateQueries({ queryKey: queryKeys.credentials.byUser(userId) });
    toast.success(
      stateOf(kind) === "review" ? "Taken out of the review queue." : "Document removed.",
    );
  };

  // Re-verify reminder — surfaces when a credential came back rejected.
  // The schema doesn't track an explicit `expires_at` on credentials yet —
  // when that lands, this same banner becomes the place to surface the
  // 30-day-out reminder without changing the outer card structure.
  const licRejected = data.license_status === "rejected";
  const insRejected = data.insurance_status === "rejected";
  const showReverifyBanner = licRejected || insRejected;
  const reverifyKind = licRejected && insRejected ? "both" : licRejected ? "license" : "insurance";

  // Confirm copy is state-specific: withdrawing something nobody has looked at
  // yet is not the same act as pulling a live badge off your profile.
  const pullBackState = pullBack ? stateOf(pullBack) : null;
  const pullBackNoun = pullBack ? KIND_NOUN[pullBack] : "";

  const licVerified = data.is_licensed && data.license_status === "verified";
  const insVerified = data.is_insured && data.insurance_status === "verified";
  const anyVerified = licVerified || insVerified;

  const renderCredentialCard = (kind: Kind) => {
    const { url, reason } = fieldsFor(kind);
    const state = stateOf(kind);
    const draft = drafts[kind];
    const on = kind === "license" ? licensedOn : insuredOn;
    const noun = KIND_NOUN[kind];
    const toggleId = kind === "license" ? "lic-toggle" : "ins-toggle";

    return (
      <div className="rounded-2xl liquid-glass p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* The card's ONE status line. Overall trust status lives on the
                summary card above; this says only what has happened to THIS
                document. */}
            <p
              className="font-serif italic uppercase text-ds-10"
              style={{ color: STATE_COLOR[state], letterSpacing: "0.18em" }}
            >
              {STATE_LABEL[state]}
            </p>
            <Label
              htmlFor={toggleId}
              className="font-display italic font-bold leading-tight cursor-pointer text-headline-card"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              {kind === "license" ? "I am licensed" : "I am insured"}
            </Label>
            <p className="font-serif italic mt-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {!on
                ? kind === "license"
                  ? "Toggle on if you hold a professional license — attach it to verify."
                  : "Toggle on if you carry professional insurance — attach it to verify."
                : kind === "license"
                  ? "Attach your professional license, then send it for review to earn the badge."
                  : "Attach your Certificate of Insurance (COI), then send it for review to earn the badge."}
            </p>
          </div>
          <Switch
            id={toggleId}
            checked={on}
            onCheckedChange={(v) => {
              if (v) {
                patchCache(kind === "license" ? { is_licensed: true } : { is_insured: true });
                return;
              }
              if (drafts[kind]) discardDraft(kind);
              if (url) {
                // Something is already with the reviewers — confirm before
                // pulling it back. The toggle stays on until they say yes.
                setPullBack(kind);
                return;
              }
              patchCache(kind === "license" ? { is_licensed: false } : { is_insured: false });
            }}
          />
        </div>

        {on && (
          <div className="space-y-3">
            {draft ? (
              // ── Attached, NOT sent ──────────────────────────────────────
              <div
                className="flex items-center gap-3 rounded-ds-md p-3"
                style={{
                  background: "hsla(0, 0%, 100%, 0.55)",
                  border: "0.5px dashed hsl(var(--burnt-sienna) / 0.45)",
                }}
              >
                {draft.previewUrl ? (
                  <img
                    src={draft.previewUrl}
                    alt={`Preview of the ${noun} you attached`}
                    className="w-10 h-10 rounded-ds-sm object-cover shrink-0"
                    style={{ border: "0.5px solid hsl(var(--olivewood) / 0.16)" }}
                  />
                ) : (
                  <FileText className="w-5 h-5 text-primary shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-ds-13 font-medium text-foreground truncate">{draft.file.name}</p>
                  <p className="text-ds-11 font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                    {formatBytes(draft.file.size)} · on this device only — not sent yet
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => discardDraft(kind)}
                  aria-label={`Remove the ${noun} you attached — it hasn't been sent`}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : url ? (
              // ── Sent ────────────────────────────────────────────────────
              <div className="flex items-center gap-3 rounded-ds-md bg-card p-3">
                <FileText className="w-5 h-5 text-primary shrink-0" />
                <button
                  type="button"
                  onClick={() => openDoc(url)}
                  className="flex-1 text-left text-ds-13 text-primary underline truncate"
                >
                  View the {noun} You Sent
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setPullBack(kind)}
                  disabled={removing}
                  aria-label={
                    state === "review"
                      ? `Take your ${noun} out of the review queue`
                      : state === "verified"
                        ? `Remove your verified ${noun} and its badge`
                        : `Remove the ${noun} we couldn't verify`
                  }
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : null}

            {/* Attach / replace. A rejected document keeps its row above (so
                the user can see what we looked at) AND gets a fresh picker,
                rather than forcing a delete-then-upload dance. */}
            {!draft && (!url || state === "rejected") && (
              <label className="glass-field flex items-center justify-center gap-2 rounded-ds-md border-2 border-dashed border-[hsl(var(--border)/0.6)] px-4 py-6 cursor-pointer hover:border-primary/40 transition-colors">
                <Upload className="w-5 h-5 text-muted-foreground" />
                <span className="text-ds-13 font-medium">
                  {state === "rejected"
                    ? `Attach a new ${noun} (image or PDF)`
                    : `Attach ${kind === "license" ? "license" : "insurance"} (image or PDF)`}
                </span>
                <Input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) attachDoc(f, kind);
                    e.target.value = "";
                  }}
                />
              </label>
            )}

            {/* Only the REASON, never a second copy of the status word — the
                eyebrow above already named the state. */}
            {state === "rejected" && reason && (
              <p className="inline-flex items-start gap-1.5 text-ds-11 text-destructive/90">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{reason}</span>
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header lives HERE, like every other Profile tab. It used to be
          rendered by ProfileTabPanels on this tab's behalf — same pixels, but a
          second ownership model for the same element, which is why the tabs
          read as differently built. */}
      <ProfileTabHeader title="Licensed &amp; Insured" onBack={onBack} />

      <BrandConfirmDialog
        open={pullBack !== null}
        onOpenChange={(open) => { if (!open) setPullBack(null); }}
        title={
          pullBackState === "verified"
            ? `Remove your verified ${pullBackNoun}?`
            : pullBackState === "review"
              ? "Take This Out of Review?"
              : "Remove This Document?"
        }
        description={
          pullBackState === "verified"
            ? `Your badge comes off your profile straight away. A new ${pullBackNoun} would have to be reviewed again before it comes back.`
            : pullBackState === "review"
              ? `We'll pull your ${pullBackNoun} out of the review queue. Nothing has been verified yet, so nothing you've earned is lost — you can attach a new copy any time.`
              : `We'll clear the ${pullBackNoun} we couldn't verify so you can attach a new one.`
        }
        primaryLabel={pullBackState === "review" ? "Take It Back" : "Remove"}
        primaryTone={pullBackState === "verified" ? "sienna" : "bark"}
        primaryHaptic={pullBackState === "verified" ? "warning" : "medium"}
        primaryDisabled={removing}
        onPrimary={() => {
          const kind = pullBack;
          setPullBack(null);
          if (kind) void removeSentDoc(kind);
        }}
        secondaryLabel="Keep It"
      />

      {showReverifyBanner && (
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{
            background: "hsl(var(--destructive) / 0.06)",
            border: "0.5px solid hsl(var(--destructive) / 0.32)",
          }}
        >
          <span
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
            style={{
              background: "hsl(var(--destructive) / 0.12)",
              color: "hsl(var(--destructive))",
            }}
          >
            <RefreshCcw className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <p
              className="font-serif italic uppercase text-ds-10"
              style={{ color: "hsl(var(--destructive))", letterSpacing: "0.18em" }}
            >
              Needs a new copy
            </p>
            <h3
              className="font-display italic font-bold leading-tight text-ds-16"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              We couldn't verify your {reverifyKind === "both" ? "license or insurance" : reverifyKind}.
            </h3>
            <p
              className="font-serif italic mt-1 leading-snug text-ds-12"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Attach a clearer copy and send it — we review within one business day. Until then, your verified badge isn't visible to posters.
            </p>
          </div>
        </div>
      )}

      {/* Summary card — the ONE home for overall status. The per-document
          cards below say what's happened to each file; this says what posters
          currently see. It used to repeat the same "pending" fact as an
          eyebrow AND a chip, in two different phrasings. */}
      <div className="rounded-2xl liquid-glass p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-ds-md flex items-center justify-center shrink-0"
            style={{
              background: anyVerified ? "hsl(var(--bark) / 0.12)" : "hsl(var(--burnt-sienna) / 0.10)",
              color: anyVerified ? "hsl(var(--bark))" : "hsl(var(--burnt-sienna))",
            }}
          >
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="font-serif italic uppercase text-ds-10"
              style={{
                // Full opacity, not /0.78. At 10px the 22% alpha lifted
                // burnt-sienna to #b26b49 = 4.12:1, under WCAG AA's 4.5.
                // Full strength is the same hue and measures ~6.5:1.
                color: anyVerified ? "hsl(var(--bark))" : "hsl(var(--burnt-sienna))",
                letterSpacing: "0.18em",
              }}
            >
              {licVerified && insVerified
                ? "Licensed & Insured"
                : licVerified
                  ? "Licensed"
                  : insVerified
                    ? "Insured"
                    : "Not yet verified"}
            </p>
            <h2 className="font-display italic font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
              Professional credentials
            </h2>
            <p className="font-serif italic mt-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Proof of license and insurance earns verified badges on your profile.
            </p>
          </div>
        </div>
        {anyVerified && (
          <div className="pt-1">
            {/* Only the LIVE badge. Feeding the raw row in would make the badge
                append "· Insurance pending", restating a state the card below
                already owns. */}
            <CredentialBadge
              credentials={{
                is_licensed: licVerified,
                license_status: licVerified ? "verified" : "none",
                is_insured: insVerified,
                insurance_status: insVerified ? "verified" : "none",
              }}
              size="md"
            />
          </div>
        )}
      </div>

      {renderCredentialCard("license")}
      {renderCredentialCard("insurance")}

      {/* Review-then-send. Attaching a file used to write `<kind>_url`
          immediately, which trips the DB trigger and drops the helper into the
          admin queue on the spot — so someone with both documents couldn't send
          them as one package, and had no chance to check what they'd picked.
          Nothing leaves the device until this button. */}
      {draftKinds.length > 0 && (
        <div
          className="rounded-2xl p-5 space-y-3"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.06)",
            border: "0.5px solid hsl(var(--burnt-sienna) / 0.32)",
          }}
        >
          <div className="flex items-start gap-3">
            <span
              className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.12)",
                color: "hsl(var(--burnt-sienna))",
              }}
            >
              <Send className="w-4 h-4" />
            </span>
            <div className="flex-1 min-w-0">
              <p
                className="font-serif italic uppercase text-ds-10"
                style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
              >
                Ready to send
              </p>
              <h3
                className="font-display italic font-bold leading-tight text-ds-16"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                {draftKinds.length > 1
                  ? "Your license and insurance are attached."
                  : `Your ${KIND_NOUN[draftKinds[0]]} is attached.`}
              </h3>
              <p
                className="font-serif italic mt-1 leading-snug text-ds-12"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Check {draftKinds.length > 1 ? "both" : "it"} above, then send when you're ready. Nothing goes to our reviewers until you do.
              </p>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            disabled={submitting}
            onClick={submitForReview}
          >
            {submitting
              ? "Sending…"
              : draftKinds.length > 1
                ? "Send Both for Review"
                : `Send ${KIND_NOUN[draftKinds[0]]} for review`}
          </Button>
        </div>
      )}

      <div
        className="rounded-ds-md flex items-start gap-2.5 px-3 py-2.5"
        style={{ background: "hsl(var(--ivory-sand) / 0.4)" }}
      >
        <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
        <p className="font-serif italic leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Documents are reviewed by Helpr admins before badges go live. We never share them publicly.
        </p>
      </div>
    </div>
  );
}

export default CredentialsTab;
