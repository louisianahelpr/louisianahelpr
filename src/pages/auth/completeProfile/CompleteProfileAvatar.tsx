/**
 * CompleteProfile's photo (moved out of CompleteProfile.tsx, Q806; code unchanged): the picked file and its preview,
 * kept in step with profiles.avatar_url, the pick (checked, then framed by the crop dialog), and the picker markup.
 */
import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { useAvatarCrop } from "@/components/profile/AvatarCropDialog";
import { HiddenFileInput } from "@/components/ui/HiddenFileInput";
import type { useLanguage } from "@/lib/i18n/language";
import { ALLOWED_IMAGE_TYPES, fileProblemKey } from "./constants";

type T = ReturnType<typeof useLanguage>["t"];

export function useCompleteProfileAvatar(profileAvatarUrl: string | null | undefined, t: T) {
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  // A remote avatar_url can 404 (a deleted Storage object, a dead dicebear
  // URL). Falling back to the camera placeholder on `onError` is what lets us
  // render the real photo optimistically instead of refusing to render any
  // non-blob: URL at all — see the preview block below.
  const [avatarBroken, setAvatarBroken] = useState(false);

  // Keeps the avatar THUMBNAIL in step with the avatar the GATE reads.
  // A locally-picked file always wins (its blob: URL is the freshest truth);
  // otherwise mirror whatever `profile.avatar_url` currently is, including a
  // value that arrives on a later refetch.
  useEffect(() => {
    if (avatarFile) return;
    const url = profileAvatarUrl ?? null;
    setAvatarPreview((prev) => (prev === url ? prev : url));
    setAvatarBroken(false);
  }, [profileAvatarUrl, avatarFile]);

  const validateFile = (file: File, allowedTypes: string[], label: string): boolean => {
    const problem = fileProblemKey(file, allowedTypes);
    if (problem) toast.error(t(problem, { label }));
    return !problem;
  };

  const { requestCrop: requestAvatarCrop, dialog: avatarCropDialog } = useAvatarCrop();
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    // Reset so picking the same file again after a cancel still fires onChange.
    e.target.value = "";
    if (!picked || !validateFile(picked, ALLOWED_IMAGE_TYPES, t("profileGate.photoLabel"))) return;
    // Frame it before it becomes the preview — the circle crops anything left to chance.
    const file = await requestAvatarCrop(picked);
    if (file) {
      setAvatarFile(file);
      setAvatarBroken(false);
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  return { avatarFile, avatarPreview, avatarBroken, setAvatarBroken, handleAvatarChange, avatarCropDialog };
}

export function CompleteProfileAvatar({
  avatarPreview, avatarBroken, setAvatarBroken, handleAvatarChange, t,
}: {
  avatarPreview: string | null;
  avatarBroken: boolean;
  setAvatarBroken: (broken: boolean) => void;
  handleAvatarChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  t: T;
}) {
  return (
    <div className="flex flex-col items-center gap-2 -mt-1">
      <label
        htmlFor="avatar"
        className="group relative cursor-pointer"
      >
        <div className="w-24 h-24 rounded-full overflow-hidden ring-2 ring-border bg-muted flex items-center justify-center transition-all group-hover:ring-primary/50 group-focus-within:ring-primary">
          {/* Renders ANY preview URL, not just a freshly-picked
              `blob:`. The old `startsWith("blob:")` guard meant a user
              who already had an avatar on file saw an empty camera
              placeholder under the caption "Tap to change" — the
              screen implying the photo was missing on the one screen
              that will not let them leave until it isn't. A remote URL
              that 404s falls back to the placeholder via onError. */}
          {avatarPreview && !avatarBroken ? (
            <img
              loading="lazy"
              decoding="async"
              src={avatarPreview}
              alt={t("profileGate.photoPreview")}
              className="w-full h-full object-cover"
              onError={() => setAvatarBroken(true)}
            />
          ) : (
            <Camera className="w-7 h-7 text-muted-foreground" />
          )}
        </div>
        <div className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md ring-2 ring-card">
          <Camera className="w-3.5 h-3.5" />
        </div>
        {/* `sr-only`, not `hidden`, and the name on the INPUT. With
            `hidden` (display:none) the only way to add the required
            photo was a pointer: keyboard and screen-reader users could
            not reach it on the one screen they cannot leave without
            one. The aria-label sat on the <label>, where axe flags it
            as prohibited (aria-prohibited-attr) and AT ignores it.
            Found the first time the sweep rendered this gate. */}
        <HiddenFileInput
          id="avatar"
          accept="image/*"
          aria-label={avatarPreview ? t("profileGate.photoChange") : t("profileGate.photoUpload")}
          onChange={handleAvatarChange}
        />
      </label>
      <p className="text-ds-11 text-muted-foreground">
        {avatarPreview && !avatarBroken
          ? t("profileGate.photoTapChange")
          : t("profileGate.photoTapAdd")}
      </p>
      {/* WHERE THIS FILE GOES, said at the moment the file is chosen.
          The `avatars` bucket is PUBLIC — anonymously fetchable at a
          guessable URL — and identity documents have twice been
          uploaded into it from a picker that looked exactly like this
          one and said nothing. "Photo of a document" cannot be
          detected client-side (the licence found in prod was
          2502×1407, the passport 1093×1491 — no dimension or
          aspect-ratio test separates either from a selfie), so making
          the CONSEQUENCE legible is the entire defence. One quiet
          line, in the muted token, next to the control it describes —
          not a warning banner, which people learn to skip. */}
      <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.75)" }}>
        {t("profileGate.photoPublic")}
      </p>
    </div>
  );
}
