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

/**
 * The crop dialog itself (react-easy-crop and the dialog primitives), drawn only while a photo is being framed.
 * Its own chunk, loaded by useAvatarCrop (AvatarCropDialog.tsx) when a photo is picked: on /profile it sat on the
 * first screen's critical path (8.0 KB gz with react-easy-crop, plus the dialog primitives) although nobody sees it
 * until they change their photo (cwv-lab 11-14, ~/.lh-shots/b2-perf2-1114). Guard: src/test/avatarCropDialogLazy.test.ts.
 */
export default function AvatarCropDialogView({
  src,
  crop,
  zoom,
  area,
  saving,
  error,
  onCropChange,
  onZoomChange,
  onArea,
  onCancel,
  onSave,
}: {
  src: string;
  crop: { x: number; y: number };
  zoom: number;
  area: Area | null;
  saving: boolean;
  error: string | null;
  onCropChange: (c: { x: number; y: number }) => void;
  onZoomChange: (z: number) => void;
  onArea: (a: Area) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHero title="Position your photo" />
        <div className="relative w-full aspect-square overflow-hidden rounded-ds-md bg-[hsl(var(--ink-deep)/0.9)]">
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
            onCropChange={onCropChange}
            onZoomChange={onZoomChange}
            onCropComplete={(_, pixels) => onArea(pixels)}
          />
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
            onChange={(e) => onZoomChange(Number(e.target.value))}
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
          <DialogSecondaryAction onClick={onCancel} disabled={saving}>
            Cancel
          </DialogSecondaryAction>
          <DialogPrimaryAction onClick={onSave} disabled={saving || !area}>
            {saving ? "Saving…" : "Use photo"}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
