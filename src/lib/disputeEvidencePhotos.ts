import { compressImage } from "@/lib/imageCompression";
import { report } from "@/lib/errorLogger";

/** After-shrinking backstop for one dispute photo (the proof-photos bucket limit). */
export const DISPUTE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Audit 11-20 night #17: shrink each dispute photo the way job photos are
 * shrunk BEFORE the 5 MB check, so a full-size phone photo attaches instead of
 * being refused. A photo the browser cannot shrink is kept as picked and only
 * refused when it is still over the limit.
 */
export async function shrinkDisputePhotos(
  files: File[],
  compress: (f: File) => Promise<File> = (f) => compressImage(f),
): Promise<{ ready: File[]; tooBig: File[] }> {
  const ready: File[] = [];
  const tooBig: File[] = [];
  for (const picked of files) {
    const file = await compress(picked).catch((err: unknown) => {
      report(err, { tags: { source: "shrinkDisputePhotos" } });
      return picked;
    });
    if (file.size > DISPUTE_PHOTO_MAX_BYTES) tooBig.push(picked);
    else ready.push(file);
  }
  return { ready, tooBig };
}
