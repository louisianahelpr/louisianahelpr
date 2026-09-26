import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { Camera, ImagePlus, X, CheckCircle2, Image } from "lucide-react";
import { CardSubPanel } from "@/components/ui/CardSubPanel";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { unwrapMutation, isWriteRejected, mutationErrorMessage } from "@/lib/mutationResult";
import { hasRequiredProof, requiredProof } from "@/lib/photoProofPolicy";
import { isNativePlatform } from "@/lib/nativeInit";
import { pickImagesNative, pickerFailure } from "@/lib/nativeCamera";
import { JOB_ACTION_CHIP_CLASS, JOB_ROW_LABEL_CLASS, jobActionChipStyle } from "@/components/job-card/JobActionRow";
import { useProofPhotoUrls, PENDING_PHOTO_SRC } from "@/hooks/useProofPhotoUrls";

type PhotoProofProps = {
  jobId: string;
  type: "before" | "after";
  existingUrls: string[];
  onUploaded: () => void;
  /**
   * Trigger label override.
   *
   * The default ("Before Photos" / "After Photos") names the CATEGORY, which
   * is right in PhotoProofGroup where two columns sit side by side and the
   * label is the only thing telling them apart. Under a step's own
   * "Add an after photo" header it was the same words twice, one above the
   * other — a button restating its heading reads as the old rival control
   * rather than the heading's action.
   */
  triggerLabel?: string;
  /**
   * Draw the trigger as a JOB-CARD ACTION ROW CONTROL rather than the panel's
   * own full-width button (owner, 2026-09-19: "before and after buttons should
   * also be on the same lines as the other buttons").
   *
   * Same `JOB_ACTION_CHIP_CLASS` / `JOB_ROW_LABEL_CLASS` every other control in
   * that row wears, so the capture control cannot become a fourth kind of
   * button. The DIALOG is unchanged — this is only where the tap comes from.
   */
  chip?: boolean;
};

const PhotoProof = ({ jobId, type, existingUrls, onUploaded, triggerLabel, chip }: PhotoProofProps) => {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  // Stored values are storage PATHS; the ticket is minted here, for this open
  // dialog, and lives ten minutes.
  const existingSrcs = useProofPhotoUrls(existingUrls);

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
      const failure = pickerFailure(err, "photos");
      if (failure?.isError) report(err, { tags: { source: "PhotoProof.handleNativeAdd" } });
      if (failure) toast.error(failure.copy);
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
      // THE PATH, NOT A SIGNED URL. `proof-photos` is private, so this used to
      // mint a 365-day signed URL here and store THAT — a JWT with an `exp`
      // written into `jobs.proof_before_urls`. The row is correct the day it
      // is written and 400s forever after, with no error on either side: the
      // reader just gets an empty box with its alt text. Proof photos are the
      // evidence a dispute is decided on and the thing that releases a
      // payout, so an expiry date on them is not a cosmetic bug.
      //
      // Storing the path moves the ticket to display time
      // (`useProofPhotoUrls`), which is the pattern the repo already wrote
      // down for `user-documents` in 20260505220000.
      urls.push(path);
    }

    // Nothing new landed in storage — do not write, and do not close as if it
    // had. Returning here keeps the chosen files in the dialog so the user can
    // simply retry rather than re-picking them.
    if (failedUploads === files.length) {
      // Don't blame the network. The long-standing cause here was an RLS
      // policy mismatch (fixed 2026-08-31) — a permanent server-side failure
      // that no amount of retrying or better signal would ever clear, while
      // this told the user to check their connection.
      toast.error(
        files.length === 1
          ? "That photo didn't upload. Try again — if it keeps failing, contact support."
          : "None of those photos uploaded. Try again — if it keeps failing, contact support.",
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

  const triggerText =
    triggerLabel && !hasPhotos
      ? triggerLabel
      : `${type === "before" ? "Before" : "After"} ${hasPhotos ? `(${existingUrls.length})` : "Photos"}`;

  return (
    <>
      {chip ? (
        /* THE ROW CONTROL. `edit` tone — the row's sunshine "this one wants
           something from you" tint — so it is visibly distinct from the
           neutral `Photos` chip that OPENS the gallery, and from the green
           primary it sits beside.

           THE `done` TONE IS REACHABLE NOW (owner, 2026-09-19). It used to be
           dead: HelperPhotoAsk stopped rendering this chip the moment the
           photo existed, so `hasPhotos` was always false here. The REVISION
           step keeps offering the After chip after one exists — a revision is
           a second round of work and needs new evidence — so the tick, the
           `done` tint and the "After (1)" count are what that state draws. */
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          className={JOB_ACTION_CHIP_CLASS}
          style={jobActionChipStyle(hasPhotos ? "done" : "edit")}
          aria-label={`${triggerText} — add the ${type} photo for this job`}
        >
          {hasPhotos ? <CheckCircle2 className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
          <span className={JOB_ROW_LABEL_CLASS}>{triggerText}</span>
        </Button>
      ) : (
        /* This trigger only ever renders inside PhotoProofGroup's two-column
           grid (the two call sites below), so sizing it to its column is safe.
           `whitespace-normal` overrides the Button base's `whitespace-nowrap`,
           which is what forced the overflow; `h-auto` + `leading-tight` let it
           become two lines rather than clip. No label text is changed. */
        <Button
          size="sm"
          variant={hasPhotos ? "ghost" : "outline"}
          onClick={() => setOpen(true)}
          className={`w-full min-w-0 h-auto min-h-9 py-1.5 whitespace-normal leading-tight ${hasPhotos ? "text-primary" : ""}`}
        >
          {hasPhotos ? <CheckCircle2 className="w-4 h-4 mr-1" /> : <Camera className="w-4 h-4 mr-1" />}
          {triggerText}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHero
            title={`${type === "before" ? "Before" : "After"} photos`}
          />
          <div className="space-y-3">
            {existingUrls.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Already uploaded
                </p>
                <div className="flex gap-2 flex-wrap">
                  {existingUrls.map((url, i) => (
                    <img
                      loading="lazy"
                      decoding="async"
                      key={url ?? i}
                      src={existingSrcs[i] ?? PENDING_PHOTO_SRC}
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
                      background: "hsl(var(--card) / 0.4)",
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
                    className="w-20 h-20 rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all active:scale-[0.97] focus-within:ring-2 focus-within:ring-[hsl(var(--bark)/0.45)]"
                    style={{
                      background: "hsl(var(--card) / 0.4)",
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
                    <input type="file" accept="image/*" multiple className="sr-only" onChange={handleSelect} />
                  </label>
                )
              )}
            </div>
          </div>
          <DialogFooter>
            <DialogSecondaryAction onClick={() => setOpen(false)}>Cancel</DialogSecondaryAction>
            {/* Shared glossy primary. Was a hand-written inline style that
                set `backgroundImage: "none"` — i.e. it deliberately DELETED
                the `.btn-grad-primary` gradient and painted a flat bark fill,
                against the standing "primary controls are glossy, never flat"
                rule. It also re-implemented the disabled state by dropping the
                style object, which lost the shared 50%-opacity treatment. */}
            <DialogPrimaryAction
              onClick={upload}
              disabled={uploading || files.length === 0}
            >
              {uploading ? "Uploading…" : "Upload"}
            </DialogPrimaryAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

/* ── The full before/after gallery, on its own ──────────────────────────────
 *
 * Owner, 2026-09-19 (item 10): on a job card the before & after pictures are a
 * BUTTON on the same row as the other action buttons. A button needs something
 * to open, and what it opens is exactly what PhotoProofGroup's "View All"
 * already opened — so the dialog is lifted out whole rather than written a
 * second time, and the group keeps using it. Nothing about the gallery itself
 * changes.
 *
 * Read-only by design: the uploader is a different control (`PhotoProofCaptureChip`,
 * the row's own ask), and this is the surface for LOOKING at proof.
 */
export const PhotoProofDialog = ({
  open,
  onOpenChange,
  beforeUrls,
  afterUrls,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beforeUrls: string[];
  afterUrls: string[];
}) => {
  const hasBefore = beforeUrls.length > 0;
  const hasAfter = afterUrls.length > 0;
  const beforeSrcs = useProofPhotoUrls(beforeUrls);
  const afterSrcs = useProofPhotoUrls(afterUrls);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHero
          title="Photo Proof"
        />
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {hasBefore && (
            <div className="space-y-2">
              <p className="text-ds-11 font-semibold text-muted-foreground uppercase tracking-wider">Before</p>
              <div className="grid grid-cols-3 gap-2">
                {beforeUrls.map((url, i) => (
                  <a key={url ?? i} href={beforeSrcs[i] ?? undefined} target="_blank" rel="noopener noreferrer">
                    <img loading="lazy" decoding="async" src={beforeSrcs[i] ?? PENDING_PHOTO_SRC} alt={`Before ${i + 1}`} className="w-full aspect-square rounded-ds-sm object-cover border border-border hover:border-primary transition-colors" />
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
                  <a key={url ?? i} href={afterSrcs[i] ?? undefined} target="_blank" rel="noopener noreferrer">
                    <img loading="lazy" decoding="async" src={afterSrcs[i] ?? PENDING_PHOTO_SRC} alt={`After ${i + 1}`} className="w-full aspect-square rounded-ds-sm object-cover border border-border hover:border-primary transition-colors" />
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

/**
 * "Before & after photos are required on this job" — the one red line that says
 * a job is short of the proof its budget demands.
 *
 * It used to live inside PhotoProofGroup's panel. Item 10 (owner, 2026-09-19)
 * replaced that panel on the job cards with a Photos chip + PhotoProofDialog,
 * and the dialog shows photos and nothing else — so on the DISPUTED card the
 * line silently disappeared. That is the one card where it matters most: a
 * poster weighing a dispute is weighing exactly this evidence, and its absence
 * reads as "proof is fine" rather than "proof is missing".
 *
 * Exported so the panel and the cards share ONE definition of the rule instead
 * of the cards re-deriving it. Renders nothing when the proof requirement is
 * met or not in force, so a host can mount it unconditionally.
 */
/**
 * WHO IS BEING TOLD (owner, 2026-09-19, on a POSTER's disputed card).
 *
 * `requiredProof().reason` is written to the HELPER — "…they're the proof that
 * releases your payment" — because the helper is the only person who can act
 * on it. The poster's disputed card mounts this same note, and on their screen
 * "your payment" is not merely imprecise: the poster is the one the money
 * leaves, and there is no control on their card that could satisfy the
 * requirement, because they are not who uploads work proof.
 *
 * The rule is unchanged and still has exactly ONE definition
 * (`src/lib/photoProofPolicy.ts`, owned elsewhere — nothing here re-derives
 * which photos are required or whether they are missing). What changes is only
 * the sentence, per audience, and only the poster's variant is new.
 */
export type ProofNoteAudience = "helper" | "poster";

/** What the poster is told instead. It states the FACT rather than an
 *  instruction, because the poster has nothing to tap: the control that fixes
 *  it is on the Helpr's card. */
export const POSTER_PROOF_MISSING_NOTE =
  "Your Helpr hasn't filed the before & after photos for this job.";

export const PhotoProofRequirementNote = ({
  budget = 0,
  beforeUrls,
  afterUrls,
  audience = "helper",
  className = "",
}: {
  budget?: number;
  beforeUrls: string[];
  afterUrls: string[];
  /** Default "helper" — every pre-existing call site is the Helpr's own card
   *  and its copy is byte-for-byte unchanged. */
  audience?: ProofNoteAudience;
  className?: string;
}) => {
  if (hasRequiredProof({ budget }, beforeUrls, afterUrls)) return null;
  const { reason } = requiredProof({ budget });
  if (!reason) return null;
  const text = audience === "poster" ? POSTER_PROOF_MISSING_NOTE : reason;
  return (
    <p className={`text-ds-11 text-[hsl(var(--destructive-ink))] flex items-center gap-1 ${className}`}>
      <Camera className="w-3 h-3" /> {text}
    </p>
  );
};

export const PhotoProofGroup = ({
  jobId, beforeUrls, afterUrls, onUploaded = () => {}, canUpload = true, canUploadBefore, canUploadAfter, requireAfter = false, budget = 0,
}: PhotoProofGroupProps) => {
  const showBeforeUpload = canUploadBefore ?? canUpload;
  const showAfterUpload = canUploadAfter ?? canUpload;
  const hasBefore = beforeUrls.length > 0;
  const hasAfter = afterUrls.length > 0;
  const [viewOpen, setViewOpen] = useState(false);
  // Only the three thumbnails this panel actually paints get a ticket; the
  // rest are behind "View All", which signs its own.
  const beforeSrcs = useProofPhotoUrls(beforeUrls.slice(0, 3));
  const afterSrcs = useProofPhotoUrls(afterUrls.slice(0, 3));

  // If no photos at all and can't upload, show a minimal empty state
  if (!hasBefore && !hasAfter && !showBeforeUpload && !showAfterUpload) {
    return (
      <CardSubPanel icon={Image} title="Photo Proof">
        {/* Full `text-muted-foreground`, not `/60`: the alpha dropped this
            11px line to 2.61:1 on the card surface (axe, serious). It was
            invisible to the sweep because it only renders inside a completed
            card's expanded section. */}
        <p className="text-ds-11 text-muted-foreground text-center">No photos were uploaded for this job</p>
      </CardSubPanel>
    );
  }

  return (
    <CardSubPanel
      icon={Image}
      title="Photo Proof"
      action={
        (hasBefore || hasAfter) ? (
          <button onClick={() => setViewOpen(true)} className="text-ds-10 text-primary hover:underline font-medium shrink-0">
            View All
          </button>
        ) : undefined
      }
    >
      <>
        {/* `min-w-0` on both columns is load-bearing. A grid track defaults to
            minmax(auto, 1fr), so its MINIMUM width is the intrinsic width of
            its content — and the content is a `whitespace-nowrap` Button. At
            402pt the two buttons' intrinsic widths exceed the card, so the
            tracks grew past it: "Before Photos" was clipped underneath "After
            Photos", which overflowed the card's right edge. min-w-0 lets the
            tracks shrink to their fair half; the button below wraps to fit. */}
        <div className="grid grid-cols-2 gap-3">
          {/* Before column */}
          <div className="space-y-1.5 min-w-0">
            <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-wider">Before</p>
            {hasBefore ? (
              <div className="flex gap-1.5 flex-wrap">
                {beforeUrls.slice(0, 3).map((url, i) => (
                  <a key={url ?? i} href={beforeSrcs[i] ?? undefined} target="_blank" rel="noopener noreferrer">
                    <img loading="lazy" decoding="async" src={beforeSrcs[i] ?? PENDING_PHOTO_SRC} alt={`Before ${i + 1}`} className="w-14 h-14 rounded-ds-sm object-cover border border-border hover:border-primary transition-colors" />
                  </a>
                ))}
                {beforeUrls.length > 3 && (
                  <div className="w-14 h-14 rounded-ds-sm bg-muted flex items-center justify-center text-ds-11 text-muted-foreground font-medium">
                    +{beforeUrls.length - 3}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-ds-10 text-muted-foreground/60">No photos</div>
            )}
            {showBeforeUpload && (
              <PhotoProof jobId={jobId} type="before" existingUrls={beforeUrls} onUploaded={onUploaded} />
            )}
          </div>

          {/* After column */}
          <div className="space-y-1.5 min-w-0">
            <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-wider">After</p>
            {hasAfter ? (
              <div className="flex gap-1.5 flex-wrap">
                {afterUrls.slice(0, 3).map((url, i) => (
                  <a key={url ?? i} href={afterSrcs[i] ?? undefined} target="_blank" rel="noopener noreferrer">
                    <img loading="lazy" decoding="async" src={afterSrcs[i] ?? PENDING_PHOTO_SRC} alt={`After ${i + 1}`} className="w-14 h-14 rounded-ds-sm object-cover border border-border hover:border-primary transition-colors" />
                  </a>
                ))}
                {afterUrls.length > 3 && (
                  <div className="w-14 h-14 rounded-ds-sm bg-muted flex items-center justify-center text-ds-11 text-muted-foreground font-medium">
                    +{afterUrls.length - 3}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-ds-10 text-muted-foreground/60">No photos</div>
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
        {/* `requireAfter` stays the panel's own gate — the note decides only
            whether the proof is short, not whether this host cares. Dropping it
            here would start warning on panels that never asked to. */}
        {requireAfter && (
          <PhotoProofRequirementNote
            budget={budget}
            beforeUrls={beforeUrls}
            afterUrls={afterUrls}
            className="mt-2"
          />
        )}
      </>

      {/* The full gallery. It lives in its own exported component now
          (`PhotoProofDialog`, below) because the job cards ask for the gallery
          WITHOUT this panel: owner, 2026-09-19, item 10 — "before & after
          pictures" is a button on the same row as the other action buttons,
          not a second card above them. Same dialog, two hosts. */}
      <PhotoProofDialog open={viewOpen} onOpenChange={setViewOpen} beforeUrls={beforeUrls} afterUrls={afterUrls} />
    </CardSubPanel>
  );
};

/**
 * THE SAME UPLOAD, AS ONE CONTROL ON THE JOB CARD'S ACTION ROW.
 *
 * Owner, 2026-09-19: "before and after buttons should also be on the same
 * lines as the other buttons". The old PhotoProofStep — a titled panel with a
 * hint line and a full-width "Add Photo" button — was the block sitting ABOVE
 * the row in their screenshot. This is the same uploader and the same dialog,
 * drawn as the row's own control.
 *
 * `label` names WHICH photo ("Before Photo" / "After Photo"), which is what
 * keeps it from reading as a duplicate of the neutral `Photos` chip beside it
 * on the disputed card — that one OPENS the gallery of photos already taken
 * (`PhotoProofDialog`), this one ADDS the one that is missing. Two controls,
 * two verbs, two tones; they were deliberately not merged, because merging
 * them would mean a helper with no before photo taps "Photos" and lands in an
 * empty gallery instead of the camera.
 */
export const PhotoProofCaptureChip = ({
  jobId,
  type,
  existingUrls,
  onUploaded = () => {},
  label,
}: {
  jobId: string;
  type: "before" | "after";
  existingUrls: string[];
  onUploaded?: () => void;
  label: string;
}) => (
  <PhotoProof
    jobId={jobId}
    type={type}
    existingUrls={existingUrls}
    onUploaded={onUploaded}
    triggerLabel={label}
    chip
  />
);
