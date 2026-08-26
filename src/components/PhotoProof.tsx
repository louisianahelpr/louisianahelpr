import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { Camera, ImagePlus, X, CheckCircle2, Image } from "lucide-react";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { unwrapMutation, isWriteRejected, mutationErrorMessage } from "@/lib/mutationResult";
import { hasRequiredProof, requiredProof } from "@/lib/photoProofPolicy";
import { isNativePlatform } from "@/lib/nativeInit";
import { pickImagesNative } from "@/lib/nativeCamera";

type PhotoProofProps = {
  jobId: string;
  type: "before" | "after";
  existingUrls: string[];
  onUploaded: () => void;
};

export const PhotoProof = ({ jobId, type, existingUrls, onUploaded }: PhotoProofProps) => {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const addFiles = (selected: File[]) => {
    if (selected.length === 0) return;
    if (files.length + selected.length > 5) { toast.error("Max 5 photos."); return; }
    const newFiles = [...files, ...selected].slice(0, 5);
    setFiles(newFiles);
    setPreviews(newFiles.map(f => URL.createObjectURL(f)));
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files || []));
  };

  const handleNativeAdd = async () => {
    try {
      const picked = await pickImagesNative(5 - files.length);
      addFiles(picked);
    } catch (err) {
      report(err, { tags: { source: "PhotoProof.handleNativeAdd" } });
      toast.error("Couldn't open your photos. Please try again.");
    }
  };

  const removeFile = (i: number) => {
    const newFiles = files.filter((_, idx) => idx !== i);
    setFiles(newFiles);
    setPreviews(newFiles.map(f => URL.createObjectURL(f)));
  };

  const upload = async () => {
    if (files.length === 0) { toast.error("Add at least one photo."); return; }
    setUploading(true);
    const urls: string[] = [...existingUrls];
    // Track failures per-file. A `continue` on upload error used to be the
    // ONLY handling: if every file failed, `urls` stayed exactly equal to
    // `existingUrls`, the jobs update below wrote that unchanged array,
    // matched a row, and the dialog closed reporting success — with nothing
    // attached. Proof photos gate completion and payout, so "looks saved,
    // saved nothing" is the worst possible failure here. Observed live during
    // the 2026-08-26 lifecycle run, where it was initially misread as a CSP
    // problem; the uploads were simply failing and saying so to no one.
    let failedUploads = 0;
    for (const file of files) {
      const ext = file.name.split(".").pop();
      const path = `${jobId}/${type}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("proof-photos").upload(path, file);
      if (error) {
        failedUploads += 1;
        report(error, { tags: { source: "PhotoProof.upload", proof_type: type } });
        continue;
      }
      const { data, error: signError } = await supabase.storage.from("proof-photos").createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signError) {
        report(signError, { tags: { source: "PhotoProof.createSignedUrl", proof_type: type } });
        toast.error("Uploaded, but couldn't generate a preview link.");
      } else if (data?.signedUrl) {
        urls.push(data.signedUrl);
      }
    }

    // Nothing new landed in storage — do not write, and do not close as if it
    // had. Returning here keeps the chosen files in the dialog so the user can
    // simply retry rather than re-picking them.
    if (failedUploads === files.length) {
      toast.error(
        files.length === 1
          ? "That photo didn't upload. Check your connection and try again."
          : "None of those photos uploaded. Check your connection and try again.",
      );
      setUploading(false);
      return;
    }
    if (failedUploads > 0) {
      toast.warning(
        `${failedUploads} of ${files.length} photos didn't upload — the rest were attached.`,
      );
    }

    const updateField = type === "before" ? { proof_before_urls: urls } : { proof_after_urls: urls };
    // .select("id"): without it a jobs update that matches zero rows (RLS, a
    // job that already moved on) returns error === null, and the dialog closed
    // as if the proof photos were attached.
    try {
      unwrapMutation(
        await supabase.from("jobs").update(updateField).eq("id", jobId).select("id"),
        {
          action: "attach these photos to the job",
          rejectedMessage: "Photos uploaded, but they couldn't be attached to this job — it may have already been closed.",
          context: { jobId, proofType: type },
        },
      );
    } catch (updateError) {
      if (!isWriteRejected(updateError)) {
        report(updateError, { tags: { source: "PhotoProof.save" } });
      }
      toast.error(
        mutationErrorMessage(updateError, "Photos uploaded but couldn't be saved to the job. Please try again."),
      );
      setUploading(false);
      return;
    }

    setFiles([]);
    setPreviews([]);
    setOpen(false);
    setUploading(false);
    onUploaded();
  };

  const hasPhotos = existingUrls.length > 0;

  return (
    <>
      <Button size="sm" variant={hasPhotos ? "ghost" : "outline"} onClick={() => setOpen(true)} className={hasPhotos ? "text-primary" : ""}>
        {hasPhotos ? <CheckCircle2 className="w-4 h-4 mr-1" /> : <Camera className="w-4 h-4 mr-1" />}
        {type === "before" ? "Before" : "After"} {hasPhotos ? `(${existingUrls.length})` : "Photos"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHero
            eyebrow={
              <>
                <Camera className="w-3 h-3" /> Proof of work
              </>
            }
            title={`${type === "before" ? "Before" : "After"} photos`}
          />
          <div className="space-y-3">
            {existingUrls.length > 0 && (
              <div className="space-y-1.5">
                <p
                  className="font-serif italic uppercase text-ds-10"
                  style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
                >
                  Already uploaded
                </p>
                <div className="flex gap-2 flex-wrap">
                  {existingUrls.map((url, i) => (
                    <img
                      loading="lazy"
                      decoding="async"
                      key={i}
                      src={url}
                      alt={`Job photo ${i + 1}`}
                      className="w-20 h-20 rounded-2xl object-cover"
                      style={{
                        border: "0.5px solid hsl(var(--olivewood) / 0.18)",
                        boxShadow: "0 1px 2px hsl(var(--olivewood) / 0.06)",
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2.5">
              {previews.map((src, i) => (
                <div
                  key={i}
                  className="relative w-20 h-20 rounded-2xl overflow-hidden group"
                  style={{
                    border: "0.5px solid hsl(var(--olivewood) / 0.18)",
                    boxShadow: "var(--elev-card)",
                  }}
                >
                  {src.startsWith("blob:") ? (
                    <img loading="lazy" decoding="async" src={src} alt={`Photo ${i + 1} preview`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center" style={{ background: "hsl(var(--ivory-sand) / 0.6)" }}>
                      <ImagePlus className="w-5 h-5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    aria-label={`Remove photo ${i + 1}`}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 active:opacity-100 active:scale-90 transition-all"
                    style={{
                      background: "hsl(var(--burnt-sienna))",
                      color: "hsl(var(--parchment))",
                      boxShadow: "var(--elev-sienna-glow)",
                    }}
                  >
                    <X className="w-3 h-3" strokeWidth={2.5} />
                  </button>
                </div>
              ))}
              {files.length < 5 && (
                isNativePlatform ? (
                  <button
                    type="button"
                    onClick={handleNativeAdd}
                    className="w-20 h-20 rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all active:scale-[0.97]"
                    style={{
                      background: "hsla(0, 0%, 100%, 0.4)",
                      border: "1.5px dashed hsl(var(--bark) / 0.30)",
                    }}
                  >
                    <ImagePlus className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
                    <span
                      className="font-sans font-semibold mt-1 text-ds-10"
                      style={{ color: "hsl(var(--bark))", letterSpacing: "0.04em" }}
                    >
                      Add Photo
                    </span>
                  </button>
                ) : (
                  <label
                    className="w-20 h-20 rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all active:scale-[0.97]"
                    style={{
                      background: "hsla(0, 0%, 100%, 0.4)",
                      border: "1.5px dashed hsl(var(--bark) / 0.30)",
                    }}
                  >
                    <ImagePlus className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
                    <span
                      className="font-sans font-semibold mt-1 text-ds-10"
                      style={{ color: "hsl(var(--bark))", letterSpacing: "0.04em" }}
                    >
                      Add Photo
                    </span>
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleSelect} />
                  </label>
                )
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} className="rounded-ds-md">Cancel</Button>
            <Button
              onClick={upload}
              disabled={uploading || files.length === 0}
              className="rounded-ds-md"
              style={
                !uploading && files.length > 0
                  ? {
                      background: "hsl(var(--bark))",
                      backgroundImage: "none",
                      border: "1px solid hsl(var(--bark))",
                      color: "hsl(var(--parchment))",
                      boxShadow: "var(--elev-bark-raised)",
                    }
                  : undefined
              }
            >
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

/* ── Grouped Before & After card ── */
type PhotoProofGroupProps = {
  jobId: string;
  beforeUrls: string[];
  afterUrls: string[];
  onUploaded?: () => void;
  canUpload?: boolean;
  /** Fine-grained: allow uploading before photos (defaults to canUpload) */
  canUploadBefore?: boolean;
  /** Fine-grained: allow uploading after photos (defaults to canUpload) */
  canUploadAfter?: boolean;
  requireAfter?: boolean;
  budget?: number;
};

export const PhotoProofGroup = ({
  jobId, beforeUrls, afterUrls, onUploaded = () => {}, canUpload = true, canUploadBefore, canUploadAfter, requireAfter = false, budget = 0,
}: PhotoProofGroupProps) => {
  const showBeforeUpload = canUploadBefore ?? canUpload;
  const showAfterUpload = canUploadAfter ?? canUpload;
  const hasBefore = beforeUrls.length > 0;
  const hasAfter = afterUrls.length > 0;
  const [viewOpen, setViewOpen] = useState(false);

  // If no photos at all and can't upload, show a minimal empty state
  if (!hasBefore && !hasAfter && !showBeforeUpload && !showAfterUpload) {
    return (
      <div className="rounded-ds-md border border-border bg-muted/20 overflow-hidden">
        <div className="px-3 py-2 bg-muted/30 border-b border-border/40 flex items-center gap-1.5">
          <Image className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-ds-11 font-semibold text-foreground">Photo Proof</span>
        </div>
        <div className="px-3 py-3">
          {/* Full `text-muted-foreground`, not `/60`: the alpha dropped this
              11px line to 2.61:1 on the card surface (axe, serious). It was
              invisible to the sweep because it only renders inside a completed
              card's expanded section. */}
          <p className="text-ds-11 text-muted-foreground italic text-center">No photos were uploaded for this job</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-ds-md border border-border bg-muted/20 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-muted/30 border-b border-border/40 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Image className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-ds-11 font-semibold text-foreground">Photo Proof</span>
        </div>
        {(hasBefore || hasAfter) && (
          <button onClick={() => setViewOpen(true)} className="text-ds-10 text-primary hover:underline font-medium">
            View All
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        <div className="grid grid-cols-2 gap-3">
          {/* Before column */}
          <div className="space-y-1.5">
            <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-wider">Before</p>
            {hasBefore ? (
              <div className="flex gap-1.5 flex-wrap">
                {beforeUrls.slice(0, 3).map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img loading="lazy" decoding="async" src={url} alt={`Before ${i + 1}`} className="w-14 h-14 rounded-ds-sm object-cover border border-border hover:border-primary transition-colors" />
                  </a>
                ))}
                {beforeUrls.length > 3 && (
                  <div className="w-14 h-14 rounded-ds-sm bg-muted flex items-center justify-center text-ds-11 text-muted-foreground font-medium">
                    +{beforeUrls.length - 3}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-ds-10 text-muted-foreground/60 italic">No photos</div>
            )}
            {showBeforeUpload && (
              <PhotoProof jobId={jobId} type="before" existingUrls={beforeUrls} onUploaded={onUploaded} />
            )}
          </div>

          {/* After column */}
          <div className="space-y-1.5">
            <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-wider">After</p>
            {hasAfter ? (
              <div className="flex gap-1.5 flex-wrap">
                {afterUrls.slice(0, 3).map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img loading="lazy" decoding="async" src={url} alt={`After ${i + 1}`} className="w-14 h-14 rounded-ds-sm object-cover border border-border hover:border-primary transition-colors" />
                  </a>
                ))}
                {afterUrls.length > 3 && (
                  <div className="w-14 h-14 rounded-ds-sm bg-muted flex items-center justify-center text-ds-11 text-muted-foreground font-medium">
                    +{afterUrls.length - 3}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-ds-10 text-muted-foreground/60 italic">No photos</div>
            )}
            {showAfterUpload && (
              <PhotoProof jobId={jobId} type="after" existingUrls={afterUrls} onUploaded={onUploaded} />
            )}
          </div>
        </div>

        {/* States the SAME rule the completion buttons enforce (see
            photoProofPolicy): before & after on every job. The old note said
            "After-photos required for jobs $50+" — a rule none of the gates
            actually applied. */}
        {requireAfter && !hasRequiredProof({ budget }, beforeUrls, afterUrls) && (
          <p className="text-ds-11 text-destructive flex items-center gap-1 mt-2">
            <Camera className="w-3 h-3" /> {requiredProof({ budget }).reason}
          </p>
        )}
      </div>

      {/* Full view dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent>
          <DialogHero
            eyebrow={
              <>
                <Image className="w-3 h-3" /> Proof of work
              </>
            }
            title="Photo Proof"
          />
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {hasBefore && (
              <div className="space-y-2">
                <p className="text-ds-11 font-semibold text-muted-foreground uppercase tracking-wider">Before</p>
                <div className="grid grid-cols-3 gap-2">
                  {beforeUrls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                      <img loading="lazy" decoding="async" src={url} alt={`Before ${i + 1}`} className="w-full aspect-square rounded-ds-sm object-cover border border-border hover:border-primary transition-colors" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {hasAfter && (
              <div className="space-y-2">
                <p className="text-ds-11 font-semibold text-muted-foreground uppercase tracking-wider">After</p>
                <div className="grid grid-cols-3 gap-2">
                  {afterUrls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                      <img loading="lazy" decoding="async" src={url} alt={`After ${i + 1}`} className="w-full aspect-square rounded-ds-sm object-cover border border-border hover:border-primary transition-colors" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {!hasBefore && !hasAfter && (
              <p className="text-ds-11 text-muted-foreground text-center py-6">No photos uploaded yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
