/**
 * Turn a chosen region of an image into a square JPEG `File`, ready to upload.
 *
 * WHY THE CROP HAPPENS BEFORE UPLOAD. A profile photo is displayed centre-cropped
 * inside a circle everywhere in the app, so a portrait shot framed with the face
 * near the top lost the top of the head (owner, 2026-09-12: "it crops their head
 * off"). Storing a position alongside the URL would mean every avatar renderer
 * learning to honour it; baking the member's chosen framing into the file itself
 * means every existing renderer is already correct.
 *
 * Output is capped at AVATAR_OUTPUT_PX square — an avatar never renders larger,
 * and a phone photo's 12MP original would otherwise hit the 5MB bucket limit.
 */
export const AVATAR_OUTPUT_PX = 800;

export type PixelCrop = { x: number; y: number; width: number; height: number };

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That image couldn't be opened."));
    img.src = src;
  });

export async function cropImageToFile(
  src: string,
  crop: PixelCrop,
  fileName = "avatar.jpg",
): Promise<File> {
  const img = await loadImage(src);
  const size = Math.min(AVATAR_OUTPUT_PX, Math.round(crop.width));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This device couldn't prepare the photo.");
  // Flatten onto white first: a transparent PNG would otherwise turn black when
  // encoded as JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, size, size);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("This device couldn't prepare the photo.");
  return new File([blob], fileName.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}
