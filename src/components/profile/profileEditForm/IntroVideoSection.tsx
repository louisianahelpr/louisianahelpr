import { useState } from "react";
import { Loader2, Video, Trash2, RefreshCcw, Flag } from "lucide-react";
import { Link } from "react-router-dom";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import {
  useIntroVideoUpload,
  INTRO_VIDEO_MAX_SECONDS,
  type IntroVideoFields,
} from "@/components/profile/profileEditForm/useIntroVideoUpload";
import type { Profile } from "@/components/profile/profileEditForm/types";

interface IntroVideoSectionProps {
  profile: Profile | null;
  onIntroVideoChange?: (fields: IntroVideoFields) => void;
}

const formatDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  return m > 0 ? `${m}:${String(rest).padStart(2, "0")}` : `${rest}s`;
};

/**
 * Intro video — a short self-introduction shown to posters alongside an
 * application (`activity/postedJobs/ApplicantsPanel.tsx` renders the pill,
 * `VideoPreviewModal.tsx` plays it). It lives on Edit Profile rather than
 * the Profile landing screen because this is the one screen that OWNS
 * profile media: avatar, ID document and Recent Work all upload from here,
 * all persist on their own, and all say so in the same sentence. A second
 * media uploader on the landing screen would split that model in two.
 *
 * The three states are the three columns: nothing yet → prompt, uploading →
 * progress, present → preview with Replace and Remove.
 */
export function IntroVideoSection({ profile, onIntroVideoChange }: IntroVideoSectionProps) {
  const {
    videoUrl,
    thumbnailUrl,
    durationSeconds,
    status,
    pendingName,
    inputRef,
    pick,
    handleFile,
    removeVideo,
  } = useIntroVideoUpload({ profile, onIntroVideoChange });

  const [confirmRemove, setConfirmRemove] = useState(false);
  const busy = status !== "idle";

  return (
    <div className="rounded-2xl liquid-glass p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-ds-13 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
          Intro video
        </h3>
        <span className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          {videoUrl ? (durationSeconds ? formatDuration(durationSeconds) : "Added") : "Optional"}
        </span>
      </div>

      <p
        className="font-serif italic leading-snug -mt-1 text-ds-12"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        Say hello in your own voice — posters can play this next to your
        application. Under {INTRO_VIDEO_MAX_SECONDS} seconds and 30 MB, MP4, MOV
        or WEBM.{" "}
        <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
          Your video saves automatically.
        </span>
      </p>

      {status === "uploading" ? (
        <div
          className="rounded-2xl p-4 space-y-2"
          style={{
            background: "hsl(var(--olivewood) / 0.06)",
            border: "0.5px solid hsl(var(--olivewood) / 0.2)",
          }}
        >
          <p
            className="flex items-center gap-2 text-ds-12 font-semibold"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden />
            Uploading your intro video…
          </p>
          {pendingName && (
            <p className="text-ds-11 truncate" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              {pendingName}
            </p>
          )}
          {/* Supabase Storage uploads don't report byte progress, so this bar
              is deliberately indeterminate rather than a fake percentage
              that stalls at 90%. */}
          <div
            className="h-1.5 w-full rounded-full overflow-hidden"
            role="progressbar"
            aria-label="Uploading your intro video"
            style={{ background: "hsl(var(--olivewood) / 0.15)" }}
          >
            <div
              className="h-full w-1/3 rounded-full animate-pulse"
              style={{ background: "hsl(var(--bark))" }}
            />
          </div>
          <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Keep this screen open — a 30 MB clip can take a minute.
          </p>
        </div>
      ) : videoUrl ? (
        <div className="space-y-3">
          <div
            className="relative rounded-2xl overflow-hidden"
            style={{ border: "0.5px solid hsl(var(--bark) / 0.22)" }}
          >
            {/* playsInline is not optional here: without it WKWebView hijacks
                playback into the native fullscreen player the moment the user
                taps play, which on this screen reads as the app navigating
                away from an unsaved form. */}
            <video
              src={videoUrl}
              poster={thumbnailUrl ?? undefined}
              controls
              playsInline
              preload="metadata"
              className="w-full max-h-64 object-contain bg-black"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={pick}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-ds-md text-ds-12 font-semibold active:scale-[0.98] transition-all disabled:opacity-60"
              style={{
                background: "hsl(var(--bark) / 0.1)",
                color: "hsl(var(--bark))",
                border: "0.5px solid hsl(var(--bark) / 0.3)",
              }}
            >
              <RefreshCcw className="w-3.5 h-3.5" aria-hidden />
              Replace Video
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-ds-md text-ds-12 font-semibold active:scale-[0.98] transition-all disabled:opacity-60"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.1)",
                color: "hsl(var(--burnt-sienna))",
                border: "0.5px solid hsl(var(--burnt-sienna) / 0.3)",
              }}
            >
              {status === "removing" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="w-3.5 h-3.5" aria-hidden />
              )}
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={pick}
          disabled={busy}
          className="w-full rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 py-7 active:scale-[0.98] transition-all disabled:opacity-60"
          style={{ borderColor: "hsl(var(--bark) / 0.25)", color: "hsl(var(--bark))" }}
        >
          <Video className="w-6 h-6" aria-hidden />
          <span className="text-ds-12 font-semibold">Add Intro Video</span>
          <span className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Record one or pick a clip from your library
          </span>
        </button>
      )}

      {/* Same reporting path as every other piece of helpr-visible media:
          anyone watching this on a public profile can report the member from
          /user/:id, and that's the queue admins already work. Linking it from
          the uploader keeps the rule visible to the person posting. */}
      <p
        className="flex items-start gap-1.5 text-ds-11 leading-snug"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        <Flag className="w-3 h-3 mt-0.5 shrink-0" aria-hidden />
        <span>
          Posters can report anything on your profile.{" "}
          {profile?.user_id && (
            <Link
              to={`/user/${profile.user_id}`}
              className="font-semibold underline"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              See how yours looks
            </Link>
          )}
        </span>
      </p>

      {/* One hidden input, same convention as the ID / Recent Work pickers.
          `accept` is narrowed to the bucket's allowed MIME types so iOS opens
          the video picker rather than the whole photo library. No `capture`
          attribute: it would force the camera and take away "pick a clip I
          already recorded", which is how most people will do this. */}
      <input
        ref={inputRef}
        type="file"
        aria-label={videoUrl ? "Replace your intro video" : "Add your intro video"}
        accept="video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={handleFile}
        disabled={busy}
      />

      <BrandConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove your intro video?"
        description="Posters won't see it next to your applications any more. You can record a new one whenever you like."
        primaryLabel="Remove Video"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => {
          setConfirmRemove(false);
          void removeVideo();
        }}
        secondaryLabel="Keep It"
      />
    </div>
  );
}

export default IntroVideoSection;
