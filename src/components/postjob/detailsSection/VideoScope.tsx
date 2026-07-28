import { X, Video } from "lucide-react";

interface VideoScopeProps {
  scopeVideoUrl?: string | null;
  onVideoSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearVideo?: () => void;
}

// Video scope — optional 30s clip showing the space or work area.
// Gives helpers better context and leads to more accurate quotes.
export function VideoScope({
  scopeVideoUrl,
  onVideoSelect,
  onClearVideo,
}: VideoScopeProps) {
  return (
    <div className="mt-4">
      <p className="font-display italic font-semibold text-ds-14 mb-1" style={{ color: "hsl(var(--ink-deep))" }}>
        Show them the job <span className="font-sans text-ds-11 not-italic font-normal" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>(optional)</span>
      </p>
      <p className="font-serif italic text-ds-12 mb-2" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        A short video of the space gets you more accurate quotes and fewer surprises.
      </p>
      {scopeVideoUrl ? (
        <div className="relative rounded-ds-md overflow-hidden aspect-video bg-black">
          <video src={scopeVideoUrl} controls playsInline className="w-full h-full object-cover" />
          {onClearVideo && (
            <button
              type="button"
              onClick={onClearVideo}
              aria-label="Remove video"
              className="absolute top-1 right-1 w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: "rgba(0,0,0,0.5)" }}
            >
              <X className="w-3.5 h-3.5 text-white" />
            </button>
          )}
        </div>
      ) : (
        <label
          className="block w-full rounded-ds-md p-4 text-center cursor-pointer transition-colors"
          style={{ border: "1.5px dashed hsl(var(--bark) / 0.3)", background: "hsl(var(--bark) / 0.03)" }}
        >
          <Video className="w-6 h-6 mx-auto mb-1" style={{ color: "hsl(var(--bark) / 0.5)" }} />
          <span className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Upload a video (30s max)
          </span>
          <input type="file" accept="video/*" className="hidden" onChange={onVideoSelect} />
        </label>
      )}
    </div>
  );
}
