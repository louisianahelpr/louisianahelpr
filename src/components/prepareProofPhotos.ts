import { toast } from "sonner";
import { heicToJpeg, isHeicFile } from "@/lib/heicToJpeg";
import { cleanProofPhoto } from "@/lib/cleanProofPhoto";
import { LISTING_PHOTO_UNCLEANABLE } from "@/lib/declutter/photos";
import { unsupportedUploadCopy } from "@/lib/uploadTypes";

// A HEIC becomes a JPEG here, so every browser can draw it later. One this browser can't read is refused
// out loud and left where it is on the device: stored as it was, the poster's browser may show nothing.
// Then every photo loses its EXIF, GPS included. One that can't be cleaned is refused, never uploaded as it is.
export async function prepareProofPhotos(picked: File[], allowed: (f: File) => boolean): Promise<File[]> {
  const selected: File[] = [];
  for (const f of picked) {
    const ready = isHeicFile(f) ? await heicToJpeg(f) : f;
    if (!ready) {
      toast.error(`"${f.name}" is a HEIC photo this browser can't read. Save it as a JPG, or take the photo on your phone in the Helpr app.`);
    } else if (!allowed(ready)) {
      toast.error(unsupportedUploadCopy(f, "a JPG, PNG, WebP or HEIC photo"));
    } else {
      const clean = await cleanProofPhoto(ready);
      if (clean) selected.push(clean);
      else toast.error(LISTING_PHOTO_UNCLEANABLE);
    }
  }
  return selected;
}
