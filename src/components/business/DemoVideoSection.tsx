import { useState } from "react";
import { Play, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * Demo video — 16:9 frame with a play-button overlay. The thumbnail is a
 * brand-token gradient placeholder so we can ship without an image asset
 * commit; swap to a real screenshot when one is available.
 *
 * The embed URL is intentionally a placeholder (Rickroll classic) — the
 * `data-testid="demo-video-iframe"` makes it easy to find and replace.
 */
const PLACEHOLDER_EMBED_URL = "https://www.youtube.com/embed/dQw4w9WgXcQ";

export function DemoVideoSection() {
  const [open, setOpen] = useState(false);

  return (
    <section
      aria-labelledby="demo-video-heading"
      className="liquid-glass p-6 lg:p-7"
    >
      <div className="mb-5">
        <span className="text-display-eyebrow">2-minute tour</span>
        <h2
          id="demo-video-heading"
          className="font-display italic font-bold leading-tight"
          style={{
            fontSize: "clamp(1.35rem, 2vw + 0.5rem, 1.75rem)",
            color: "hsl(var(--ink-deep))",
            letterSpacing: "-0.025em",
          }}
        >
          See how a business posts a job in under two minutes.
        </h2>
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Play demo video"
        data-testid="demo-video-play-button"
        className="group relative block w-full overflow-hidden rounded-ds-lg"
        style={{
          aspectRatio: "16 / 9",
          background:
            "linear-gradient(135deg, hsl(var(--bark) / 0.85), hsl(var(--burnt-sienna) / 0.75))",
          border: "1px solid hsl(var(--olivewood) / 0.18)",
        }}
      >
        {/* Decorative grain pattern — subtle parchment texture overlay */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 30%, hsl(var(--parchment) / 0.4) 0%, transparent 50%), radial-gradient(circle at 80% 70%, hsl(var(--parchment) / 0.3) 0%, transparent 50%)",
          }}
        />

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
            style={{
              background: "hsl(var(--parchment))",
              color: "hsl(var(--bark))",
              boxShadow: "0 10px 40px -10px hsl(var(--bark) / 0.6)",
            }}
          >
            <Play className="w-8 h-8 ml-1" strokeWidth={1.75} fill="currentColor" />
          </div>
          <span
            className="text-ds-13 font-semibold"
            style={{ color: "hsl(var(--parchment))" }}
          >
            Watch the 2-minute tour
          </span>
        </div>
      </button>

      <p className="text-ds-11 text-muted-foreground mt-3 text-center">
        {/* TODO: swap PLACEHOLDER_EMBED_URL for the real demo when recorded. */}
        Demo video — placeholder embed, swap when recorded.
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden border-0">
          <DialogTitle className="sr-only">Helpr for Business — demo video</DialogTitle>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close demo video"
            className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full flex items-center justify-center"
            style={{
              background: "hsl(var(--ink-deep) / 0.6)",
              color: "hsl(var(--parchment))",
            }}
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
          <div style={{ aspectRatio: "16 / 9" }}>
            {open && (
              <iframe
                data-testid="demo-video-iframe"
                src={`${PLACEHOLDER_EMBED_URL}?autoplay=1&rel=0`}
                title="Helpr for Business demo"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full border-0"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default DemoVideoSection;
