import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ShieldCheck, Upload, FileText, X, BadgeCheck, Clock, AlertTriangle, Loader2 } from "lucide-react";
import CredentialBadge from "@/components/CredentialBadge";

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

export function CredentialsTab({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"license" | "insurance" | null>(null);
  const [data, setData] = useState<CredentialFields | null>(null);

  // Local toggle state (keeps UX snappy before save)
  const [licensedOn, setLicensedOn] = useState(false);
  const [insuredOn, setInsuredOn] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: row, error } = await supabase
        .from("profiles")
        .select(
          "is_licensed,is_insured,license_url,insurance_url,license_status,insurance_status,license_rejection_reason,insurance_rejection_reason"
        )
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        toast.error("Couldn't load credentials");
      } else if (row) {
        setData(row as CredentialFields);
        setLicensedOn(!!row.is_licensed);
        setInsuredOn(!!row.is_insured);
      }
      setLoading(false);
    })();
  }, [userId]);

  const validate = (file: File, label: string): boolean => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error(`${label}: must be JPG, PNG, WEBP, or PDF`);
      return false;
    }
    if (file.size > MAX_SIZE) {
      toast.error(`${label}: must be under 5MB`);
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
      const { data: pub } = supabase.storage.from("user-documents").getPublicUrl(path);
      const url = pub.publicUrl;

      const update: Record<string, any> = {};
      if (kind === "license") {
        update.license_url = url;
        update.is_licensed = true;
        update.license_status = "pending";
      } else {
        update.insurance_url = url;
        update.is_insured = true;
        update.insurance_status = "pending";
      }
      const { error: updErr } = await supabase.from("profiles").update(update).eq("user_id", userId);
      if (updErr) throw updErr;

      // Reload
      const { data: row } = await supabase
        .from("profiles")
        .select(
          "is_licensed,is_insured,license_url,insurance_url,license_status,insurance_status,license_rejection_reason,insurance_rejection_reason"
        )
        .eq("user_id", userId)
        .maybeSingle();
      if (row) {
        setData(row as CredentialFields);
        setLicensedOn(!!row.is_licensed);
        setInsuredOn(!!row.is_insured);
      }
      toast.success(`${kind === "license" ? "License" : "Insurance"} uploaded — pending admin review`);
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const removeDoc = async (kind: "license" | "insurance") => {
    setSaving(true);
    const update: Record<string, any> = {};
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
      toast.error(error.message);
      return;
    }
    setData((prev) =>
      prev
        ? {
            ...prev,
            ...(kind === "license"
              ? { license_url: null, is_licensed: false, license_status: "none" }
              : { insurance_url: null, is_insured: false, insurance_status: "none" }),
          }
        : prev
    );
    if (kind === "license") setLicensedOn(false);
    else setInsuredOn(false);
    toast.success("Removed");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) return null;

  const renderStatus = (status: string, reason: string | null) => {
    if (status === "verified")
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
          <BadgeCheck className="w-3.5 h-3.5" /> Verified
        </span>
      );
    if (status === "pending")
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          <Clock className="w-3.5 h-3.5" /> Pending review
        </span>
      );
    if (status === "rejected")
      return (
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
            <AlertTriangle className="w-3.5 h-3.5" /> Rejected
          </span>
          {reason && <p className="text-[11px] text-destructive/80">{reason}</p>}
        </div>
      );
    return null;
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5 space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-display font-bold text-foreground">Professional credentials</h2>
            <p className="text-xs text-muted-foreground">
              Add proof of your license and insurance to earn the verified Seal of Trust on your profile.
            </p>
          </div>
        </div>
        <div className="pt-2">
          <CredentialBadge credentials={data} size="md" />
        </div>
      </div>

      {/* Licensed */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <Label htmlFor="lic-toggle" className="text-base font-semibold">
              I am Licensed
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload your professional license. Document required when toggled on.
            </p>
          </div>
          <Switch
            id="lic-toggle"
            checked={licensedOn}
            onCheckedChange={async (v) => {
              setLicensedOn(v);
              if (!v && data.license_url) await removeDoc("license");
            }}
          />
        </div>

        {licensedOn && (
          <div className="space-y-3">
            {data.license_url ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3">
                <FileText className="w-5 h-5 text-primary shrink-0" />
                <a
                  href={data.license_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-sm text-primary underline truncate"
                >
                  View uploaded license
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeDoc("license")}
                  disabled={saving}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-secondary/30 px-4 py-6 cursor-pointer hover:border-primary/40 hover:bg-secondary/50 transition-colors">
                <Upload className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm font-medium">
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

      {/* Insured */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <Label htmlFor="ins-toggle" className="text-base font-semibold">
              I am Insured
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload your Certificate of Insurance (COI). Document required when toggled on.
            </p>
          </div>
          <Switch
            id="ins-toggle"
            checked={insuredOn}
            onCheckedChange={async (v) => {
              setInsuredOn(v);
              if (!v && data.insurance_url) await removeDoc("insurance");
            }}
          />
        </div>

        {insuredOn && (
          <div className="space-y-3">
            {data.insurance_url ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3">
                <FileText className="w-5 h-5 text-primary shrink-0" />
                <a
                  href={data.insurance_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-sm text-primary underline truncate"
                >
                  View uploaded insurance certificate
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeDoc("insurance")}
                  disabled={saving}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-secondary/30 px-4 py-6 cursor-pointer hover:border-primary/40 hover:bg-secondary/50 transition-colors">
                <Upload className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm font-medium">
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

      <p className="text-[11px] text-muted-foreground text-center">
        Documents are reviewed by Helpr admins before badges go live. We never share your documents publicly.
      </p>
    </div>
  );
}

export default CredentialsTab;
