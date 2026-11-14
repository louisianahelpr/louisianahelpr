/**
 * Audit 11-10 F389: the order chat's photo parts, loaded only when the chat shows a photo or the box is open, so the
 * chat's own chunk does not grow (DeclutterOrderTalk lazy-imports each export).
 *
 *   OrderTalkPhotoPicker   "Add a photo": ONE photo waits on the device (local preview with Remove) and is uploaded
 *                          when Send is tapped (uploadOrderTalkPhoto, cleaned and shrunk like every Declutter photo).
 *                          The camera roll is allowed (no capture attribute): it is a picture of the item.
 *   OrderTalkMessagePhoto  a sent photo, read by a 10-minute signed URL from the private bucket (handoverPhotoUrl);
 *                          storage itself lets only the order's two sides read it (20261112060000).
 */
import { useEffect, useId, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddPhotoTile } from "@/components/ui/AddPhotoTile";
import { HiddenFileInput } from "@/components/ui/HiddenFileInput";
import { handoverPhotoUrl } from "@/lib/declutter/handover";
import { FallbackImg } from "./FallbackImg";
import { useInAppPhotoViewer } from "@/components/useInAppPhotoViewer";

export function OrderTalkPhotoPicker({ file, onChange, disabled = false }: { file: File | null; onChange: (file: File | null) => void; disabled?: boolean }) {
  const id = useId();
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return (
    <div data-order-talk-photo-picker="">
      <HiddenFileInput id={id} accept="image/*" tabIndex={-1} disabled={disabled}
        onChange={(e) => { const f = e.target.files?.[0]; if (f && f.type.startsWith("image/")) onChange(f); e.target.value = ""; }} />
      {preview ? (
        <div className="relative h-20 w-20">
          <FallbackImg src={preview} alt="Photo to send" className="h-full w-full rounded-xl bg-photo-empty object-cover" />
          <Button type="button" variant="ghost" size="iconCompact" aria-label="Remove photo" disabled={disabled}
            className="absolute -right-2 -top-2 [&_svg]:size-4" onClick={() => onChange(null)}>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow" aria-hidden>
              <X className="h-4 w-4" />
            </span>
          </Button>
        </div>
      ) : (
        <AddPhotoTile disabled={disabled} onClick={() => document.getElementById(id)?.click()}
          className="gap-1 text-ds-12 font-semibold text-[hsl(var(--bark))] dark:text-foreground">
          <Camera className="h-5 w-5" aria-hidden />
          Add a photo
        </AddPhotoTile>
      )}
    </div>
  );
}

export function OrderTalkMessagePhoto({ path }: { path: string }) {
  const url = useQuery({ queryKey: ["declutter", "order-talk-photo", path], queryFn: () => handoverPhotoUrl(path), staleTime: 8 * 60_000 });
  // Owner 11-13: the photo opens in the app's own viewer, never the signed URL in Safari.
  const { open, viewer } = useInAppPhotoViewer([url.data], ["Photo in this chat"]);
  // A fixed box, so the bubble does not jump when the photo arrives.
  if (!url.data) return <div className="mt-1 h-40 w-40 rounded-xl bg-photo-empty" aria-hidden data-order-talk-msg-photo="" />;
  return (
    <>
      <button type="button" onClick={() => open(0)} className="mt-1 block w-40 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Open the photo" data-order-talk-msg-photo="">
        <FallbackImg src={url.data} alt="Photo" className="h-40 w-40 rounded-xl bg-photo-empty object-cover" />
      </button>
      {viewer}
    </>
  );
}
