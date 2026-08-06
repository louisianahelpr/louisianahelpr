import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { ShieldCheck, Upload, FileText, X, BadgeCheck, Clock, AlertTriangle, Lock, RefreshCcw } from "lucide-react";
import CredentialBadge from "@/components/CredentialBadge";
import { queryKeys } from "@/lib/queryKeys";

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

export function CredentialsTab({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"license" | "insurance" | null>(null);

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
        toast.error("Couldn't load credentials");
        throw error;
      }
      return (row as CredentialFields) ?? EMPTY;
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  // Render the form immediately with empty defaults; no full-page spinner.
  const data: CredentialFields = fetched ?? EMPTY;
  const licensedOn = data.is_licensed;
  const insuredOn = data.is_insured;

  const patchCache = (patch: Partial<CredentialFields>) => {
    qc.setQueryData<CredentialFields>(queryKeys.credentials.byUser(userId), (prev) => ({
      ...(prev ?? EMPTY),
      ...patch,
    }));
  };

  const validate = (file: File, label: string): boolean => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error(`${label}: must be JPG, PNG, WEBP, or PDF`);
      return false;
    }
    if (file.size > MAX_SIZE) {
      toast.error(`${label}: must be under 5 MB`);
      return false;
    }
    return true;
  };

  const uploadDoc = async (file: File, kind: "license" | "insurance") => {
    if (!validate(file, kind === "license" ? "License" : "Insurance")) return;
    setUploading(kind);
    try {
      const ext = file.name.split(".").pop() || "pdf";
      const path = `${userId}/credentials/${kind}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("user-documents")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      // Store the storage path (not a signed URL). user-documents is a
      // private bucket as of 2026-05-05 — we generate signed URLs on
      // demand at view time via openDoc() below.
      const update: Partial<CredentialFields> = {};
      if (kind === "license") {
        update.license_url = path;
        update.is_licensed = true;
        update.license_status = "pending";
      } else {
        update.insurance_url = path;
        update.is_insured = true;
        update.insurance_status = "pending";
      }
      const { error: updErr } = await supabase.from("profiles").update(update).eq("user_id", userId);
      if (updErr) throw updErr;

      patchCache(update);
      toast.success(`${kind === "license" ? "License" : "Insurance"} uploaded — pending admin review`);
    } catch (err: any) {
      toast.error(err.message || "Couldn't upload — try again?");
    } finally {
      setUploading(null);
    }
  };

  // Generate a 5-minute signed URL on demand so the user can view their
  // uploaded credential. Bucket is private; clients can't construct the
  // URL themselves. RLS lets owners read their own paths.
  const openDoc = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("user-documents")
      .createSignedUrl(path, 300);
    if (error || !data) {
      toast.error("Couldn't generate a view link");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const removeDoc = async (kind: "license" | "insurance") => {
    setSaving(true);
    const update: Partial<CredentialFields> = {};
    if (kind === "license") {
      update.license_url = null;
      update.is_licensed = false;
      update.license_status = "none";
    } else {
      update.insurance_url = null;
      update.is_insured = false;
      update.insurance_status = "none";
    }
    const { error } = await supabase.from("profiles").update(update).eq("user_id", userId);
    setSaving(false);
    if (error) {
      hapticError();
      toast.error("We couldn't save your credentials — please try again.");
      return;
    }
    patchCache(update);
    toast.success("Removed");
  };

  const renderStatus = (status: string, reason: string | null) => {
    if (status === "verified")
      return (
        <span className="inline-flex items-center gap-1 text-ds-11 font-semibold text-primary">
          <BadgeCheck className="w-3.5 h-3.5" /> Verified
        </span>
      );
    if (status === "pending")
      return (
        <span className="inline-flex items-center gap-1 text-ds-11 font-semibold text-muted-foreground">
          <Clock className="w-3.5 h-3.5" /> Pending review
        </span>
      );
    if (status === "rejected")
      return (
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1 text-ds-11 font-semibold text-destructive">
            <AlertTriangle className="w-3.5 h-3.5" /> Rejected
          </span>
          {reason && <p className="text-ds-11 text-destructive/80">{reason}</p>}
        </div>
      );
    return null;
  };

  // Re-verify reminder — surfaces when any credential is rejected
  // (server-side review found a real issue) or has been stuck pending
  // for more than 7 days (likely a stale upload that admin couldn't
  // verify). The schema doesn't track an explicit `expires_at` on
  // credentials yet — when that lands, this same banner becomes the
  // place to surface the 30-day-out reminder without changing the
  // outer card structure. Self-hides when neither toggle is on or
  // when both credentials are clean.
  const licNeedsReverify = data.license_status === "rejected";
  const insNeedsReverify = data.insurance_status === "rejected";
  const showReverifyBanner = licNeedsReverify || insNeedsReverify;
  const reverifyKind = licNeedsReverify && insNeedsReverify
    ? "both"
    : licNeedsReverify ? "license" : "insurance";

  return (
    <div className="space-y-5">
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
              className="font-serif italic uppercase"
              style={{ fontSize: "0.62rem", color: "hsl(var(--destructive))", letterSpacing: "0.18em" }}
            >
              Re-verify needed
            </p>
            <h3
              className="font-display italic font-bold leading-tight"
              style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              Your {reverifyKind === "both" ? "license and insurance need" : `${reverifyKind} needs`} another look.
            </h3>
            <p
              className="font-serif italic mt-1 leading-snug"
              style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Re-upload a clearer copy and we'll review it within one business day. Until then, your verified badge isn't visible to posters.
            </p>
          </div>
        </div>
      )}
      {(() => {
        // Eyebrow reflects what the user has actually verified so the
        // card reads as proof, not promise. Possibilities:
        //   none verified → "Not yet verified"
        //   license only  → "Licensed"
        //   insurance only → "Insured"
        //   both          → "Licensed & Insured"
        // A credential only counts as live when its toggle is on AND admin
        // verified it — same predicate CredentialBadge enforces. Reading
        // status alone would surface "Verified" for a row whose toggle is
        // off (stale/admin data, or toggle-off without an uploaded doc).
        const licVerified = data.is_licensed && data.license_status === "verified";
        const insVerified = data.is_insured && data.insurance_status === "verified";
        const eyebrow =
          licVerified && insVerified
            ? "Licensed & Insured"
            : licVerified
              ? "Licensed"
              : insVerified
                ? "Insured"
                : "Not yet verified";
        const anyVerified = licVerified || insVerified;
        return (
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
                  className="font-serif italic uppercase"
                  style={{
                    fontSize: "0.62rem",
                    color: anyVerified ? "hsl(var(--bark))" : "hsl(var(--burnt-sienna) / 0.78)",
                    letterSpacing: "0.18em",
                  }}
                >
                  {eyebrow}
                </p>
                <h2 className="font-display italic font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
                  Professional credentials
                </h2>
                <p className="font-serif italic mt-1" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
                  Proof of license and insurance earns verified badges on your profile.
                </p>
              </div>
            </div>
            <div className="pt-1">
              {anyVerified ||
              (data.is_licensed && data.license_status === "pending") ||
              (data.is_insured && data.insurance_status === "pending") ? (
                <CredentialBadge credentials={data} size="md" />
              ) : (
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-sans font-medium"
                  style={{
                    background: "hsl(var(--burnt-sienna) / 0.10)",
                    color: "hsl(var(--burnt-sienna))",
                    fontSize: "0.72rem",
                    border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
                  }}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  No badges yet — upload to earn them
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Licensed — eyebrow reflects current state so the user reads
          their status at a glance even with the toggle collapsed. */}
      <div className="rounded-2xl liquid-glass p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p
              className="font-serif italic uppercase"
              style={{
                fontSize: "0.62rem",
                color:
                  licensedOn && data.license_status === "verified"
                    ? "hsl(var(--bark))"
                    : licensedOn && data.license_status === "rejected"
                      ? "hsl(var(--destructive))"
                      : "hsl(var(--burnt-sienna) / 0.78)",
                letterSpacing: "0.18em",
              }}
            >
              {licensedOn && data.license_status === "verified"
                ? "Verified"
                : licensedOn && data.license_status === "pending"
                  ? "Under review"
                  : licensedOn && data.license_status === "rejected"
                    ? "Action needed"
                    : "Optional"}
            </p>
            <Label htmlFor="lic-toggle" className="font-display italic font-bold leading-tight cursor-pointer text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
              I am licensed
            </Label>
            <p className="font-serif italic mt-1" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
              {licensedOn
                ? "Upload your professional license to earn the verified badge."
                : "Toggle on if you hold a professional license — upload to verify."}
            </p>
          </div>
          <Switch
            id="lic-toggle"
            checked={licensedOn}
            onCheckedChange={async (v) => {
              if (v) {
                patchCache({ is_licensed: true });
              } else if (data.license_url) {
                await removeDoc("license");
              } else {
                patchCache({ is_licensed: false });
              }
            }}
          />
        </div>

        {licensedOn && (
          <div className="space-y-3">
            {data.license_url ? (
              <div className="flex items-center gap-3 rounded-ds-md bg-card p-3">
                <FileText className="w-5 h-5 text-primary shrink-0" />
                <button
                  type="button"
                  onClick={() => openDoc(data.license_url!)}
                  className="flex-1 text-left text-ds-13 text-primary underline truncate"
                >
                  View uploaded license
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeDoc("license")}
                  disabled={saving}
                  aria-label="Remove uploaded license"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <label className="glass-field flex items-center justify-center gap-2 rounded-ds-md border-2 border-dashed border-[hsl(var(--border)/0.6)] px-4 py-6 cursor-pointer hover:border-primary/40 transition-colors">
                <Upload className="w-5 h-5 text-muted-foreground" />
                <span className="text-ds-13 font-medium">
                  {uploading === "license" ? "Uploading..." : "Upload license (image or PDF)"}
                </span>
                <Input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  disabled={uploading === "license"}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadDoc(f, "license");
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            {renderStatus(data.license_status, data.license_rejection_reason)}
          </div>
        )}
      </div>

      {/* Insured — eyebrow reflects current state so the user reads
          their status at a glance even with the toggle collapsed. */}
      <div className="rounded-2xl liquid-glass p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p
              className="font-serif italic uppercase"
              style={{
                fontSize: "0.62rem",
                color:
                  insuredOn && data.insurance_status === "verified"
                    ? "hsl(var(--bark))"
                    : insuredOn && data.insurance_status === "rejected"
                      ? "hsl(var(--destructive))"
                      : "hsl(var(--burnt-sienna) / 0.78)",
                letterSpacing: "0.18em",
              }}
            >
              {insuredOn && data.insurance_status === "verified"
                ? "Verified"
                : insuredOn && data.insurance_status === "pending"
                  ? "Under review"
                  : insuredOn && data.insurance_status === "rejected"
                    ? "Action needed"
                    : "Optional"}
            </p>
            <Label htmlFor="ins-toggle" className="font-display italic font-bold leading-tight cursor-pointer text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
              I am insured
            </Label>
            <p className="font-serif italic mt-1" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
              {insuredOn
                ? "Upload your Certificate of Insurance (COI) to earn the verified badge."
                : "Toggle on if you carry professional insurance — upload to verify."}
            </p>
          </div>
          <Switch
            id="ins-toggle"
            checked={insuredOn}
            onCheckedChange={async (v) => {
              if (v) {
                patchCache({ is_insured: true });
              } else if (data.insurance_url) {
                await removeDoc("insurance");
              } else {
                patchCache({ is_insured: false });
              }
            }}
          />
        </div>

        {insuredOn && (
          <div className="space-y-3">
            {data.insurance_url ? (
              <div className="flex items-center gap-3 rounded-ds-md bg-card p-3">
                <FileText className="w-5 h-5 text-primary shrink-0" />
                <button
                  type="button"
                  onClick={() => openDoc(data.insurance_url!)}
                  className="flex-1 text-left text-ds-13 text-primary underline truncate"
                >
                  View uploaded insurance certificate
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeDoc("insurance")}
                  disabled={saving}
                  aria-label="Remove uploaded insurance certificate"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <label className="glass-field flex items-center justify-center gap-2 rounded-ds-md border-2 border-dashed border-[hsl(var(--border)/0.6)] px-4 py-6 cursor-pointer hover:border-primary/40 transition-colors">
                <Upload className="w-5 h-5 text-muted-foreground" />
                <span className="text-ds-13 font-medium">
                  {uploading === "insurance" ? "Uploading..." : "Upload insurance (image or PDF)"}
                </span>
                <Input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  disabled={uploading === "insurance"}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadDoc(f, "insurance");
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            {renderStatus(data.insurance_status, data.insurance_rejection_reason)}
          </div>
        )}
      </div>

      <div
        className="rounded-ds-md flex items-start gap-2.5 px-3 py-2.5"
        style={{ background: "hsl(var(--ivory-sand) / 0.4)" }}
      >
        <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
        <p className="font-serif italic leading-snug" style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.8)" }}>
          Documents are reviewed by Helpr admins before badges go live. We never share them publicly.
        </p>
      </div>
    </div>
  );
}

export default CredentialsTab;
