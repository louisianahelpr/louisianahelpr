import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { ImagePlus, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { maybeRequestInAppReview } from "@/lib/inAppReview";
import { maybeCelebrate } from "@/lib/celebrate";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { track, AhaEvent } from "@/lib/analytics";
import { TipDialog } from "@/components/TipDialog";
import { isNativePlatform } from "@/lib/nativeInit";
import { pickImagesNative } from "@/lib/nativeCamera";
import { report } from "@/lib/errorLogger";
import { StarRow } from "./StarRow";
import { CATEGORY_ROWS, safeImageSrc, type CategoryKey, type ReviewFormProps } from "./types";

export const ReviewForm = ({ open, onClose, jobId, revieweeId, revieweeName }: ReviewFormProps) => {
  const [scores, setScores] = useState<Record<CategoryKey, number>>({
    rating: 0,
    punctuality: 0,
    quality: 0,
    communication: 0,
  });
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Photo attachments — up to 3 photos per review.
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // When a poster leaves a 5-star review, surface a tip prompt before
  // closing the form. Tighter than the separate Tip flow — caught at
  // the moment of peak satisfaction.
  const [tipPromptOpen, setTipPromptOpen] = useState(false);
  const [tipDialogOpen, setTipDialogOpen] = useState(false);

  const MAX_PHOTOS = 3;

  const addPhotoFiles = (selected: File[]) => {
    if (selected.length === 0) return;
    const combined = [...photoFiles, ...selected].slice(0, MAX_PHOTOS);
    setPhotoFiles(combined);
    setPhotoPreviews(combined.map((f) => URL.createObjectURL(f)));
  };

  const removePhoto = (i: number) => {
    const next = photoFiles.filter((_, idx) => idx !== i);
    setPhotoFiles(next);
    setPhotoPreviews(next.map((f) => URL.createObjectURL(f)));
  };

  const handlePhotoInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    addPhotoFiles(Array.from(e.target.files || []));
    // Reset the input so the same file can be re-selected after removal.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleNativePhotoPick = async () => {
    try {
      const picked = await pickImagesNative(MAX_PHOTOS - photoFiles.length);
      addPhotoFiles(picked);
    } catch (err) {
      report(err, { tags: { source: "ReviewForm.handleNativePhotoPick" } });
      toast.error("Couldn't open your photos. Please try again.");
    }
  };

  const quickOptions = ["Great communicator", "On time", "Quality work", "Very professional", "Highly recommend", "Friendly & helpful"];

  const toggleQuickOption = (option: string) => {
    setFeedback((prev) => {
      const parts = prev.split(", ").filter(Boolean);
      if (parts.includes(option)) return parts.filter((p) => p !== option).join(", ");
      return [...parts, option].join(", ");
    });
  };

  const setScore = (key: CategoryKey, v: number) => setScores((prev) => ({ ...prev, [key]: v }));

  // Only the Overall rating is required to submit. The three detailed
  // categories are optional — previously requiring all four meant a
  // user who only wanted to leave an overall star rating hit a hard
  // wall ("Please rate all four categories") and the job silently
  // never got reviewed.
  const canSubmit = scores.rating > 0;
  // True once the user has also filled the detailed categories — used
  // only to brighten the submit button as positive reinforcement.
  const allRated = canSubmit && scores.punctuality > 0 && scores.quality > 0 && scores.communication > 0;

  const handleSubmit = async () => {
    if (!canSubmit) {
      hapticError();
      toast.error("Tap an Overall star rating to leave your review.");
      return;
    }
    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { hapticError(); toast.error("Please sign back in to leave your review."); setSubmitting(false); return; }

    // Upload any attached photos to the proof-photos bucket under
    // reviews/<userId>/<timestamp>. We attempt uploads but don't block
    // the review submission if they fail — photos are a bonus.
    let uploadedPhotoUrls: string[] | null = null;
    if (photoFiles.length > 0) {
      const urls: string[] = [];
      for (const file of photoFiles) {
        const ext = file.name.split(".").pop() || "jpg";
        const path = `reviews/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("proof-photos").upload(path, file);
        if (upErr) {
          report(upErr, { tags: { source: "ReviewForm.uploadPhoto" } });
          continue;
        }
        const { data: urlData } = supabase.storage.from("proof-photos").getPublicUrl(path);
        if (urlData?.publicUrl) urls.push(urlData.publicUrl);
      }
      if (urls.length > 0) uploadedPhotoUrls = urls;
    }

    const { error } = await supabase.from("reviews").insert({
      job_id: jobId,
      reviewer_id: user.id,
      reviewee_id: revieweeId,
      rating: scores.rating,
      // Unrated detailed categories persist as null (not 0) so the
      // ReviewList averages skip them rather than dragging the score down.
      punctuality: scores.punctuality > 0 ? scores.punctuality : null,
      quality: scores.quality > 0 ? scores.quality : null,
      communication: scores.communication > 0 ? scores.communication : null,
      feedback: feedback.trim() || null,
      photo_urls: uploadedPhotoUrls,
    });

    if (error) {
      hapticError();
      if (error.code === "23505") toast.error("You've already reviewed this job.");
      else toast.error("We couldn't post your review — please try again.");
    } else {
      hapticSuccess();
      toast.success("Review submitted");
      // Brand-tinted confetti for the first few reviews so the moment
      // feels worth doing again. After the limit it fades to silent.
      void maybeCelebrate("first_review");
      // Aha-moment analytics + native review prompt. A 5-star review is the
      // strongest signal that this user would also rate us 5 stars on the App Store.
      track(AhaEvent.ReviewLeft, { job_id: jobId, rating: scores.rating });
      // True first-review (any rating) — count this user's prior reviews
      // before treating this submission as the first.
      try {
        const { count: priorReviews } = await supabase
          .from("reviews")
          .select("id", { count: "exact", head: true })
          .eq("reviewer_id", user.id);
        if ((priorReviews ?? 0) <= 1) {
          track(AhaEvent.FirstReviewLeft, { job_id: jobId, rating: scores.rating });
        }
      } catch { /* analytics must never break the flow */ }
      if (scores.rating === 5) {
        track(AhaEvent.FirstFiveStarReview, { job_id: jobId, rating: 5 });
        // Fire-and-forget — internally rate-limited to once per 90 days.
        void maybeRequestInAppReview();
        // 5-star moment — show the tip prompt instead of closing
        // immediately so the poster can tip while still satisfied.
        setTipPromptOpen(true);
        setSubmitting(false);
        return;
      }
      onClose();
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto !gap-3">
        <DialogHero
          eyebrow="Your turn"
          title={`Rate ${revieweeName}.`}
        />
        <div className="space-y-3">
          {CATEGORY_ROWS.map((row) => (
            <StarRow
              key={row.key}
              value={scores[row.key]}
              onChange={(v) => setScore(row.key, v)}
              label={row.label}
              sublabel={row.sublabel}
              optional={!row.required}
            />
          ))}
          <p
            className="font-serif italic"
            style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Only the Overall rating is needed — the rest are optional. You can skip them and still post your review.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {quickOptions.map((opt) => {
              const selected = feedback.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleQuickOption(opt)}
                  className="text-ds-12 font-sans font-semibold px-3 py-1.5 rounded-full transition-all active:scale-[0.97]"
                  style={
                    selected
                      ? {
                          background: "hsl(var(--bark))",
                          color: "hsl(var(--parchment))",
                          border: "0.5px solid hsl(var(--bark))",
                          boxShadow: "0 1px 2px hsl(var(--bark) / 0.18)",
                        }
                      : {
                          background: "var(--surface-premium)",
                          color: "hsl(var(--ink-deep))",
                          border: "0.5px solid hsl(var(--olivewood) / 0.18)",
                        }
                  }
                >
                  {opt}
                </button>
              );
            })}
          </div>
          <Textarea
            aria-label="Review comment (optional)"
            placeholder="Add a comment (optional)…"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-serif italic text-ds-14 leading-relaxed"
          />

          {/* Photo attachments — up to 3 photos */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              {photoPreviews.map((url, i) => (
                <div key={url} className="relative w-16 h-16 rounded-ds-sm overflow-hidden shrink-0"
                  style={{ border: "0.5px solid hsl(var(--olivewood) / 0.18)" }}
                >
                  <img
                    src={safeImageSrc(url)}
                    alt={`Review photo ${i + 1}`}
                    className="w-full h-full object-cover"
                    decoding="async"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    aria-label={`Remove photo ${i + 1}`}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: "hsla(38, 18%, 12%, 0.72)" }}
                  >
                    <XIcon className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
              {photoFiles.length < MAX_PHOTOS && (
                <button
                  type="button"
                  onClick={() => {
                    if (isNativePlatform) {
                      void handleNativePhotoPick();
                    } else {
                      fileInputRef.current?.click();
                    }
                  }}
                  aria-label="Add review photo"
                  className="w-16 h-16 rounded-ds-sm flex flex-col items-center justify-center gap-0.5 transition-opacity hover:opacity-80 active:scale-95"
                  style={{
                    border: "1px dashed hsl(var(--olivewood) / 0.3)",
                    background: "var(--surface-premium)",
                  }}
                >
                  <ImagePlus className="w-5 h-5" style={{ color: "hsl(var(--burnt-sienna) / 0.7)" }} />
                  <span className="font-serif italic" style={{ fontSize: "0.58rem", color: "hsl(var(--olivewood) / 0.8)" }}>
                    {photoFiles.length === 0 ? "Add photo" : "Add more"}
                  </span>
                </button>
              )}
            </div>
            {photoFiles.length > 0 && (
              <p className="font-serif italic" style={{ fontSize: "0.68rem", color: "hsl(var(--olivewood) / 0.8)" }}>
                {photoFiles.length}/{MAX_PHOTOS} photo{photoFiles.length !== 1 ? "s" : ""} attached
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              aria-hidden="true"
              onChange={handlePhotoInput}
            />
          </div>
        </div>
        <DialogFooter className="!flex-col !gap-2 !items-stretch">
          <Button
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
            className="rounded-ds-md w-full"
            style={{
              background: canSubmit ? "hsl(var(--bark))" : undefined,
              backgroundImage: "none",
              border: canSubmit ? "1px solid hsl(var(--bark))" : undefined,
              color: canSubmit ? "hsl(var(--parchment))" : undefined,
              boxShadow: canSubmit ? "0 1px 2px hsl(var(--bark) / 0.18), 0 8px 20px -6px hsl(var(--bark) / 0.34)" : undefined,
            }}
          >
            {submitting ? "Submitting…" : allRated ? "Submit review" : "Post review"}
          </Button>
          {/* A non-destructive escape hatch. "Cancel" reads as "discard",
              which is wrong here — the review isn't lost, it can still be
              left later from the completed job. This says so plainly so a
              user who isn't ready right now doesn't feel pressured. */}
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
            className="rounded-ds-md w-full"
          >
            Maybe later
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Tip prompt — only opens after a 5-star review. Tighter than
          waiting for the separate tip flow on Activity. */}
      <Dialog open={tipPromptOpen} onOpenChange={(o) => { if (!o) { setTipPromptOpen(false); onClose(); } }}>
        <DialogContent className="!gap-3 sm:max-w-sm">
          <DialogHero
            eyebrow="Five stars — nice"
            title={`Send ${revieweeName} a tip?`}
          />
          {/* Relocated OUT of DialogHero's `subtitle` (2026-07-25 "one main
              title": headers show a title and nothing else). Not dropped —
              this is a fee disclosure, which a sighted
              user has to be able to read. The `subtitle` prop is gone from the
              hero above rather than left sr-only, so screen readers hear it
              once, here, instead of twice. */}
          <p className="font-serif italic leading-relaxed text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
            Goes straight to the Helpr — no platform cut. Most posters tip 10–15%
            for great work.
          </p>
          <DialogFooter className="!gap-2">
            <Button
              variant="ghost"
              onClick={() => { setTipPromptOpen(false); onClose(); }}
              className="rounded-ds-md"
            >
              No thanks
            </Button>
            <Button
              variant="bark"
              onClick={() => { setTipPromptOpen(false); setTipDialogOpen(true); }}
              className="rounded-ds-md"
            >
              Send a tip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TipDialog
        open={tipDialogOpen}
        onClose={() => { setTipDialogOpen(false); onClose(); }}
        jobId={jobId}
        helperName={revieweeName}
      />
    </Dialog>
  );
};
