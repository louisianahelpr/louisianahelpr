import { useCallback, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { ZoomIn, ZoomOut } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
  DialogPrimaryAction,
  DialogSecondaryAction,
} from "@/components/ui/dialog";
import { cropImageToFile } from "@/lib/cropImage";
import { report } from "@/lib/errorLogger";

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

  const dialog = (
    <Dialog open={!!src} onOpenChange={(open) => !open && !saving && finish(null)}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHero title="Position your photo" />
        <div className="relative w-full aspect-square overflow-hidden rounded-ds-md bg-[hsl(var(--ink-deep)/0.9)]">
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              minZoom={1}
              maxZoom={4}
              aspect={1}
              cropShape="round"
              showGrid={false}
              objectFit="cover"
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setArea(pixels)}
            />
          )}
        </div>
        <p className="text-ds-12 text-muted-foreground text-center">Drag to move · pinch or slide to zoom</p>
        <div className="flex items-center gap-3 px-1">
          <ZoomOut className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
            className="w-full h-11 rounded-full accent-[hsl(var(--bark))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--olivewood)/0.3)]"
          />
          <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
        </div>
        {error && (
          <p role="alert" className="text-ds-12 text-[hsl(var(--destructive-ink))]">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogSecondaryAction onClick={() => finish(null)} disabled={saving}>
            Cancel
          </DialogSecondaryAction>
          <DialogPrimaryAction onClick={save} disabled={saving || !area}>
            {saving ? "Saving…" : "Use Photo"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { requestCrop, dialog };
}
