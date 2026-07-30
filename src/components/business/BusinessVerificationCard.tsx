import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  BadgeCheck,
  Building2,
  Clock,
  FileText,
  Loader2,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { useInstantQuery } from "@/hooks/useInstantQuery";

type DocType = "license" | "ein_letter" | "insurance";

interface Verification {
  business_id: string;
  business_name: string;
  is_owner: boolean;
  verification_status: "none" | "pending" | "verified" | "rejected";
  verification_document_url: string | null;
  verification_document_type: DocType | null;
  verification_rejection_reason: string | null;
}

const docLabels: Record<DocType, string> = {
  license: "Business / occupational license",
  ein_letter: "IRS EIN assignment letter",
  insurance: "Business insurance certificate",
};

export default function BusinessVerificationCard() {
  const qc = useQueryClient();
  const queryKey = ["my-business-verification"];
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState<DocType>("license");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isInitialLoading } = useInstantQuery<Verification | null>({
    key: queryKey,
    fetcher: async () => {
      const { data: rows, error } = await supabase.rpc("get_my_business_verification");
      if (error) {
        report(error, { tags: { source: "BusinessVerificationCard.fetch" } });
        return null;
      }
      return ((rows && rows[0]) || null) as Verification | null;
    },
  });

  // Sync docType selector with loaded data once.
  useEffect(() => {
    if (data?.verification_document_type) setDocType(data.verification_document_type);
  }, [data?.verification_document_type]);

  const load = () => qc.invalidateQueries({ queryKey });

  const handleUpload = async (file: File) => {
    if (!data?.business_id) return;
    if (!data.is_owner) {
      toast.error("Only the business owner can upload verification documents");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be 10 MB or smaller");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
      const path = `${data.business_id}/${docType}-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("business-documents")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      // Signed URL valid for 1 year — admins read via service role anyway.
      const { data: signed, error: signErr } = await supabase.storage
        .from("business-documents")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signErr) throw signErr;

      const { error: updErr } = await supabase
        .from("businesses")
        .update({
          verification_document_url: signed.signedUrl,
          verification_document_type: docType,
        })
        .eq("id", data.business_id);
      if (updErr) throw updErr;

      toast.success("Document uploaded — pending admin review");
      load();
    } catch (err: any) {
      toast.error(err.message || "Couldn't upload — try again?");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (isInitialLoading) {
    return (
      <Card className="p-5 flex items-center justify-center">
        <HelprSpinner size={20} />
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-ds-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold">Business verification</h2>
          <p className="text-ds-11 text-muted-foreground">
            Upload one document to earn the <strong>Verified Business</strong> badge for your owner
            account and every active team member.
          </p>
        </div>
        <StatusPill status={data.verification_status} />
      </div>

      {data.verification_status === "verified" && (
        <div className="rounded-ds-md border border-primary/30 bg-primary/5 p-3 text-ds-13 flex items-center gap-2">
          <BadgeCheck className="w-4 h-4 text-primary shrink-0" />
          <span>
            Verified! The badge is live on your team profiles and job posts.
          </span>
        </div>
      )}

      {data.verification_status === "rejected" && data.verification_rejection_reason && (
        <div className="rounded-ds-md border border-destructive/30 bg-destructive/5 p-3 text-ds-13 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Document rejected</p>
            <p className="text-ds-11 text-muted-foreground mt-0.5">
              {data.verification_rejection_reason}
            </p>
          </div>
        </div>
      )}

      {!data.is_owner ? (
        <p className="text-ds-11 text-muted-foreground">
          Only the business owner can upload or replace the verification document.
        </p>
      ) : (
        <div className="space-y-3">
          <div>
            <Label className="text-ds-11 font-semibold">Document type</Label>
            <div className="grid sm:grid-cols-3 gap-2 mt-1.5">
              {(Object.keys(docLabels) as DocType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setDocType(type)}
                  className={`text-left rounded-ds-sm border p-2.5 text-ds-11 transition-colors ${
                    docType === type
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <p className="font-medium">{docLabels[type]}</p>
                </button>
              ))}
            </div>
          </div>

          {data.verification_document_url && (
            <div className="rounded-ds-sm border border-border bg-secondary/40 p-3 flex items-center gap-2 text-ds-11">
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground truncate flex-1">
                Current: {data.verification_document_type ? docLabels[data.verification_document_type] : "Document"} on file
              </span>
              <a
                href={data.verification_document_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline shrink-0"
              >
                View
              </a>
            </div>
          )}

          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
              }}
            />
            <Button
              type="button"
              variant="bark"
              className="w-full"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Uploading…
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  {data.verification_document_url ? "Replace document" : "Upload document"}
                </>
              )}
            </Button>
            <p className="text-ds-11 text-muted-foreground mt-1.5">
              Images or PDF, max 10 MB. Re-uploading puts your business back into review.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

function StatusPill({ status }: { status: Verification["verification_status"] }) {
  if (status === "verified") {
    return (
      <span className="inline-flex items-center gap-1 text-ds-11 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold border border-primary/30">
        <BadgeCheck className="w-3 h-3" /> Verified
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-ds-11 px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium border border-border">
        <Clock className="w-3 h-3" /> Pending review
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 text-ds-11 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-semibold border border-destructive/30">
        <ShieldAlert className="w-3 h-3" /> Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-ds-11 px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium border border-border">
      Not submitted
    </span>
  );
}
