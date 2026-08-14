import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHero,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onDismiss: () => void;
}

/**
 * WelcomeModal — shown once on the first Dashboard visit after signup.
 *
 * Visibility gate (in Dashboard):
 *   - `!localStorage.getItem('helpr_welcomed')`
 *   - account age < 7 days (computed from profile.created_at)
 *
 * On any dismissal path (X, backdrop, CTA button, "Skip for now"):
 *   `localStorage.setItem('helpr_welcomed', '1')`
 */
export function WelcomeModal({ open, onDismiss }: Props) {
  const navigate = useNavigate();

  const handlePostJob = () => {
    onDismiss();
    navigate("/post-job");
  };

  const handleBrowseJobs = () => {
    onDismiss();
    // Navigate to dashboard root — the feed is already the landing view.
    navigate("/dashboard");
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onDismiss(); }}>
      <DialogContent
        className="max-w-sm gap-0 p-0 overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
        style={{
          background: "hsl(var(--parchment))",
          border: "0.5px solid hsl(var(--bark) / 0.22)",
        }}
      >
        {/* Header band — uses the canonical DialogHero for eyebrow/title/
            subtitle so this popup reads as a sibling of every other in the
            app. The radial gradient + border-bottom stay on the wrapping
            div; DialogHero renders inside it with the standard tokens. */}
        <div
          className="px-5 pt-6 pb-4"
          style={{
            background:
              "radial-gradient(120% 100% at 50% 0%, hsl(var(--burnt-sienna) / 0.10) 0%, transparent 70%)",
            borderBottom: "0.5px solid hsl(var(--bark) / 0.12)",
          }}
        >
          <DialogHero
            eyebrow="Louisiana's neighbor-to-neighbor marketplace"
            title="Welcome to Helpr"
          />
        </div>

        {/* Two-card grid */}
        <div className="grid grid-cols-2 gap-2.5 px-4 pt-4 pb-1">
          {/* Post a job */}
          <button
            type="button"
            onClick={handlePostJob}
            className="glass-press rounded-ds-md p-3 flex flex-col items-start gap-2 active:scale-95 transition-transform text-left"
            style={{
              background: "hsl(var(--bark) / 0.07)",
              border: "0.5px solid hsl(var(--bark) / 0.22)",
            }}
          >
            <span
              className="w-9 h-9 rounded-ds-sm flex items-center justify-center text-lg shrink-0"
              style={{ background: "hsl(var(--bark) / 0.14)" }}
              aria-hidden
            >
              🔧
            </span>
            <div className="min-w-0 w-full">
              <p
                className="font-display italic font-bold leading-tight text-ds-14"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                Need help?
              </p>
              <p
                className="font-serif italic mt-0.5 text-ds-12 leading-snug"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Post your first job in 2 min.
              </p>
            </div>
            <span
              className="mt-1 font-sans font-semibold text-ds-12 tracking-wide px-2.5 py-1 rounded-ds-md w-full text-center"
              style={{
                background: "hsl(var(--bark) / 0.16)",
                color: "hsl(var(--bark))",
              }}
            >
              Post a job
            </span>
          </button>

          {/* Browse jobs */}
          <button
            type="button"
            onClick={handleBrowseJobs}
            className="glass-press rounded-ds-md p-3 flex flex-col items-start gap-2 active:scale-95 transition-transform text-left"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.07)",
              border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
            }}
          >
            <span
              className="w-9 h-9 rounded-ds-sm flex items-center justify-center text-lg shrink-0"
              style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
              aria-hidden
            >
              💰
            </span>
            <div className="min-w-0 w-full">
              <p
                className="font-display italic font-bold leading-tight text-ds-14"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                Want to earn?
              </p>
              <p
                className="font-serif italic mt-0.5 text-ds-12 leading-snug"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Browse open jobs near you.
              </p>
            </div>
            <span
              className="mt-1 font-sans font-semibold text-ds-12 tracking-wide px-2.5 py-1 rounded-ds-md w-full text-center"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.14)",
                color: "hsl(var(--burnt-sienna))",
              }}
            >
              Browse jobs
            </span>
          </button>
        </div>

        {/* Trust reassurance strip */}
        <div
          className="mx-4 mt-3 mb-1 px-3 py-2 rounded-ds-sm"
          style={{
            background: "hsl(var(--olivewood) / 0.06)",
            border: "0.5px solid hsl(var(--olivewood) / 0.14)",
          }}
        >
          <p
            className="font-serif italic text-center text-ds-11 leading-relaxed"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Payment always protected · Verify when you're ready · Real people if you need help
          </p>
        </div>

        {/* Skip link */}
        <div className="pb-5 pt-2 flex justify-center">
          <button
            type="button"
            onClick={onDismiss}
            className="font-serif italic text-ds-12 underline underline-offset-2 active:opacity-60 transition-opacity"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Skip for now
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default WelcomeModal;
