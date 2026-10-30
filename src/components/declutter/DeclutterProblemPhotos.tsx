/**
 * Audit 1b D2-7: up to 3 photos on the problem form and the refund-request form ("It's damaged" could only be words).
 * The photos wait on the device (local previews, each with Remove) and are uploaded when the form is sent
 * (uploadProblemPhotos), cleaned and shrunk like every Declutter photo. Evidence, not a handover photo: the camera
 * roll is allowed (no capture attribute), since the damage may have been photographed when the item was opened.
 */
import { useEffect, useId, useMemo } from "react";
import { Camera, X } from "lucide-react";
import { uploadProblemPhoto } from "@/lib/declutter/handover";
import { PROBLEM_PHOTO_MAX } from "@/lib/declutter/problemPhotos";
import { FallbackImg } from "./FallbackImg";

/** Adds the chosen files to `current`, keeping at most PROBLEM_PHOTO_MAX and only images. */
export function addProblemPhotos(current: File[], chosen: FileList | File[] | null): File[] {
  const images = Array.from(chosen ?? []).filter((f) => f.type.startsWith("image/"));
  return [...current, ...images].slice(0, PROBLEM_PHOTO_MAX);
}

/** Uploads the photos one by one into the signed-in member's problem folder for the order; returns their paths in order. */
export async function uploadProblemPhotos(orderId: string, files: File[]): Promise<string[]> {
  const paths: string[] = [];
  for (const f of files.slice(0, PROBLEM_PHOTO_MAX)) paths.push(await uploadProblemPhoto(orderId, f));
  return paths;
}

export function ProblemPhotoPicker({ files, onChange, disabled = false }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const id = useId();
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  const full = files.length >= PROBLEM_PHOTO_MAX;
  return (
    <div className="space-y-2" role="group" aria-label="Photos" data-problem-photos="">
      <p className="text-xs font-medium">Photos (optional, up to {PROBLEM_PHOTO_MAX})</p>
      <input id={id} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} disabled={disabled || full}
        onChange={(e) => { onChange(addProblemPhotos(files, e.target.files)); e.target.value = ""; }} />
      <ul className="flex flex-wrap gap-2">
        {previews.map((src, i) => (
          <li key={src} className="relative h-20 w-20">
            <FallbackImg src={src} alt={`Photo ${i + 1}`} className="h-full w-full rounded-xl bg-photo-empty object-cover" />
            <button type="button" aria-label={`Remove photo ${i + 1}`} disabled={disabled}
              className="absolute -right-2 -top-2 flex h-11 w-11 items-center justify-center"
              onClick={() => onChange(files.filter((_, j) => j !== i))}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-foreground shadow" aria-hidden>
                <X className="h-4 w-4" />
              </span>
            </button>
          </li>
        ))}
        {!full && (
          <li>
            <button type="button" disabled={disabled} onClick={() => document.getElementById(id)?.click()}
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[hsl(var(--bark)/0.45)] text-ds-12 font-semibold text-[hsl(var(--bark))] dark:text-foreground">
              <Camera className="h-5 w-5" aria-hidden />
              Add a photo
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
