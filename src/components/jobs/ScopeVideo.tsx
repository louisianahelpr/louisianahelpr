import { safeScopeVideoUrl } from "@/lib/scopeVideo";

/**
 * The poster's scope video (A2-B6): a small inline player sized to its
 * column, or nothing when the job has no video. One player for every place
 * the video shows (the post-job Review step, the browse sheet, the job page),
 * so they never drift apart. Preloading metadata fetches only the first
 * frame and length until the viewer presses play.
 */
export function ScopeVideo({ url, className = "" }: { url: string | null | undefined; className?: string }) {
  const src = safeScopeVideoUrl(url);
  if (!src) return null;
  return (
    <video
      data-scope-video=""
      src={src}
      controls
      playsInline
      preload="metadata"
      aria-label="Scope video"
      className={`block w-full max-h-64 rounded-ds-md object-contain ${className}`}
      style={{ background: "hsl(var(--bark) / 0.05)" }}
    />
  );
}
