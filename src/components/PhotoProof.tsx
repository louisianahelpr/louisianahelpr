import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Camera, ImagePlus, X, CheckCircle2, Image } from "lucide-react";
import { toast } from "sonner";

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

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (files.length + selected.length > 5) { toast.error("Max 5 photos"); return; }
    const newFiles = [...files, ...selected].slice(0, 5);
    setFiles(newFiles);
    setPreviews(newFiles.map(f => URL.createObjectURL(f)));
  };

  const removeFile = (i: number) => {
    const newFiles = files.filter((_, idx) => idx !== i);
    setFiles(newFiles);
    setPreviews(newFiles.map(f => URL.createObjectURL(f)));
  };

  const upload = async () => {
    if (files.length === 0) { toast.error("Add at least one photo"); return; }
    setUploading(true);
    const urls: string[] = [...existingUrls];
    for (const file of files) {
      const ext = file.name.split(".").pop();
      const path = `${jobId}/${type}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("proof-photos").upload(path, file);
      if (error) { console.error(error); continue; }
      const { data } = supabase.storage.from("proof-photos").getPublicUrl(path);
      urls.push(data.publicUrl);
    }

    const updateField = type === "before" ? { proof_before_urls: urls } : { proof_after_urls: urls };
    await supabase.from("jobs").update(updateField as any).eq("id", jobId);

    toast.success(`${type === "before" ? "Before" : "After"} photos uploaded!`);
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
          <DialogHeader>
            <DialogTitle className="font-display">{type === "before" ? "Before" : "After"} Photos</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {existingUrls.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Already uploaded</p>
                <div className="flex gap-2 flex-wrap">
                  {existingUrls.map((url, i) => (
                    <img key={i} src={url} alt="" className="w-20 h-20 rounded-lg object-cover border border-border" />
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              {previews.map((src, i) => (
                <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border group">
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => removeFile(i)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {files.length < 5 && (
                <label className="w-20 h-20 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center cursor-pointer transition-colors">
                  <ImagePlus className="w-5 h-5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground mt-0.5">Add</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleSelect} />
                </label>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={upload} disabled={uploading || files.length === 0}>
              {uploading ? "Uploading…" : "Upload Photos"}
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
  requireAfter?: boolean;
  budget?: number;
};

export const PhotoProofGroup = ({
  jobId, beforeUrls, afterUrls, onUploaded = () => {}, canUpload = true, requireAfter = false, budget = 0,
}: PhotoProofGroupProps) => {
  const hasBefore = beforeUrls.length > 0;
  const hasAfter = afterUrls.length > 0;
  const [viewOpen, setViewOpen] = useState(false);

  // If no photos at all and can't upload, show a minimal empty state
  if (!hasBefore && !hasAfter && !canUpload) {
    return (
      <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
        <div className="px-3 py-2 bg-muted/30 border-b border-border/40 flex items-center gap-1.5">
          <Image className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Photo Proof</span>
        </div>
        <div className="px-3 py-3">
          <p className="text-xs text-muted-foreground/60 italic text-center">No photos were uploaded for this job</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-muted/30 border-b border-border/40 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Image className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Photo Proof</span>
        </div>
        {(hasBefore || hasAfter) && (
          <button onClick={() => setViewOpen(true)} className="text-[10px] text-primary hover:underline font-medium">
            View all
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        <div className="grid grid-cols-2 gap-3">
          {/* Before column */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Before</p>
            {hasBefore ? (
              <div className="flex gap-1.5 flex-wrap">
                {beforeUrls.slice(0, 3).map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img src={url} alt={`Before ${i + 1}`} className="w-14 h-14 rounded-lg object-cover border border-border hover:border-primary transition-colors" />
                  </a>
                ))}
                {beforeUrls.length > 3 && (
                  <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center text-xs text-muted-foreground font-medium">
                    +{beforeUrls.length - 3}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground/60 italic">No photos</div>
            )}
            {canUpload && (
              <PhotoProof jobId={jobId} type="before" existingUrls={beforeUrls} onUploaded={onUploaded} />
            )}
          </div>

          {/* After column */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">After</p>
            {hasAfter ? (
              <div className="flex gap-1.5 flex-wrap">
                {afterUrls.slice(0, 3).map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                    <img src={url} alt={`After ${i + 1}`} className="w-14 h-14 rounded-lg object-cover border border-border hover:border-primary transition-colors" />
                  </a>
                ))}
                {afterUrls.length > 3 && (
                  <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center text-xs text-muted-foreground font-medium">
                    +{afterUrls.length - 3}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground/60 italic">No photos</div>
            )}
            {canUpload && (
              <PhotoProof jobId={jobId} type="after" existingUrls={afterUrls} onUploaded={onUploaded} />
            )}
          </div>
        </div>

        {/* Warning for $50+ jobs */}
        {requireAfter && budget >= 50 && !hasAfter && (
          <p className="text-xs text-destructive flex items-center gap-1 mt-2">
            <Camera className="w-3 h-3" /> After-photos required for jobs $50+
          </p>
        )}
      </div>

      {/* Full view dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">Photo Proof</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {hasBefore && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Before</p>
                <div className="grid grid-cols-3 gap-2">
                  {beforeUrls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                      <img src={url} alt={`Before ${i + 1}`} className="w-full aspect-square rounded-lg object-cover border border-border hover:border-primary transition-colors" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {hasAfter && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">After</p>
                <div className="grid grid-cols-3 gap-2">
                  {afterUrls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                      <img src={url} alt={`After ${i + 1}`} className="w-full aspect-square rounded-lg object-cover border border-border hover:border-primary transition-colors" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            {!hasBefore && !hasAfter && (
              <p className="text-sm text-muted-foreground text-center py-6">No photos uploaded yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
