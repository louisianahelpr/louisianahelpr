import { Suspense, lazy, useCallback, useRef, useState } from "react";
import type { Area } from "react-easy-crop";
import { cropImageToFile } from "@/lib/cropImage";
import { report } from "@/lib/errorLogger";

/** The dialog's own chunk (react-easy-crop, the dialog primitives): fetched when a photo is picked, never on the first screen. */
const loadView = () => import("./AvatarCropDialogView");
const AvatarCropDialogView = lazy(loadView);

/**
 * POSITION AND ZOOM A PROFILE PHOTO BEFORE IT IS SAVED.
 *
 * Owner, 2026-09-12: "the profile picture spot doesnt give them the option to
 * like center the picture better it crops their head off". Every avatar in the
 * app is a centre-crop inside a circle, so a photo framed with the face high up
 * lost the top of the head and there was nothing the member could do about it.
 *
 * `useAvatarCrop` is the one entry point: both the profile editor and Complete
 * Profile call `requestCrop(file)` between the file picker and their existing
 * upload logic, and get back an already-framed square JPEG (or null if the
 * member cancelled). Drag to move, pinch or use the slider to zoom.
 *
 * The dialog itself is AvatarCropDialogView, loaded only once a photo is picked (it sat on /profile's first screen).
 */
export function useAvatarCrop() {
  const [src, setSrc] = useState<string | null>(null);
  const [name, setName] = useState("avatar.jpg");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((f: File | null) => void) | null>(null);

  const finish = useCallback(
    (result: File | null) => {
      resolver.current?.(result);
      resolver.current = null;
      if (src) URL.revokeObjectURL(src);
      setSrc(null);
      setArea(null);
      setSaving(false);
      setError(null);
    },
    [src],
  );

  const requestCrop = useCallback((file: File) => {
    // Start the dialog's chunk at once. A failed fetch here is not handled: the lazy render below owns it (the
    // route's error boundary shows it), so this only warms the same request.
    void loadView().catch(() => undefined);
    // A second pick while the dialog is open supersedes the first.
    resolver.current?.(null);
    setName(file.name || "avatar.jpg");
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setSrc(URL.createObjectURL(file));
    return new Promise<File | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const save = async () => {
    if (!src || !area) return;
    setSaving(true);
    setError(null);
    try {
      finish(await cropImageToFile(src, area, name));
    } catch (e) {
      // Shown inline so the member can retry or cancel, and reported because a
      // canvas that cannot encode is a device problem we would otherwise never see.
      report(e, { tags: { source: "AvatarCropDialog.save" } });
      setSaving(false);
      setError(e instanceof Error ? e.message : "Couldn't prepare that photo.");
    }
  };

  // Nothing is drawn, and nothing fetched, until a photo is picked.
  const dialog = src ? (
    <Suspense fallback={null}>
      <AvatarCropDialogView
        src={src}
        crop={crop}
        zoom={zoom}
        area={area}
        saving={saving}
        error={error}
        onCropChange={setCrop}
        onZoomChange={setZoom}
        onArea={setArea}
        onCancel={() => finish(null)}
        onSave={() => void save()}
      />
    </Suspense>
  ) : null;

  return { requestCrop, dialog };
}
