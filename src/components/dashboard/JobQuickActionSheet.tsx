import { Bookmark, EyeOff, Share2, Flag } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHero } from "@/components/ui/sheet";
import { hapticLight } from "@/lib/haptics";

interface JobQuickActionSheetProps {
  /** Job under inspection — null/undefined keeps the sheet closed. */
  job: { id: string; title: string; budget?: number; category?: string } | null;
  /** Whether the job is already saved (controls Save vs Unsave label). */
  isSaved: boolean;
  /** Close handler — the parent owns the open/close state. */
  onClose: () => void;
  /** Save / unsave the job. */
  onToggleSave: (jobId: string, nextSaved: boolean) => void;
  /** Hide (dismiss) the job from the feed. */
  onHide: (jobId: string) => void;
  /** Open the existing report dialog. */
  onReport: (jobId: string) => void;
}

/**
 * Bottom action sheet for a long-press on a JobCard. Surfaces the four
 * actions a helpr can take on a card WITHOUT having to open the full
 * detail dialog: Save / Hide / Share / Report.
 *
 * Open/close is fully controlled by the parent — passing `job=null`
 * closes the sheet. The sheet uses the existing `@/components/ui/sheet`
 * primitive (Radix Dialog) so dismissal, focus trap, and a11y are free.
 *
 * Share reuses the same tiered fallback chain as `ShareJobButton`
 * (Capacitor native → navigator.share → clipboard) so the affordance
 * works on iOS shell, mobile web, and desktop.
 */
export function JobQuickActionSheet({
  job,
  isSaved,
  onClose,
  onToggleSave,
  onHide,
  onReport,
}: JobQuickActionSheetProps) {
  if (!job) return null;

  const handleShare = async () => {
    // Confirm tap on native; no-op on web.
    void hapticLight();
    // Use the canonical public job URL with ?ref=share so recipients who
    // tap the link are attributed to the share surface.
    const url = `https://www.louisianahelpr.com/jobs/${job.id}?ref=share`;
    const title = job.title;
    const text = `${job.title} — posted on Louisiana Helpr.`;
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({ title, text, url, dialogTitle: "Share this job" });
        return;
      }
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title, text, url });
        return;
      }
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied. Paste it anywhere.");
        return;
      }
      toast.message(url);
    } catch (err) {
      // User-cancellation of the OS sheet throws AbortError on web and
      // resolves silently on Capacitor — treat both as "no-op".
      if ((err as { name?: string } | null)?.name === "AbortError") return;
    }
  };

  const handleSave = () => {
    onToggleSave(job.id, !isSaved);
    onClose();
  };

  const handleHide = () => {
    onHide(job.id);
    // Close BEFORE the dismiss-confirm dialog opens so the user doesn't
    // see two sheets stacked on top of each other.
    onClose();
  };

  const handleReport = () => {
    onReport(job.id);
    onClose();
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="rounded-t-2xl border-t-0 px-4 pt-3 pb-[calc(var(--safe-area-bottom,0px)_+_1rem)]">
        {/* Canonical sheet header. Was a hand-copied eyebrow→title stack (one of
            four sheets that drifted to four different title sizes); SheetHero is
            the single source of truth. */}
        <SheetHero className="pl-1 pb-2" title={job.title} />
        <div className="grid grid-cols-1 gap-1.5">
          <ActionRow
            icon={<Bookmark className={`w-5 h-5 ${isSaved ? "fill-current" : ""}`} strokeWidth={2} />}
            label={isSaved ? "Unsave" : "Save"}
            onClick={handleSave}
          />
          <ActionRow
            icon={<EyeOff className="w-5 h-5" strokeWidth={2} />}
            label="Hide from my feed"
            onClick={handleHide}
          />
          <ActionRow
            icon={<Share2 className="w-5 h-5" strokeWidth={2} />}
            label="Share"
            onClick={handleShare}
          />
          <ActionRow
            icon={<Flag className="w-5 h-5" strokeWidth={2} />}
            label="Report"
            onClick={handleReport}
            tone="danger"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  const isDanger = tone === "danger";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-3 rounded-ds-md min-h-[48px] text-left active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      style={{
        color: isDanger ? "hsl(var(--destructive))" : "hsl(var(--ink-deep))",
      }}
    >
      <span
        className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full"
        style={{
          background: isDanger
            ? "hsl(var(--destructive) / 0.08)"
            : "hsl(var(--bark) / 0.08)",
          color: isDanger ? "hsl(var(--destructive))" : "hsl(var(--bark))",
        }}
      >
        {icon}
      </span>
      <span className="font-sans font-semibold text-ds-13">{label}</span>
    </button>
  );
}
